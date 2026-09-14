import {MU, R_MOON} from './constants';
import type {ActuatorCommand} from './bus';
import {summarizeOrbit} from './orbit';
import {type V3, add, clamp, cross, dot, len, rotate, rotateInverse, scale, sub, unit} from './vec';
import {type VehicleSpec, type VehicleState, totalMass} from './vehicle';

/**
 * Rate-limited attitude hold with RCS: turn body +Y toward `up` and body +Z toward `forward`.
 * Returns a rotation demand for the command bus. Used by the reference ascent and by the assisted flying mode.
 */
export function attitudeHold(s: VehicleState, up: V3, forward: V3, maxRate = 0.12, gain = 1.2): V3 {
  const bodyUp = rotate(s.q, [0, 1, 0]), bodyForward = rotate(s.q, [0, 0, 1]);
  const target = unit(up);
  // Small-angle rotation vector that carries the current axes onto the targets.
  const tiltError = cross(bodyUp, target);
  const flatForward = unit(sub(forward, scale(target, dot(forward, target))));
  const rollError = scale(target, dot(cross(bodyForward, flatForward), target));
  const errorBody = rotateInverse(s.q, add(tiltError, rollError));
  const demand: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const desiredRate = clamp(errorBody[i] * 0.8, -maxRate, maxRate);
    demand[i] = clamp((desiredRate - s.w[i]) * gain * 10, -1, 1);
  }
  return demand;
}

export interface AscentTarget {
  /** Altitude at engine cutoff, with zero vertical speed, m. Becomes the periapsis. */
  insertionAltitude: number;
  /** Apoapsis altitude to aim for, m (the mothership's orbit). */
  apoapsisAltitude: number;
  /** Orbit normal of the mothership: ascent steers into this plane. */
  planeNormal: V3;
  /** Seconds of vertical rise before pitch-over. */
  verticalRise: number;
}

export const DEFAULT_ASCENT: Omit<AscentTarget, 'planeNormal'> = {insertionAltitude: 18_000, apoapsisAltitude: 100_000, verticalRise: 10};

export interface GuidanceOutput {
  command: ActuatorCommand;
  /** Inertial unit vector the main engine should push along. */
  thrustDirection: V3;
  phase: 'vertical' | 'pitch' | 'cutoff';
}

/**
 * Reference powered ascent: linear-acceleration altitude guidance (reach insertion altitude with zero vertical speed
 * as horizontal speed builds), in-plane steering with yaw to null out-of-plane velocity, cutoff when the osculating
 * apoapsis reaches the target. It is the "ideal" pilot: used by the launch-window solver, tests and HUD cues.
 */
export function ascentGuidance(spec: VehicleSpec, s: VehicleState, target: AscentTarget, liftoffTime: number): GuidanceOutput {
  const orbit = summarizeOrbit(s.r, s.v);
  const up = unit(s.r);
  const along = unit(cross(target.planeNormal, up));
  const noThrust = (phase: GuidanceOutput['phase']): GuidanceOutput => ({
    command: {throttle: 0, translate: [0, 0, 0], rotate: attitudeHold(s, up, along)},
    thrustDirection: up, phase,
  });
  if (s.status === 'flying' && orbit.apoapsisAltitude >= target.apoapsisAltitude) return noThrust('cutoff');

  const accel = (spec.mainThrust / totalMass(spec, s));
  let direction: V3;
  let phase: GuidanceOutput['phase'];
  if (s.t - liftoffTime < target.verticalRise || s.status === 'landed') {
    direction = up;
    phase = 'vertical';
  } else {
    phase = 'pitch';
    const radius = len(s.r);
    const vh = orbit.horizontalSpeed, vv = orbit.verticalSpeed;
    const effectiveGravity = MU / (radius * radius) - (vh * vh) / radius;
    const vTarget = Math.sqrt(MU * (2 / (R_MOON + target.insertionAltitude) - 2 / (2 * R_MOON + target.insertionAltitude + target.apoapsisAltitude)));
    const tgo = Math.max(8, (vTarget - vh) / (accel * 0.9));
    const dh = target.insertionAltitude - orbit.altitude;
    const verticalDemand = clamp((6 * dh) / (tgo * tgo) - (4 * vv) / tgo + effectiveGravity, -0.2 * accel, 0.95 * accel);
    // Same linear law across the plane: arrive in the mothership's plane (position and velocity) at cutoff,
    // so the site drifting off-plane while the crew waits does not leave a relative inclination.
    const crossTrack = dot(s.r, target.planeNormal), crossTrackRate = dot(s.v, target.planeNormal);
    const lateralDemand = clamp((-6 * crossTrack) / (tgo * tgo) - (4 * crossTrackRate) / tgo, -0.3 * accel, 0.3 * accel);
    const horizontal = Math.sqrt(Math.max(0, accel * accel - verticalDemand ** 2 - lateralDemand ** 2));
    direction = unit(add(add(scale(up, verticalDemand), scale(along, horizontal)), scale(target.planeNormal, lateralDemand)));
  }
  // Throttle back as apoapsis nears target so cutoff lands within a few hundred metres.
  const remaining = target.apoapsisAltitude - Math.max(orbit.apoapsisAltitude, -R_MOON);
  const throttle = s.status === 'landed' || !Number.isFinite(remaining) ? 1 : clamp(remaining / 25_000, 0.04, 1);
  // Keep body +Z (crew forward) pointing downrange so the pilot sees the horizon ahead.
  return {command: {throttle, translate: [0, 0, 0], rotate: attitudeHold(s, direction, along)}, thrustDirection: direction, phase};
}
