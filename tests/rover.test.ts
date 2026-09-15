import {expect, test} from 'bun:test';
import {NO_DRIVE, ROVER, Rover} from '../src/sim/rover';

const flat = {height: () => 0};
/** A constant east-facing hill: height rises with longitude. */
const hill = {height: (_lat: number, lon: number) => lon * 20_000};

test('it accelerates to the rated top speed and no further', () => {
  const r = new Rover(26.13, 3.71, 90);
  for (let i = 0; i < 4000; i++) r.step({throttle: 1, brake: 0, steer: 0}, 1 / 30, flat);
  expect(r.speed).toBeCloseTo(ROVER.topSpeed, 2);
});

test('rolling resistance brings it to a stop when you lift off', () => {
  const r = new Rover(26.13, 3.71, 90);
  for (let i = 0; i < 300; i++) r.step({throttle: 1, brake: 0, steer: 0}, 1 / 30, flat);
  expect(r.speed).toBeGreaterThan(0.5);
  for (let i = 0; i < 3000; i++) r.step(NO_DRIVE, 1 / 30, flat);
  expect(r.speed).toBe(0);
});

test('driving east moves it east and steering turns the heading', () => {
  const r = new Rover(0, 0, 90);
  const lon0 = r.lon;
  for (let i = 0; i < 900; i++) r.step({throttle: 1, brake: 0, steer: 0}, 1 / 30, flat);
  expect(r.lon).toBeGreaterThan(lon0);
  expect(Math.abs(r.lat)).toBeLessThan(0.001);
  const heading0 = r.heading;
  for (let i = 0; i < 60; i++) r.step({throttle: 0, brake: 0, steer: 1}, 1 / 30, flat);
  expect(r.heading).toBeGreaterThan(heading0);
});

test('a climb costs speed and the same slope downhill gives it back', () => {
  const up = new Rover(0, 0, 90), down = new Rover(0, 0, 270);
  for (let i = 0; i < 600; i++) {
    up.step({throttle: 1, brake: 0, steer: 0}, 1 / 30, hill);
    down.step({throttle: 1, brake: 0, steer: 0}, 1 / 30, hill);
  }
  expect(down.speed).toBeGreaterThan(up.speed);
});

test('brakes stop it faster than coasting', () => {
  const braked = new Rover(0, 0, 90), coasting = new Rover(0, 0, 90);
  for (const r of [braked, coasting]) for (let i = 0; i < 400; i++) r.step({throttle: 1, brake: 0, steer: 0}, 1 / 30, flat);
  for (let i = 0; i < 30; i++) {
    braked.step({throttle: 0, brake: 1, steer: 0}, 1 / 30, flat);
    coasting.step(NO_DRIVE, 1 / 30, flat);
  }
  expect(braked.speed).toBeLessThan(coasting.speed);
});
