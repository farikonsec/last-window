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

test('brakes stop it faster than coasting, then it reverses (Moon braking is weak, so it takes a while)', () => {
  const braked = new Buggy(0, 0, 90), coasting = new Buggy(0, 0, 90);
  for (const b of [braked, coasting]) for (let i = 0; i < 30; i++) b.step({throttle: 1, brake: 0, steer: 0, turbo: false}, 1 / 30, flat);
  for (let i = 0; i < 30; i++) {
    braked.step({throttle: 0, brake: 1, steer: 0, turbo: false}, 1 / 30, flat);
    coasting.step(NO_DRIVE, 1 / 30, flat);
  }
  expect(braked.speed).toBeLessThan(coasting.speed);
  for (let i = 0; i < 600; i++) braked.step({throttle: 0, brake: 1, steer: 0, turbo: false}, 1 / 30, flat);
  expect(braked.speed).toBeLessThan(0); // holding the brake at a stop backs it up
});

test('turbo has no top-speed cap: it keeps building past the motor-only limit while the reserve lasts', () => {
  const b = new Buggy(0, 0, 90);
  let peak = 0;
  for (let i = 0; i < 400; i++) {b.step({throttle: 1, brake: 0, steer: 0, turbo: true}, 1 / 30, flat); peak = Math.max(peak, b.speed);}
  expect(peak).toBeGreaterThan(BUGGY.topSpeed * 1.6); // well past the 200 km/h motor cap
  expect(b.turbo).toBeLessThan(0.5);
});

test('ending turbo leaves the excess speed to bleed away instead of snapping to motor speed', () => {
  const b = new Buggy(0, 0, 90);
  for (let i = 0; i < 180; i++) b.step({throttle: 1, brake: 0, steer: 0, turbo: true}, 1 / 30, flat);
  const boosted = b.speed;
  expect(boosted).toBeGreaterThan(BUGGY.topSpeed);
  b.step({throttle: 1, brake: 0, steer: 0, turbo: false}, 1 / 30, flat);
  expect(b.speed).toBeGreaterThan(BUGGY.topSpeed);
  expect(boosted - b.speed).toBeLessThan(0.1);
});

test('a crest throws it at about sqrt(g*R): slow stays down, fast flies', () => {
  const mPerDeg = BUGGY.radius * (Math.PI / 180), R = 80;
  const crest = {height: (_lat: number, lon: number) => {const x = lon * mPerDeg; return 100 - (x * x) / (2 * R);}};
  const vLaunch = Math.sqrt(BUGGY.gravity * R); // ~11.4 m/s
  const slow = new Buggy(0, 0, 90); slow.speed = 0.6 * vLaunch;
  const fast = new Buggy(0, 0, 90); fast.speed = 1.6 * vLaunch;
  slow.step(NO_DRIVE, 1 / 30, crest); fast.step(NO_DRIVE, 1 / 30, crest);
  expect(slow.airborne).toBe(false);
  expect(fast.airborne).toBe(true);
});

test('a hard turn at high speed rolls it onto a solid side until the crew fire the righting jets', () => {
  const b = new Buggy(0, 0, 90);
  for (let i = 0; i < 200; i++) b.step({throttle: 1, brake: 0, steer: 0, turbo: true}, 1 / 30, flat); // get fast
  for (let i = 0; i < 60 && !b.flipped; i++) b.step({throttle: 0, brake: 0, steer: 1, turbo: false}, 1 / 30, flat);
  expect(b.flipped).toBe(true);
  expect(Math.abs(b.roll)).toBeCloseTo(Math.PI / 2, 4);
  for (let i = 0; i < 120; i++) b.step(NO_DRIVE, 1 / 30, flat); // ~4 s
  expect(b.flipped).toBe(true); // it cannot float upright through solid regolith
  expect(Math.abs(b.roll)).toBeCloseTo(Math.PI / 2, 4);
  for (let i = 0; i < 120 && b.flipped; i++) b.step({...NO_DRIVE, lift: 1}, 1 / 30, flat);
  expect(b.flipped).toBe(false); // R/righting jets deliberately recover it
  expect(Math.abs(b.roll)).toBeLessThan(0.1);
});

test('airborne thrusters lift, accelerate and arrest an unwanted roll', () => {
  const b = new Buggy(0, 0, 90);
  b.airborne = true; b.altitude = 20; b.speed = 10; b.vVert = 0; b.roll = 0.4; b.rollRate = 1.2;
  const reserve = b.turbo;
  for (let i = 0; i < 60; i++) b.step({throttle: 1, brake: 0, steer: 0, turbo: false, lift: 1}, 1 / 30, flat);
  expect(b.airborne).toBe(true);
  expect(b.speed).toBeGreaterThan(20);
  expect(b.vVert).toBeGreaterThan(0);
  expect(Math.abs(b.roll)).toBeLessThan(0.4);
  expect(b.flipped).toBe(false);
  expect(b.turbo).toBeLessThan(reserve);
});

test('a turn throws the tail out (slip), and grip pulls it back when you stop steering', () => {
  const b = new Buggy(0, 0, 90);
  for (let i = 0; i < 40; i++) b.step({throttle: 1, brake: 0, steer: 0, turbo: false}, 1 / 30, flat); // ~15 m/s
  for (let i = 0; i < 15; i++) b.step({throttle: 1, brake: 0, steer: 0.3, turbo: false}, 1 / 30, flat); // gentle enough not to flip
  expect(b.flipped).toBe(false);
  expect(Math.abs(b.slip)).toBeGreaterThan(0.2);
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
