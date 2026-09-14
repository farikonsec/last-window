import {type V3, add, dot, len, scale, sub} from './vec';

export interface PortContact {
  /** Closing speed along the target port axis at contact, m/s (positive = approaching). */
  closingSpeed: number;
  /** Radial miss distance of the probe tip from the drogue centre, m. */
  lateralOffset: number;
  lateralSpeed: number;
  /** Angle between the two port axes (0 = perfectly coaxial), degrees. */
  misalignment: number;
  /** Roll error about the port axis relative to the alignment marks, degrees. */
  rollError: number;
  /** Relative angular rate magnitude, degrees/s. */
  angularRate: number;
}

export type DockingOutcome = 'capture' | 'bounce' | 'damage' | 'destroyed';

/** Tunable envelope, loosely based on IDSS-class soft-capture limits. */
export const DOCKING_ENVELOPE = {
  minClosing: 0.03,
  maxClosing: 0.15,
  maxLateral: 0.15,
  maxLateralSpeed: 0.05,
  maxMisalignment: 4,
  maxRoll: 5,
  maxAngularRate: 0.5,
  destroyClosing: 0.5,
  destroyLateral: 0.5,
};

/**
 * Classify a probe-to-drogue contact.
 * destroyed: structural failure (hits hard or far off-centre: hull strikes hull).
 * damage: inside survivable limits but outside the capture envelope (probe bent; retry with less margin).
 * bounce: too gentle to trip the capture latches.
 * capture: soft capture, then hard dock after retraction.
 */
export function classifyContact(c: PortContact, envelope = DOCKING_ENVELOPE): DockingOutcome {
  if (c.closingSpeed > envelope.destroyClosing || c.lateralOffset > envelope.destroyLateral) return 'destroyed';
  if (
    c.closingSpeed > envelope.maxClosing || c.lateralOffset > envelope.maxLateral || c.lateralSpeed > envelope.maxLateralSpeed ||
    c.misalignment > envelope.maxMisalignment || c.rollError > envelope.maxRoll || c.angularRate > envelope.maxAngularRate
  ) return 'damage';
  if (c.closingSpeed < envelope.minClosing) return 'bounce';
  return 'capture';
}

/**
 * Do two spheres touch at any time during a step in which both move linearly?
 * Works in the relative frame so a 2 km/s crossing between integration steps is still caught.
 */
export function sweptSpheresHit(aStart: V3, aEnd: V3, bStart: V3, bEnd: V3, radius: number) {
  const p0 = sub(aStart, bStart), p1 = sub(aEnd, bEnd), d = sub(p1, p0);
  const t = Math.max(0, Math.min(1, -dot(p0, d) / (dot(d, d) || 1)));
  return len(add(p0, scale(d, t))) <= radius;
}
