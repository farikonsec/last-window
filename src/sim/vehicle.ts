import {G0, MU, R_MOON} from './constants';
import type {ActuatorCommand} from './bus';
import {bodyToInertial, surfaceVelocity, inertialToBody} from './orbit';
import {type Quat, type V3, add, addScaled, cross, dot, integrateAttitude, len, rotate, rotateInverse, scale, sub, unit} from './vec';

export interface VehicleSpec {
  name: string;
  /** Mass with empty tanks, crew included, kg. */
  dryMass: number;
  mainPropellantCapacity: number;
  rcsPropellantCapacity: number;
  /** Main engine vacuum thrust, N, along body +Y. */
  mainThrust: number;
  mainIsp: number;
  /** Net RCS force per translation axis (two thrusters firing), N. */
  rcsForce: number;
  /** Net RCS torque per rotation axis (two thrusters as a couple), N m. */
  rcsTorque: number;
  rcsIsp: number;
  /** Principal moments of inertia at dry mass, kg m^2 (x, y, z). Scaled with total mass. */
  dryInertia: V3;
  batteryCapacityKWh: number;
  /** Continuous electrical load, kW (life support, avionics, radios). */
  baseLoadKW: number;
  /** Extra load while any engine fires, kW. */
  engineLoadKW: number;
  /** Radius of the collision sphere, m. */
  collisionRadius: number;
}

/**
 * KESTREL ascent stage: fictional, LM-inspired. Sized for a 3.0 km/s delta-v so that a wasted burn can genuinely
 * reach lunar escape (2.38 km/s from the surface). A real Apollo ascent stage had ~2.1 km/s and could not.
 */
export const KESTREL: VehicleSpec = {
  name: 'KESTREL',
  dryMass: 2750,
  mainPropellantCapacity: 5000,
  // Generous for an LM-class vehicle (Apollo carried ~290 kg): the game expects a hand-flown terminal approach.
  rcsPropellantCapacity: 420,
  mainThrust: 30_000,
  mainIsp: 320,
  rcsForce: 890,
  rcsTorque: 1780,
  rcsIsp: 290,
  dryInertia: [9000, 7000, 9000],
  batteryCapacityKWh: 18,
  baseLoadKW: 1.4,
  engineLoadKW: 0.3,
  collisionRadius: 4.5,
};

/** Mothership: fictional 60 m crew vehicle waiting in lunar orbit. */
export const MOTHERSHIP: VehicleSpec = {
  name: 'ARGO',
  dryMass: 21_000,
  mainPropellantCapacity: 9000,
  rcsPropellantCapacity: 600,
  mainThrust: 90_000,
  mainIsp: 314,
  rcsForce: 1780,
  rcsTorque: 12_000,
  rcsIsp: 290,
  dryInertia: [2.2e6, 3.0e5, 2.2e6],
  batteryCapacityKWh: 400,
  baseLoadKW: 4,
  engineLoadKW: 1,
  collisionRadius: 30,
};

export type VehicleStatus = 'landed' | 'flying' | 'crashed' | 'docked';

export interface VehicleState {
  t: number;
  /** Position and velocity in the Moon-centred inertial frame, m and m/s. */
  r: V3;
  v: V3;
  /** Attitude, body -> inertial. */
  q: Quat;
  /** Body angular velocity, rad/s. */
  w: V3;
  mainPropellant: number;
  rcsPropellant: number;
  batteryKWh: number;
  status: VehicleStatus;
  /** Touchdown or impact details once status is 'crashed' or after a landing. */
  contact?: {speed: number; tilt: number};
}

export interface Environment {
  /** Radius of the terrain beneath a body-fixed direction, m. Defaults to a smooth sphere. */
  surfaceRadius(bodyFixedUnit: V3): number;
}

export const SMOOTH_MOON: Environment = {surfaceRadius: () => R_MOON};

export const totalMass = (spec: VehicleSpec, s: VehicleState) => spec.dryMass + s.mainPropellant + s.rcsPropellant;

export function inertia(spec: VehicleSpec, s: VehicleState): V3 {
  return scale(spec.dryInertia, totalMass(spec, s) / spec.dryMass);
}

export const gravity = (r: V3): V3 => scale(r, -MU / len(r) ** 3);

/** Height of the vehicle above the terrain directly below it, m. */
export function altitudeAboveGround(s: VehicleState, env: Environment) {
  const radius = len(s.r);
  return radius - env.surfaceRadius(unit(inertialToBody(s.r, s.t)));
}

/**
 * Advance one vehicle by dt using the given actuator command.
 * Translation: RK4 on gravity plus a thrust acceleration held constant over the step.
 * Rotation: Euler's equations with diagonal inertia, then exact quaternion integration.
 */
