import {MU, R_MOON, OMEGA_MOON} from './constants';
import {type V3, cross, dot, len, scale, sub, unit, add} from './vec';

export interface OrbitSummary {
  /** Specific orbital energy v^2/2 - mu/r, J/kg. Negative = bound. */
  energy: number;
  eccentricity: number;
  /** Semi-major axis, m (negative when hyperbolic). */
  semiMajorAxis: number;
  /** Periapsis and apoapsis altitudes above the mean radius, m. Apoapsis is Infinity when unbound. */
  periapsisAltitude: number;
  apoapsisAltitude: number;
  /** Orbital period, s (Infinity when unbound). */
  period: number;
  bound: boolean;
  altitude: number;
  verticalSpeed: number;
  horizontalSpeed: number;
  /** Flight-path angle above the local horizontal, rad. */
  flightPathAngle: number;
}

export function summarizeOrbit(r: V3, v: V3): OrbitSummary {
  const radius = len(r), speed = len(v);
  const energy = (speed * speed) / 2 - MU / radius;
  const h = cross(r, v);
  const eVec = sub(scale(cross(v, h), 1 / MU), unit(r));
  const eccentricity = len(eVec);
  const bound = energy < 0;
  const semiMajorAxis = -MU / (2 * energy);
  const p = dot(h, h) / MU;
  const rp = p / (1 + eccentricity);
  const ra = bound ? p / (1 - eccentricity) : Infinity;
  const verticalSpeed = dot(v, r) / radius;
  const horizontalSpeed = Math.sqrt(Math.max(0, speed * speed - verticalSpeed * verticalSpeed));
  return {
    energy, eccentricity, semiMajorAxis, bound,
    periapsisAltitude: rp - R_MOON,
    apoapsisAltitude: ra - R_MOON,
    period: bound ? 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / MU) : Infinity,
    altitude: radius - R_MOON,
    verticalSpeed, horizontalSpeed,
    flightPathAngle: Math.atan2(verticalSpeed, horizontalSpeed),
  };
}

/** Unit vector for selenographic latitude/longitude (degrees) in the body-fixed frame. */
export function latLonToUnit(latDeg: number, lonDeg: number): V3 {
  const lat = (latDeg * Math.PI) / 180, lon = (lonDeg * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

/** Body-fixed vector to MCI at sim time t (the Moon turns about +Z). */
export function bodyToInertial(p: V3, t: number): V3 {
  const a = OMEGA_MOON * t, c = Math.cos(a), s = Math.sin(a);
  return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
}

export function inertialToBody(p: V3, t: number): V3 {
  return bodyToInertial(p, -t);
}

/** Inertial velocity of a point fixed to the lunar surface. */
export function surfaceVelocity(rInertial: V3): V3 {
  return cross([0, 0, OMEGA_MOON], rInertial);
}

export interface CircularOrbit {
  radius: number;
  /** Unit orbit normal (angular momentum direction). */
  normal: V3;
  /** Unit vector to the orbiting body at t = epoch. */
  reference: V3;
  epoch: number;
}

/** Exact state on a circular orbit at time t. */
export function circularState(orbit: CircularOrbit, t: number): {r: V3; v: V3} {
  const n = Math.sqrt(MU / orbit.radius ** 3), angle = n * (t - orbit.epoch);
  const p = orbit.reference, q = cross(orbit.normal, p);
  const c = Math.cos(angle), s = Math.sin(angle);
  const dir = add(scale(p, c), scale(q, s)), tangent = add(scale(p, -s), scale(q, c));
  return {r: scale(dir, orbit.radius), v: scale(tangent, Math.sqrt(MU / orbit.radius))};
}
