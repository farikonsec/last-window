import {expect, test} from 'bun:test';
import {Mission} from '../src/sim/mission';
import {latLonToUnit, circularState} from '../src/sim/orbit';
import {SMOOTH_MOON, KESTREL, altitudeAboveGround} from '../src/sim/vehicle';
import {R_MOON} from '../src/sim/constants';
import {dot, len, rotate, sub, unit} from '../src/sim/vec';
const site = latLonToUnit(26.1322, 3.7115);

test('waiting charges battery and follows the rotating Moon at actual pad height', () => {
  const env = {surfaceRadius: () => R_MOON - 2200};
  const m = new Mission(site, env);
  m.waitForWindow();
  expect(m.countdown).toBeCloseTo(30, 4);
  expect(len(m.state.r)).toBeCloseTo(R_MOON - 2200, 5);
  expect(m.state.batteryKWh).toBeCloseTo(18 - m.state.t * KESTREL.baseLoadKW / 3600, 7);
  expect(m.window.arrivalLead).toBeGreaterThan(1000);
  expect(m.window.arrivalLead).toBeLessThan(6000);
});

test('manual launch has no automatic guidance and all controls pass through the bus', () => {
  const m = new Mission(site, SMOOTH_MOON);
  const sources: string[] = [];
  m.bus.use((command, source) => {sources.push(source); return command;});
  expect(m.assisted).toBe(false);
  expect(m.launch()).toBe(true);
  m.advance(1, 100);
  expect(m.effectiveWarp).toBe(1);
  expect(m.state.t).toBeCloseTo(1, 8);
  expect(m.state.status).toBe('flying');
  expect(sources.every(s => s === 'pilot')).toBe(true);
  expect(m.state.mainPropellant).toBeLessThan(KESTREL.mainPropellantCapacity);
  const rcs = m.state.rcsPropellant;
  m.throttle = 0;
  m.translation = [1, -1, 1];
  m.advance(1, 1);
  expect(m.state.rcsPropellant).toBeLessThan(rcs);
  expect(m.bus.read().translate).toEqual([1, -1, 1]);
});

test('terminal fixture exposes LVLH/CW data and nominal contact hard-docks after latch retraction', () => {
  const m = new Mission(site, SMOOTH_MOON);
  m.placeForDocking(1, 0.1);
  expect(m.dockingRelative.position[0]).toBeCloseTo(0, 5);
  expect(m.dockingRelative.position[1]).toBeCloseTo(-1, 5);
  expect(m.approach.rangeRate).toBeCloseTo(-0.1, 2);
  for (let i = 0; i < 200 && !m.captureRemaining; i++) m.advance(0.1, 1);
  expect(m.dockingOutcome).toBe('capture');
  expect(m.captureRemaining).toBeGreaterThan(0);
  for (let i = 0; i < 60; i++) m.advance(0.1, 1);
  expect(m.state.status).toBe('docked');
  expect(m.result).toBeNull();
});

test('docking contact distinguishes bounce, damaged probe and destructive impact', () => {
  const outcome = (closing: number, lateral = 0) => {
    const m = new Mission(site, SMOOTH_MOON);
    m.placeForDocking(0.04, closing, lateral);
    for (let i = 0; i < 500 && !m.dockingOutcome && !m.result; i++) m.advance(0.05, 1);
    return m;
  };
  expect(outcome(0.01).dockingOutcome).toBe('bounce');
  const damaged = outcome(0.1, 0.3);
  expect(damaged.dockingOutcome).toBe('damage');
  expect(damaged.probeDamaged).toBe(true);
  const destroyed = outcome(0.8);
  expect(destroyed.dockingOutcome).toBe('destroyed');
  expect(destroyed.result).toBe('collision');
});

test('bus middleware can inhibit liftoff without any actuator bypass', () => {
  const m = new Mission(site, SMOOTH_MOON);
  m.bus.use(command => ({...command, throttle: 0}));
  m.launch(); m.advance(2, 1);
  expect(m.state.status).toBe('landed');
  expect(m.state.mainPropellant).toBe(KESTREL.mainPropellantCapacity);
});

test('reference launch reaches a safe bound insertion, retaining manual override', () => {
  const m = new Mission(site, SMOOTH_MOON);
  m.waitForWindow(); m.advance(30, 1); m.assisted = true; m.launch();
  for (let i = 0; i < 4000 && m.guidance.phase !== 'cutoff'; i++) m.advance(0.1, 1);
  expect(m.result).toBeNull();
  expect(m.guidance.phase).toBe('cutoff');
  expect(m.summary.bound).toBe(true);
  expect(m.summary.periapsisAltitude).toBeGreaterThan(10_000);
  expect(m.summary.apoapsisAltitude).toBeGreaterThanOrEqual(100_000);
  m.assisted = false; m.throttle = 0; m.advance(0.1, 1);
  expect(m.bus.read().throttle).toBe(0);
});