export function stepVehicle(spec: VehicleSpec, s: VehicleState, command: ActuatorCommand, dt: number, env: Environment = SMOOTH_MOON): VehicleState {
  if (s.status === 'crashed' || s.status === 'docked') return {...s, t: s.t + dt};

  const mass = totalMass(spec, s);
  // Propellant flow limits: a tank that empties partway through the step delivers only part of the impulse.
  const mainFlow = (command.throttle * spec.mainThrust) / (spec.mainIsp * G0);
  const mainFraction = mainFlow > 0 ? Math.min(1, s.mainPropellant / (mainFlow * dt)) : 0;
  const rcsThrusters = Math.abs(command.translate[0]) + Math.abs(command.translate[1]) + Math.abs(command.translate[2])
    + Math.abs(command.rotate[0]) + Math.abs(command.rotate[1]) + Math.abs(command.rotate[2]);
  const rcsFlow = (rcsThrusters * spec.rcsForce) / (spec.rcsIsp * G0);
  const rcsFraction = rcsFlow > 0 ? Math.min(1, s.rcsPropellant / (rcsFlow * dt)) : 0;

  const bodyForce: V3 = [
    command.translate[0] * spec.rcsForce * rcsFraction,
    command.translate[1] * spec.rcsForce * rcsFraction + command.throttle * spec.mainThrust * mainFraction,
    command.translate[2] * spec.rcsForce * rcsFraction,
  ];
  const thrustAccel = scale(rotate(s.q, bodyForce), 1 / mass);
  const firing = mainFraction * command.throttle > 0 || rcsFraction * rcsThrusters > 0;

  const next: VehicleState = {
    ...s,
    t: s.t + dt,
    mainPropellant: Math.max(0, s.mainPropellant - mainFlow * mainFraction * dt),
    rcsPropellant: Math.max(0, s.rcsPropellant - rcsFlow * rcsFraction * dt),
    batteryKWh: Math.max(0, s.batteryKWh - ((spec.baseLoadKW + (firing ? spec.engineLoadKW : 0)) * dt) / 3600),
  };

  if (s.status === 'landed') {
    const up = unit(s.r);
    const upwardAccel = dot(thrustAccel, up);
    const localGravity = MU / dot(s.r, s.r);
    // Sit on the pad, turning with the Moon, until thrust beats weight.
    if (upwardAccel <= localGravity) {
      next.r = bodyToInertial(s.r, dt);
      next.v = surfaceVelocity(next.r);
      next.w = [0, 0, 0];
      return next;
    }
    next.status = 'flying';
  }

  // RK4 for translation.
  const accel = (r: V3): V3 => add(gravity(r), thrustAccel);
  const k1v = accel(s.r), k1r = s.v;
  const k2v = accel(addScaled(s.r, k1r, dt / 2)), k2r = addScaled(s.v, k1v, dt / 2);
  const k3v = accel(addScaled(s.r, k2r, dt / 2)), k3r = addScaled(s.v, k2v, dt / 2);
  const k4v = accel(addScaled(s.r, k3r, dt)), k4r = addScaled(s.v, k3v, dt);
  next.r = addScaled(s.r, add(add(k1r, scale(add(k2r, k3r), 2)), k4r), dt / 6);
  next.v = addScaled(s.v, add(add(k1v, scale(add(k2v, k3v), 2)), k4v), dt / 6);

  // Rotation: I dw/dt = tau - w x (I w).
  const I = inertia(spec, s);
  const torque = scale(command.rotate, spec.rcsTorque * rcsFraction);
  const Iw: V3 = [I[0] * s.w[0], I[1] * s.w[1], I[2] * s.w[2]];
  const gyro = cross(s.w, Iw);
  next.w = [
    s.w[0] + ((torque[0] - gyro[0]) / I[0]) * dt,
    s.w[1] + ((torque[1] - gyro[1]) / I[1]) * dt,
    s.w[2] + ((torque[2] - gyro[2]) / I[2]) * dt,
  ];
  next.q = integrateAttitude(s.q, next.w, dt);

  // Terrain contact.
  if (altitudeAboveGround(next, env) <= 0) {
    const up = unit(next.r);
    const relative = sub(next.v, surfaceVelocity(next.r));
    const speed = len(relative);
    const tilt = Math.acos(Math.max(-1, Math.min(1, dot(rotate(next.q, [0, 1, 0]), up))));
    next.contact = {speed, tilt};
    const ground = env.surfaceRadius(unit(inertialToBody(next.r, next.t)));
    next.r = scale(up, ground);
    if (speed <= 3 && tilt <= (12 * Math.PI) / 180) {
      next.status = 'landed';
      next.v = surfaceVelocity(next.r);
      next.w = [0, 0, 0];
    } else {
      next.status = 'crashed';
      next.v = [0, 0, 0];
    }
  }
  return next;
}

/** Body-frame velocity relative to another state (e.g. the docking target), for displays. */
export function relativeVelocityInBody(s: VehicleState, target: VehicleState): V3 {
  return rotateInverse(s.q, sub(s.v, target.v));
}
