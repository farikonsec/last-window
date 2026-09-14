import {MU, R_MOON} from './constants';
import {ascentGuidance, DEFAULT_ASCENT, type AscentTarget} from './guidance';
import {bodyToInertial, type CircularOrbit, circularState, summarizeOrbit, surfaceVelocity} from './orbit';
import {type V3, cross, dot, quatFromUpForward, scale, unit} from './vec';
import {KESTREL, stepVehicle, type VehicleSpec, type VehicleState, type Environment, SMOOTH_MOON} from './vehicle';

/** Physics step used everywhere the game integrates in real time, s. */
export const FLIGHT_DT = 1 / 120;
const COAST_DT = 1;

export interface AscentProfile {
  liftoffTime: number;
  cutoffTime: number;
  /** Time the lander reaches apoapsis, where it meets the mothership. */
  arrivalTime: number;
  arrival: VehicleState;
  propellantUsed: number;
}

/** Lander parked at a body-fixed site, upright, crew facing along `forwardHint`. */
export function landedAt(site: V3, t: number, spec: VehicleSpec = KESTREL, forwardHint: V3 = [0, 0, 1], env: Environment = SMOOTH_MOON): VehicleState {
  const up = unit(bodyToInertial(site, t)), r = scale(up, env.surfaceRadius(site));
  return {
    t, r, v: surfaceVelocity(r), q: quatFromUpForward(up, cross(cross(up, forwardHint), up)), w: [0, 0, 0],
    mainPropellant: spec.mainPropellantCapacity, rcsPropellant: spec.rcsPropellantCapacity,
    batteryKWh: spec.batteryCapacityKWh, status: 'landed',
  };
}

/** Fly the reference ascent from `start` to cutoff, then coast to apoapsis. */
export function simulateReferenceAscent(start: VehicleState, target: AscentTarget, spec: VehicleSpec = KESTREL, env: Environment = SMOOTH_MOON): AscentProfile {
  let s = start;
  const liftoffTime = start.t, initialPropellant = start.mainPropellant;
  while (true) {
    const g = ascentGuidance(spec, s, target, liftoffTime);
    if (g.phase === 'cutoff' || s.t - liftoffTime > 1200) break;
    s = stepVehicle(spec, s, g.command, FLIGHT_DT, env);
    if (s.status === 'crashed') throw new Error(`reference ascent crashed at t=${s.t.toFixed(1)}`);
  }
  const cutoffTime = s.t;
  const idle = {throttle: 0, translate: [0, 0, 0] as V3, rotate: [0, 0, 0] as V3};
  // Coast until vertical speed turns negative: that step contains apoapsis.
  while (summarizeOrbit(s.r, s.v).verticalSpeed > 0 && s.t - cutoffTime < 6000) {
    s = stepVehicle(spec, {...s, w: [0, 0, 0]}, idle, COAST_DT, env);
  }
  return {liftoffTime, cutoffTime, arrivalTime: s.t, arrival: s, propellantUsed: initialPropellant - s.mainPropellant};
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** In-plane angle of a position around a circular orbit, measured from its reference direction. */
export function phaseAngle(orbit: CircularOrbit, r: V3) {
  const q = cross(orbit.normal, orbit.reference);
  return Math.atan2(dot(r, q), dot(r, orbit.reference));
}

export interface LaunchWindow {
  liftoffTime: number;
  profile: AscentProfile;
  /** Along-track separation at arrival, m: positive when the mothership is ahead of the lander. */
  arrivalLead: number;
}

/**
 * Find the next liftoff time at or after `earliest` that makes the reference ascent arrive `lead` metres behind the
 * mothership. Newton iteration on phase error; each iteration re-flies the ascent from the moving site.
 */
export function solveLaunchWindow(site: V3, orbit: CircularOrbit, earliest: number, lead = 1500, spec: VehicleSpec = KESTREL, env: Environment = SMOOTH_MOON): LaunchWindow {
  const target: AscentTarget = {...DEFAULT_ASCENT, apoapsisAltitude: orbit.radius - R_MOON, planeNormal: orbit.normal};
  const n = Math.sqrt(MU / orbit.radius ** 3);
  const leadAngle = lead / orbit.radius;
  const phaseError = (profile: AscentProfile) => {
    const ms = circularState(orbit, profile.arrivalTime);
    return wrapAngle(phaseAngle(orbit, ms.r) - phaseAngle(orbit, profile.arrival.r) - leadAngle);
  };
  let t = earliest;
  let profile = simulateReferenceAscent(landedAt(site, t, spec, [0, 0, 1], env), target, spec, env);
  // First jump: wait until the mothership comes round to the right phase (always forward in time).
  const first = phaseError(profile);
  t += ((((-first) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / n;
  for (let i = 0; i < 4; i++) {
    profile = simulateReferenceAscent(landedAt(site, t, spec, [0, 0, 1], env), target, spec, env);
    const error = phaseError(profile);
    if (Math.abs(error) * orbit.radius < 5) break;
    t -= error / n;
  }
  const ms = circularState(orbit, profile.arrivalTime);
  return {liftoffTime: t, profile, arrivalLead: wrapAngle(phaseAngle(orbit, ms.r) - phaseAngle(orbit, profile.arrival.r)) * orbit.radius};
}

/** Orbit of the waiting mothership: circular, `altitude` high, plane containing the site at `planeTime`. */
export function mothershipOrbit(site: V3, planeTime: number, altitude = 100_000, eastward = true): CircularOrbit {
  const up = unit(bodyToInertial(site, planeTime));
  const east = unit(cross([0, 0, 1], up));
  const normal = unit(eastward ? cross(up, east) : cross(east, up));
  return {radius: R_MOON + altitude, normal, reference: up, epoch: planeTime};
}