test('battery exhaustion stops commands; collision and surface impact are terminal', () => {
  const m = new Mission(site, SMOOTH_MOON);
  m.state.batteryKWh = 0.00001; m.advance(1, 1);
  expect(m.result).toBe('power-loss'); expect(m.launch()).toBe(false);
  const collision = new Mission(site, SMOOTH_MOON);
  collision.launch(); collision.throttle = 0;
  collision.state = {...collision.state, ...circularState(collision.orbit, 0), status: 'flying'};
  collision.advance(0.1, 1);
  expect(collision.result).toBe('collision');
  const impact = new Mission(site, SMOOTH_MOON);
  impact.launch(); impact.throttle = 0;
  impact.state = {...impact.state, r: [R_MOON + 0.1, 0, 0], v: [-20, 0, 0], status: 'flying'};
  impact.advance(0.1, 1);
  expect(impact.result).toBe('surface-impact');
  const escape = new Mission(site, SMOOTH_MOON);
  escape.launch();
  escape.state = {...escape.state, r: [R_MOON + 1000, 0, 0], v: [0, 2500, 0], status: 'flying'};
  escape.advance(0.1, 1);
  expect(escape.result).toBe('escape');
});

test('fixed-step flight is independent of render frame subdivision', () => {
  const a = new Mission(site, SMOOTH_MOON), b = new Mission(site, SMOOTH_MOON);
  a.launch(); b.launch();
  for (let i = 0; i < 120; i++) a.advance(1 / 60, 1);
  for (let i = 0; i < 60; i++) b.advance(1 / 30, 1);
  expect(len(sub(a.state.r, b.state.r))).toBeLessThan(1e-8);
  expect(a.state.mainPropellant).toBe(b.state.mainPropellant);
});

test('the whole mission is flyable with the in-game aids: ascent, coast, match, close in, dock', () => {
  const site = latLonToUnit(26.1322, 3.7115);
  const m = new Mission(site, SMOOTH_MOON, 0);
  m.waitForWindow();
  m.advance(m.countdown, 1); // parked until T-0
  expect(Math.abs(m.countdown)).toBeLessThan(0.5);
  // Ascent on the reference cue (the HUD's pitch cue), then manual from cutoff.
  expect(m.launch()).toBe(true);
  m.assisted = true;
  for (let i = 0; i < 20_000 && m.guidance.phase !== 'cutoff'; i++) m.advance(1 / 30, 1);
  m.assisted = false; m.throttle = 0; m.attitudeMode = 'stabilize';
  expect(m.summary.periapsisAltitude).toBeGreaterThan(10_000);
  // Coast with warp to apoapsis, as the HUD cue says; slow the warp for the last minutes.
  for (let i = 0; i < 400_000 && m.summary.verticalSpeed > 0 && !m.result; i++) m.advance(1, m.timeToApoapsis > 400 ? 100 : 5);
  expect(m.result).toBeNull();
  expect(m.range).toBeLessThan(4000);
  // MATCH aid points the engine; short pulses null the relative velocity.
  m.attitudeMode = 'match';
  for (let i = 0; i < 6000 && len(m.relativeVelocity) > 0.3 && !m.result; i++) {
    const aligned = dot(rotate(m.state.q, [0, 1, 0]), unit(sub(m.argo.v, m.state.v))) > 0.995;
    m.throttle = aligned ? Math.min(1, len(m.relativeVelocity) / 12) : 0;
    m.advance(1 / 30, 1);
  }
  m.throttle = 0;
  expect(len(m.relativeVelocity)).toBeLessThan(0.5);
  // DOCK aid holds attitude; the pilot presses exactly the RCS keys the HUD cue shows.
  m.attitudeMode = 'dock';
  for (let i = 0; i < 120_000 && m.state.status !== 'docked' && !m.result; i++) {
    m.translation = m.translationCue.keys;
    m.advance(1 / 30, 1);
  }
  expect(m.result).toBeNull();
  expect(m.state.status).toBe('docked');
}, 30_000); // flies the entire mission at fine steps; slow under load, so well past the 5 s default.

test('the descent mission can be flown from powered-descent initiation to a soft touchdown', () => {
  const m = new Mission(latLonToUnit(26.1322, 3.7115), SMOOTH_MOON, 0);
  m.startDescent();
  // Apollo-style PDI: high and fast, with the whole orbital speed still to kill.
  expect(m.summary.altitude).toBeGreaterThan(14_000);
  expect(m.summary.horizontalSpeed).toBeGreaterThan(1500);
  // Fly the shipped descent guidance: RETRO holds the braking attitude, the throttle follows the same solution.
  for (let i = 0; i < 300_000 && !m.result; i++) {
    m.attitudeMode = 'retrograde';
    m.throttle = m.descentGuidance.throttle;
    m.advance(1 / 30, 1);
  }
  expect(m.result).toBe('touchdown');
  expect(m.state.status).toBe('landed');
  expect(m.state.contact!.speed).toBeLessThanOrEqual(3);
}, 60_000);
