// Plain float64 3-vectors and quaternions. Physics units: metres, seconds, kilograms, radians.
export type V3 = [number, number, number];
/** Unit quaternion [w, x, y, z], rotating body-frame vectors into the inertial frame. */
export type Quat = [number, number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => scale(a, 1 / (len(a) || 1));
/** a + b * s */
export const addScaled = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export const QUAT_IDENTITY: Quat = [1, 0, 0, 0];

export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

export function quatNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function quatAxisAngle(axis: V3, angle: number): Quat {
  const u = unit(axis), s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), u[0] * s, u[1] * s, u[2] * s];
}

/** Rotate a body-frame vector into the inertial frame. */
export function rotate(q: Quat, v: V3): V3 {
  const [w, x, y, z] = q;
  const t = scale(cross([x, y, z], v), 2);
  return add(add(v, scale(t, w)), cross([x, y, z], t));
}

/** Rotate an inertial vector into the body frame. */
export function rotateInverse(q: Quat, v: V3): V3 {
  return rotate([q[0], -q[1], -q[2], -q[3]], v);
}

/** Advance attitude by a body-frame angular velocity over dt (exact for constant rate). */
export function integrateAttitude(q: Quat, omegaBody: V3, dt: number): Quat {
  const rate = len(omegaBody);
  if (rate * dt < 1e-12) return q;
  return quatNormalize(quatMul(q, quatAxisAngle(omegaBody, rate * dt)));
}

/** Quaternion whose body +Y points along `up` and body +Z along (the component of) `forward`. */
export function quatFromUpForward(up: V3, forward: V3): Quat {
  const y = unit(up), x = unit(cross(y, forward)), z = cross(x, y);
  const m = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  const trace = m[0] + m[4] + m[8];
  let q: Quat;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = [0.25 / s, (m[7] - m[5]) * s, (m[2] - m[6]) * s, (m[3] - m[1]) * s];
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]);
    q = [(m[7] - m[5]) / s, 0.25 * s, (m[3] + m[1]) / s, (m[2] + m[6]) / s];
  } else if (m[4] > m[8]) {
    const s = 2 * Math.sqrt(1 - m[0] + m[4] - m[8]);
    q = [(m[2] - m[6]) / s, (m[3] + m[1]) / s, 0.25 * s, (m[7] + m[5]) / s];
  } else {
    const s = 2 * Math.sqrt(1 - m[0] - m[4] + m[8]);
    q = [(m[3] - m[1]) / s, (m[2] + m[6]) / s, (m[7] + m[5]) / s, 0.25 * s];
  }
  return quatNormalize(q);
}
