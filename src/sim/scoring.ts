/**
 * Scores a completed docking run. Pure so it can be tested without a browser and shown on the debrief card.
 * Four components, each 0..100, averaged into a medal: how gently the ports met, how squarely they lined up,
 * how much manoeuvring propellant is left, and how quickly the whole rendezvous was flown.
 */
import {KESTREL} from './vehicle';

export interface DockRun {
  /** Closing speed at the moment of soft capture, m/s. */
  closingSpeed: number;
  /** Off-axis miss distance at contact, m. */
  lateral: number;
  /** Angle between the two docking axes at contact, degrees. */
  misalignment: number;
  /** RCS propellant left at capture, kg. */
  rcsLeft: number;
  /** Seconds from liftoff to capture. */
  seconds: number;
}

export type Medal = 'gold' | 'silver' | 'bronze';
export const medalFor = (total: number): Medal => (total >= 90 ? 'gold' : total >= 70 ? 'silver' : 'bronze');

/** 100 at or below `gold`, easing down through `silver` to a 30 floor past `bronze`. */
const band = (value: number, gold: number, silver: number, bronze: number) =>
  value <= gold ? 100
    : value <= silver ? 75 + (25 * (silver - value)) / (silver - gold)
      : value <= bronze ? 45 + (30 * (bronze - value)) / (bronze - silver)
        : 30;

export interface LandingRun {
  /** Touchdown speed relative to the ground, m/s. */
  speed: number;
  /** Tilt off vertical at touchdown, degrees. */
  tilt: number;
  /** Distance from the intended pad, m. */
  distance: number;
  /** Main propellant left at touchdown, kg. */
  mainLeft: number;
  /** Seconds from powered-descent initiation to touchdown. */
  seconds: number;
}

export interface ScorePart {label: string; value: string; score: number}

export function scoreDock(r: DockRun): {parts: ScorePart[]; total: number; medal: Medal} {
  const rcsUsedPct = (100 * (KESTREL.rcsPropellantCapacity - r.rcsLeft)) / KESTREL.rcsPropellantCapacity;
  const parts: ScorePart[] = [
    {label: 'Contact', value: `${r.closingSpeed.toFixed(2)} m/s`, score: band(r.closingSpeed, 0.08, 0.2, 0.35)},
    {label: 'Alignment', value: `${r.lateral.toFixed(2)} m · ${r.misalignment.toFixed(0)}°`, score: (band(r.lateral, 0.15, 0.6, 1.2) + band(r.misalignment, 3, 8, 15)) / 2},
    {label: 'RCS used', value: `${rcsUsedPct.toFixed(0)}%`, score: band(rcsUsedPct, 8, 25, 55)},
    {label: 'Time', value: `${Math.round(r.seconds)} s`, score: band(r.seconds, 600, 1200, 2400)},
  ];
  const total = Math.round(parts.reduce((a, p) => a + p.score, 0) / parts.length);
  return {parts, total, medal: medalFor(total)};
}

/**
 * Scores a completed landing: how gently it touched, how upright it stayed, how close to the pad it came down, and
 * how much descent propellant is left for the record.
 */
export function scoreLanding(r: LandingRun): {parts: ScorePart[]; total: number; medal: Medal} {
  const leftPct = (100 * r.mainLeft) / KESTREL.mainPropellantCapacity;
  const parts: ScorePart[] = [
    {label: 'Touchdown', value: `${r.speed.toFixed(2)} m/s`, score: band(r.speed, 1, 2, 3)},
    {label: 'Attitude', value: `${r.tilt.toFixed(1)}°`, score: band(r.tilt, 2, 6, 12)},
    {label: 'Precision', value: `${r.distance < 1000 ? `${r.distance.toFixed(0)} m` : `${(r.distance / 1000).toFixed(1)} km`}`, score: band(r.distance, 300, 2000, 12_000)},
    {label: 'Propellant left', value: `${leftPct.toFixed(0)}%`, score: band(40 - leftPct, 10, 22, 34)},
    {label: 'Time', value: `${Math.round(r.seconds)} s`, score: band(r.seconds, 700, 1000, 1500)},
  ];
  const total = Math.round(parts.reduce((a, p) => a + p.score, 0) / parts.length);
  return {parts, total, medal: medalFor(total)};
}
