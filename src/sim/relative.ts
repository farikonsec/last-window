import {MU} from './constants';
import {type V3, cross, dot, len, scale, sub, unit} from './vec';

/**
 * Local-vertical local-horizontal frame of a target (chief) on a near-circular orbit:
 * x radial (up), y along-track (V-bar, direction of motion), z orbit normal (H-bar).
 */
export interface LvlhState {
  position: V3;
  velocity: V3;
}

export function toLvlh(chiefR: V3, chiefV: V3, deputyR: V3, deputyV: V3): LvlhState {
  const x = unit(chiefR), h = cross(chiefR, chiefV), z = unit(h), y = cross(z, x);
  const omega = scale(h, 1 / dot(chiefR, chiefR));
  const dr = sub(deputyR, chiefR);
  // Velocity seen from the rotating frame.
  const dv = sub(sub(deputyV, chiefV), cross(omega, dr));
  return {position: [dot(dr, x), dot(dr, y), dot(dr, z)], velocity: [dot(dv, x), dot(dv, y), dot(dv, z)]};
}

export const meanMotion = (radius: number) => Math.sqrt(MU / radius ** 3);

/** Clohessy-Wiltshire closed-form propagation of relative motion about a circular orbit with mean motion n. */
export function propagateCW(state: LvlhState, n: number, t: number): LvlhState {
  const [x0, y0, z0] = state.position, [vx0, vy0, vz0] = state.velocity;
  const s = Math.sin(n * t), c = Math.cos(n * t);
  return {
    position: [
      (4 - 3 * c) * x0 + (s / n) * vx0 + (2 / n) * (1 - c) * vy0,
      6 * (s - n * t) * x0 + y0 + (2 / n) * (c - 1) * vx0 + ((4 * s - 3 * n * t) / n) * vy0,
      c * z0 + (s / n) * vz0,
    ],
    velocity: [
      3 * n * s * x0 + c * vx0 + 2 * s * vy0,
      6 * n * (c - 1) * x0 - 2 * s * vx0 + (4 * c - 3) * vy0,
      -n * s * z0 + c * vz0,
    ],
  };
}

export interface ApproachSummary {
  range: number;
  /** Negative when closing, m/s. */
  rangeRate: number;
  /** Time and distance of the predicted closest approach (CW, within the horizon). */
  closestTime: number;
  closestDistance: number;
}

export function predictApproach(state: LvlhState, n: number, horizon = 900, step = 1): ApproachSummary {
  const range = len(state.position);
  let closestTime = 0, closestDistance = range;
  for (let t = step; t <= horizon; t += step) {
    const d = len(propagateCW(state, n, t).position);
    if (d < closestDistance) {closestDistance = d; closestTime = t;}
  }
  return {range, rangeRate: range > 0 ? dot(state.position, state.velocity) / range : 0, closestTime, closestDistance};
}

/** Braking gates for terminal approach: maximum safe closing speed at a given range, m/s. */
export function brakingLimit(range: number) {
  if (range > 1000) return Math.min(30, 10 + (range - 1000) / 500);
  if (range > 100) return 1 + ((range - 100) / 900) * 9;
  if (range > 10) return 0.3 + ((range - 10) / 90) * 0.7;
  return 0.15 + (range / 10) * 0.15;
}
