import {expect, test} from 'bun:test';
import {BUGGY, Buggy, NO_DRIVE} from '../src/sim/buggy';

const flat = {height: () => 0};
/** A gentle east-facing slope (~9°): height rises with longitude, shallow enough that the wheels never leave it. */
const hill = {height: (_lat: number, lon: number) => lon * 5_000};
/** A ski-jump: a gentle climb to a crest at lon=0.02° then a steep lip that drops away — an east-driven jump. */
const ramp = {height: (_lat: number, lon: number) => (lon < 0.02 ? lon * 8_000 : Math.max(0, 160 - (lon - 0.02) * 120_000))};
/** A flat mesa that drops off a cliff to -60 m east of lon=0.003°. */
const cliff = {height: (_lat: number, lon: number) => (lon < 0.003 ? 0 : -60)};

test('it accelerates to the rated top speed and no further', () => {
  const b = new Buggy(26.13, 3.71, 90);
  for (let i = 0; i < 4000; i++) b.step({throttle: 1, brake: 0, steer: 0, turbo: false}, 1 / 30, flat);
  expect(b.speed).toBeCloseTo(BUGGY.topSpeed, 1);
  expect(b.airborne).toBe(false);
});

test('turbo lifts the top speed above the motor-only cap and drains the reserve', () => {
  const b = new Buggy(0, 0, 90);
  let peak = 0;
  for (let i = 0; i < 400; i++) {b.step({throttle: 1, brake: 0, steer: 0, turbo: true}, 1 / 30, flat); peak = Math.max(peak, b.speed);}
  expect(peak).toBeGreaterThan(BUGGY.topSpeed + 1);
  expect(b.turbo).toBeLessThan(0.5);
});

test('rolling resistance brings it to a stop when you lift off', () => {
  const b = new Buggy(0, 0, 90);
  for (let i = 0; i < 40; i++) b.step({throttle: 1, brake: 0, steer: 0, turbo: false}, 1 / 30, flat);
  expect(b.speed).toBeGreaterThan(0.5);
  for (let i = 0; i < 3000; i++) b.step(NO_DRIVE, 1 / 30, flat);
  expect(b.speed).toBeCloseTo(0, 1);
});

test('a climb costs speed and the same slope downhill gives it back', () => {
  const up = new Buggy(0, 0, 90), down = new Buggy(0, 0, 270);
  // Measured before either saturates the top-speed cap, so the slope term is visible.
  for (let i = 0; i < 60; i++) {
    up.step({throttle: 1, brake: 0, steer: 0, turbo: false}, 1 / 30, hill);
    down.step({throttle: 1, brake: 0, steer: 0, turbo: false}, 1 / 30, hill);
  }
  expect(up.airborne).toBe(false);
  expect(down.speed).toBeGreaterThan(up.speed);
});

test('brakes stop it faster than coasting, then it reverses', () => {
  const braked = new Buggy(0, 0, 90), coasting = new Buggy(0, 0, 90);
  for (const b of [braked, coasting]) for (let i = 0; i < 400; i++) b.step({throttle: 1, brake: 0, steer: 0, turbo: false}, 1 / 30, flat);
  for (let i = 0; i < 30; i++) {
    braked.step({throttle: 0, brake: 1, steer: 0, turbo: false}, 1 / 30, flat);
    coasting.step(NO_DRIVE, 1 / 30, flat);
  }
  expect(braked.speed).toBeLessThan(coasting.speed);
  for (let i = 0; i < 120; i++) braked.step({throttle: 0, brake: 1, steer: 0, turbo: false}, 1 / 30, flat);
  expect(braked.speed).toBeLessThan(0); // holding the brake at a stop backs it up
});

test('a hard turn at speed throws the tail out (slip), and grip pulls it back when you stop steering', () => {
  const b = new Buggy(0, 0, 90);
  for (let i = 0; i < 300; i++) b.step({throttle: 1, brake: 0, steer: 0, turbo: false}, 1 / 30, flat);
  for (let i = 0; i < 20; i++) b.step({throttle: 1, brake: 0, steer: 1, turbo: false}, 1 / 30, flat);
  expect(Math.abs(b.slip)).toBeGreaterThan(0.3);
  for (let i = 0; i < 120; i++) b.step({throttle: 0, brake: 0, steer: 0, turbo: false}, 1 / 30, flat);
  expect(Math.abs(b.slip)).toBeCloseTo(0, 2);
});

test('cresting a ramp fast launches it, and low gravity keeps it up for a while', () => {
  const b = new Buggy(0, 0.014, 90); // just below the crest at lon 0.02
  let peakAltitude = 0, airborneSteps = 0, sawDescent = false;
  for (let i = 0; i < 1200; i++) {
    b.step({throttle: 1, brake: 0, steer: 0, turbo: false}, 1 / 30, ramp);
    if (b.airborne) {airborneSteps++; peakAltitude = Math.max(peakAltitude, b.altitude); if (b.vVert < 0) sawDescent = true;}
  }
  expect(airborneSteps).toBeGreaterThan(10); // it hangs, doesn't just clip one frame
  expect(peakAltitude).toBeGreaterThan(5);
  expect(sawDescent).toBe(true); // and gravity pulls it back down
});

test('driving off a cliff edge puts it in the air and it falls', () => {
  const b = new Buggy(0, 0, 90);
  let sawAir = false;
  for (let i = 0; i < 700; i++) {
    b.step({throttle: 1, brake: 0, steer: 0, turbo: false}, 1 / 30, cliff);
    if (b.airborne) sawAir = true;
  }
  expect(sawAir).toBe(true);
  expect(b.chassisHeight(cliff)).toBeCloseTo(-60, 0); // settled on the lower ground
});

test('longitude wraps cleanly across the antimeridian on a long drive', () => {
  const b = new Buggy(0, 179.999, 90); // heading east, right at the antimeridian
  for (let i = 0; i < 400; i++) b.step({throttle: 1, brake: 0, steer: 0, turbo: true}, 1 / 30, flat);
  expect(b.lon).toBeLessThan(0); // crossed +180 and wrapped to negative longitudes
  expect(b.lon).toBeGreaterThan(-180);
  expect(Number.isNaN(b.lat)).toBe(false);
});
