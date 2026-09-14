import * as Astro from 'astronomy-engine';
import {OMEGA_MOON} from './constants';
import {type V3, add, cross, dot, len, scale, sub, unit} from './vec';

export const AU = 149_597_870_700;
export const EARTH_RADIUS = 6_371_000;
export const SUN_RADIUS = 695_700_000;

const vec = (v: Astro.Vector, factor = AU): V3 => [v.x * factor, v.y * factor, v.z * factor];

/** 3x3 matrix stored as three column vectors: M * v = c0*v0 + c1*v1 + c2*v2. */
export type Mat3 = [V3, V3, V3];
export const apply = (m: Mat3, v: V3): V3 => add(add(scale(m[0], v[0]), scale(m[1], v[1])), scale(m[2], v[2]));
export const applyTranspose = (m: Mat3, v: V3): V3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

/**
 * Sky state for one scenario epoch, in the J2000 equatorial frame (EQJ) centred on the Moon, metres.
 * The simulation's Moon-centred inertial frame (MCI) is tied to EQJ by `mciToEqj`: MCI +Z is the lunar pole and
 * MCI +X the prime meridian at the epoch, both from the IAU rotation model (astronomy-engine RotationAxis).
 */
export interface Sky {
  epoch: Date;
  mciToEqj: Mat3;
  /** Moon -> Sun and Moon -> Earth at the epoch. */
  sun: V3;
  earth: V3;
  /** Earth's rotation: EQJ -> Earth body-fixed (x Greenwich, z north) at the epoch. */
  earthFixedAt(secondsAfterEpoch: number): Mat3;
}

function orientationMatrix(raHours: number, decDeg: number, spinDeg: number): Mat3 {
  const ra = (raHours * Math.PI) / 12, dec = (decDeg * Math.PI) / 180, w = (spinDeg * Math.PI) / 180;
  const pole: V3 = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  // Ascending node of the body equator on the J2000 equator, then turn by the prime-meridian angle.
  const node = unit(cross([0, 0, 1], pole));
  const meridian = add(scale(node, Math.cos(w)), scale(cross(pole, node), Math.sin(w)));
  return [meridian, cross(pole, meridian), pole];
}

export function skyAt(epoch: Date): Sky {
  const moonAxis = Astro.RotationAxis(Astro.Body.Moon, epoch);
  const geoMoon = vec(Astro.GeoMoon(epoch));
  const geoSun = vec(Astro.GeoVector(Astro.Body.Sun, epoch, false));
  return {
    epoch,
    mciToEqj: orientationMatrix(moonAxis.ra, moonAxis.dec, moonAxis.spin),
    sun: sub(geoSun, geoMoon),
    earth: scale(geoMoon, -1),
    earthFixedAt(seconds: number) {
      const date = new Date(epoch.getTime() + seconds * 1000);
      const axis = Astro.RotationAxis(Astro.Body.Earth, date);
      return orientationMatrix(axis.ra, axis.dec, axis.spin);
    },
  };
}

/** MCI position at sim time t (seconds after epoch) -> EQJ. Body-fixed lunar vectors must first go through bodyToInertial. */
export const mciToEqj = (sky: Sky, v: V3) => apply(sky.mciToEqj, v);

/** Moon body-fixed frame -> EQJ at t seconds after the epoch (the Moon turns about its pole). */
export function moonFixedToEqj(sky: Sky, t: number): Mat3 {
  const a = OMEGA_MOON * t, c = Math.cos(a), s = Math.sin(a);
  const [x, y, z] = sky.mciToEqj;
  return [add(scale(x, c), scale(y, s)), add(scale(x, -s), scale(y, c)), z];
}

/** Sun and Earth positions relative to the Moon at t seconds after the epoch, EQJ metres. */
export function bodiesAt(sky: Sky, t: number): {sun: V3; earth: V3} {
  if (t === 0) return {sun: sky.sun, earth: sky.earth};
  const date = new Date(sky.epoch.getTime() + t * 1000);
  const geoMoon = vec(Astro.GeoMoon(date));
  return {sun: sub(vec(Astro.GeoVector(Astro.Body.Sun, date, false)), geoMoon), earth: scale(geoMoon, -1)};
}

export interface HorizonCoordinates {
  /** Degrees clockwise from local north. */
  azimuth: number;
  elevation: number;
}

/** Azimuth/elevation of a target seen from a point on the lunar surface (body-fixed unit, radius in metres). */
export function topocentric(sky: Sky, t: number, siteBodyFixed: V3, siteRadius: number, targetEqj: V3): HorizonCoordinates {
  const frame = moonFixedToEqj(sky, t);
  const up = unit(apply(frame, siteBodyFixed));
  const pole = frame[2];
  const east = unit(cross(pole, up)), north = cross(up, east);
  const d = unit(sub(targetEqj, scale(up, siteRadius)));
  const elevation = (Math.asin(Math.max(-1, Math.min(1, dot(d, up)))) * 180) / Math.PI;
  const azimuth = ((Math.atan2(dot(d, east), dot(d, north)) * 180) / Math.PI + 360) % 360;
  return {azimuth, elevation};
}

/** Fraction of Earth's disc lit as seen from the Moon (0 = new Earth, 1 = full Earth). */
export function earthPhase(sky: Sky, t = 0) {
  const {sun, earth} = bodiesAt(sky, t);
  const toMoon = unit(scale(earth, -1)), toSun = unit(sub(sun, earth));
  return (1 + dot(toMoon, toSun)) / 2;
}

export const angularDiameter = (radius: number, distance: number) => 2 * Math.asin(radius / distance);
export {len};
