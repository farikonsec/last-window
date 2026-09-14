import * as T from 'three';
import {R_MOON} from '../sim/constants';
import {type V3, dot, len, sub} from '../sim/vec';

export type LabelMode = 'smart' | 'all' | 'off';

export interface LabelItem {
  id: string;
  text: string;
  note: string;
  icon: string;
  kind: string;
  rank: number;
  /** World (Moon-centred EQJ) position, metres; evaluated each frame. */
  position: () => V3;
  /** Distance beyond which `smart` mode hides it, metres. */
  range: number;
  /** Your own craft: the readout would just be the fixed camera-orbit distance, so suppress it. */
  hideDistance?: boolean;
  occluded?: () => boolean;
}

/**
 * Screen-space labels for hardware and named places. Smart mode shows what is near enough to matter for the current
 * altitude, hides anything behind the Moon's limb, and declutters overlaps by rank; All shows every visible label.
 */
export class LabelLayer {
  mode: LabelMode = 'smart';
  private host = document.createElement('div');
  private elements = new Map<string, HTMLElement>();

  constructor(parent: HTMLElement, private items: LabelItem[]) {
    this.host.className = 'labels';
    parent.appendChild(this.host);
    for (const item of items) {
      const el = document.createElement('div');
      el.className = `label kind-${item.kind}`;
      el.innerHTML = `<i>${item.icon}</i><b></b><span></span>`;
      el.querySelector('b')!.textContent = item.text;
      el.title = item.note;
      this.host.appendChild(el);
      this.elements.set(item.id, el);
    }
  }

  update(camera: T.PerspectiveCamera, cameraWorld: V3, altitude: number) {
    const width = innerWidth, height = innerHeight;
    const placed: {x0: number; y0: number; x1: number; y1: number}[] = [];
    const candidates: {item: LabelItem; x: number; y: number; distance: number}[] = [];
    const v = new T.Vector3();
    for (const item of this.items) {
      const el = this.elements.get(item.id)!;
      if (this.mode === 'off') {el.style.display = 'none'; continue;}
      const p = item.position();
      const rel = sub(p, cameraWorld), distance = len(rel);
      v.set(rel[0], rel[1], rel[2]).project(camera);
      const onScreen = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      // Hidden behind the Moon: the sight line passes through the sphere before reaching the point.
      const t = -dot(cameraWorld, rel) / (distance * distance);
      const closest = len([cameraWorld[0] + rel[0] * t, cameraWorld[1] + rel[1] * t, cameraWorld[2] + rel[2] * t]);
      const occluded = t > 0 && t < 0.98 && closest < R_MOON - 3000;
      // Altitude widens the useful horizon, but must not make the whole lunar atlas appear
      // over a nearby spacecraft in orbital cameras.
      const inRange = this.mode === 'all' || distance < Math.max(item.range, altitude * 2.5);
      if (!onScreen || occluded || !inRange || item.occluded?.()) {el.style.display = 'none'; continue;}
      candidates.push({item, x: (v.x + 1) / 2 * width, y: (1 - v.y) / 2 * height, distance});
    }
    candidates.sort((a, b) => b.item.rank - a.item.rank || a.distance - b.distance);
    for (const c of candidates) {
      const el = this.elements.get(c.item.id)!;
      const w = 12 + c.item.text.length * 7.2 + 60, h = 22;
      const box = {x0: c.x - 8, y0: c.y - h, x1: c.x + w, y1: c.y + 4};
      if (this.mode === 'smart' && placed.some(b => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) {
        el.style.display = 'none';
        continue;
      }
      placed.push(box);
      el.style.display = '';
      el.style.transform = `translate(${Math.max(8, Math.min(width - w - 8, c.x)).toFixed(1)}px, ${c.y.toFixed(1)}px)`;
      el.querySelector('span')!.textContent = c.item.hideDistance ? '' : formatDistance(c.distance);
    }
  }
}

export function formatDistance(m: number) {
  if (m < 1000) return `${m.toFixed(0)} m`;
  if (m < 100_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000).toLocaleString('en-GB')} km`;
}
