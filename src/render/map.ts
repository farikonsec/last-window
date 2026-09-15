import type {LunarTerrain} from '../sim/terrain';

export interface MapMarker {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: string;
}

export type MapMode = 'local' | 'moon' | 'off';

const SIZE = 280;
const LOCAL_HALF = 20_000; // metres either side of the centre in local mode

/**
 * Navigation map panel. Local: a 40 km hillshade of the surveyed terrain around the camera's region, north up.
 * Moon: the whole LROC colour map with every atlas site. Markers are clickable; the camera marker shows heading.
 */
export class LunarMap {
  mode: MapMode = 'local';
  track: {lat: number; lon: number}[] = [];
  /** When set, the local map recenters on this point and zooms in, so a driven vehicle's motion is visible. */
  follow: {lat: number; lon: number} | null = null;
  /** Half-extent, metres, of the zoomed local view while following (5 km box shows the buggy actually moving). */
  followHalf = 2500;
  onSelect: (marker: MapMarker) => void = () => {};
  private activeCentre: {lat: number; lon: number};
  private activeHalf = LOCAL_HALF;
  private panel = document.createElement('section');
  private canvas = document.createElement('canvas');
  private foot = document.createElement('div');
  private title = document.createElement('button');
  private hillshade: HTMLCanvasElement;
  private moonImage = new Image();
  private centre: {lat: number; lon: number};
  private hover: MapMarker | null = null;

  constructor(parent: HTMLElement, private terrain: LunarTerrain, private markers: MapMarker[], moonUrl: string) {
    this.panel.className = 'map-panel';
    this.title.className = 'map-title';
    this.canvas.width = this.canvas.height = SIZE;
    this.foot.className = 'map-foot';
    this.panel.append(this.title, this.canvas, this.foot);
    parent.appendChild(this.panel);
    this.moonImage.src = moonUrl;
    this.centre = {lat: terrain.anchorLat, lon: terrain.anchorLon};
    this.activeCentre = this.centre;
    this.hillshade = this.buildHillshade();
    this.title.onclick = () => this.cycle();
    this.canvas.addEventListener('mousemove', e => {this.hover = this.pick(e); this.canvas.style.cursor = this.hover ? 'pointer' : 'default';});
    this.canvas.addEventListener('click', e => {const m = this.pick(e); if (m) this.onSelect(m);});
  }

  cycle() {
    this.mode = this.mode === 'local' ? 'moon' : this.mode === 'moon' ? 'off' : 'local';
  }

  /** Terrain-local hillshade (sun from the east, like the scenario morning) over the 40 km box. */
  private buildHillshade() {
    const n = 200, c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d')!, img = g.createImageData(n, n);
    const origin = this.terrain.toLocal(this.centre.lat, this.centre.lon), step = (2 * LOCAL_HALF) / n;
    const H = (i: number, j: number) => {const p = this.terrain.fromLocal(origin.x - LOCAL_HALF + i * step, origin.y + LOCAL_HALF - j * step); return this.terrain.surveyed(p.lat, p.lon);};
    let lo = Infinity, hi = -Infinity;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {const h = H(i, j); heights[j * n + i] = h; lo = Math.min(lo, h); hi = Math.max(hi, h);}
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const h = heights[j * n + i];
      const dx = (heights[j * n + Math.min(n - 1, i + 1)] - heights[j * n + Math.max(0, i - 1)]) / (2 * step);
      const dy = (heights[Math.max(0, j - 1) * n + i] - heights[Math.min(n - 1, j + 1) * n + i]) / (2 * step);
      const shade = Math.max(0, Math.min(1, 0.55 + dx * 1.6 - dy * 0.3));
      const tone = 0.35 + 0.65 * (h - lo) / (hi - lo || 1);
      const v = Math.round(255 * (0.25 + 0.75 * shade) * (0.7 + 0.3 * tone));
      img.data.set([v, v * 0.98, v * 0.94, 255], (j * n + i) * 4);
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  private toCanvas(lat: number, lon: number): [number, number] | null {
    if (this.mode === 'moon') return [((lon + 180) / 360) * SIZE, 70 + ((90 - lat) / 180) * (SIZE / 2)];
    const o = this.terrain.toLocal(this.activeCentre.lat, this.activeCentre.lon), p = this.terrain.toLocal(lat, lon), half = this.activeHalf;
    const x = (p.x - o.x + half) / (2 * half) * SIZE, y = (half - (p.y - o.y)) / (2 * half) * SIZE;
    return x < -10 || y < -10 || x > SIZE + 10 || y > SIZE + 10 ? null : [x, y];
  }

  private pick(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect(), mx = (e.clientX - r.left) * SIZE / r.width, my = (e.clientY - r.top) * SIZE / r.height;
    let best: MapMarker | null = null, bestD = 10;
    for (const m of this.markers) {
      const p = this.toCanvas(m.lat, m.lon);
      if (!p) continue;
      const d = Math.hypot(p[0] - mx, p[1] - my);
      if (d < bestD) {best = m; bestD = d;}
    }
    return best;
  }

  draw(camera: {lat: number; lon: number; heading: number}) {
    this.panel.hidden = this.mode === 'off';
    if (this.mode === 'off') return;
    // Follow (drive) mode: recenter the local map on the vehicle and zoom in so its movement actually shows.
    const following = this.mode === 'local' && this.follow !== null;
    this.activeCentre = following ? this.follow! : this.centre;
    this.activeHalf = following ? this.followHalf : LOCAL_HALF;
    this.title.textContent = this.mode !== 'local' ? 'MOON ⇄' : following ? `HADLEY · ${(this.followHalf * 2 / 1000).toFixed(1)} km ⇄` : 'HADLEY · 40 km ⇄';
    const g = this.canvas.getContext('2d')!;
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, SIZE, SIZE);
    if (this.mode === 'local') {
      // Crop the prebuilt 40 km hillshade to the active window (no per-frame rebuild).
      const o = this.terrain.toLocal(this.centre.lat, this.centre.lon), c = this.terrain.toLocal(this.activeCentre.lat, this.activeCentre.lon);
      const hw = this.hillshade.width, hh = this.hillshade.height;
      const cx = (c.x - o.x + LOCAL_HALF) / (2 * LOCAL_HALF) * hw, cy = (LOCAL_HALF - (c.y - o.y)) / (2 * LOCAL_HALF) * hh;
      const hp = this.activeHalf / (2 * LOCAL_HALF) * hw;
      g.imageSmoothingEnabled = true;
      g.drawImage(this.hillshade, cx - hp, cy - hp, 2 * hp, 2 * hp, 0, 0, SIZE, SIZE);
    } else if (this.moonImage.complete && this.moonImage.naturalWidth > 0) g.drawImage(this.moonImage, 0, 70, SIZE, SIZE / 2);
    g.strokeStyle = '#78d9ea'; g.lineWidth = 1; g.setLineDash([3, 4]); g.beginPath();
    let lastPoint: [number, number] | null = null;
    for (const point of this.track) {
      const p = this.toCanvas(point.lat, point.lon);
      if (!p) {lastPoint = null; continue;}
      if (!lastPoint || Math.abs(p[0] - lastPoint[0]) > SIZE / 2) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
      lastPoint = p;
    }
    g.stroke(); g.setLineDash([]);
    const textBoxes: {x: number; y: number; w: number}[] = [];
    for (const m of this.markers) {
      const p = this.toCanvas(m.lat, m.lon);
      if (!p) continue;
      const colour = m.kind === 'base' ? '#9fffb8' : m.kind === 'apollo' ? '#ffd36b' : m.kind === 'hardware' ? '#ffffff' : m.kind === 'lander' || m.kind === 'rover' ? '#8fd3ff' : '#c9c3b8';
      g.fillStyle = colour;
      g.beginPath();
      g.arc(p[0], p[1], m === this.hover ? 4.5 : 3, 0, Math.PI * 2);
      g.fill();
      if (m === this.hover || (this.mode === 'local' && (m.kind === 'base' || m.kind === 'apollo'))) {
        g.font = '10px ui-monospace, Menlo, monospace';
        const text = m.name.toUpperCase();
        const x = m.kind === 'base' ? p[0] + 6 : p[0] - g.measureText(text).width - 6;
        const box = {x: Math.max(3, Math.min(SIZE - g.measureText(text).width - 3, x)), y: p[1] - 8, w: g.measureText(text).width};
        if (m === this.hover || !textBoxes.some(b => Math.abs(b.y - box.y) < 12 && box.x < b.x + b.w && box.x + box.w > b.x)) {g.fillText(text, box.x, box.y); textBoxes.push(box);}
      }
    }
    const me = this.toCanvas(camera.lat, camera.lon);
    if (me) {
      // Live position: a bold red heading arrow with a dark outline and a soft glow so it stands out on any terrain.
      g.save();
      g.translate(me[0], me[1]);
      g.rotate(camera.heading * Math.PI / 180);
      g.shadowColor = '#ff2e2eaa'; g.shadowBlur = 8;
      g.fillStyle = '#ff2e2e'; g.strokeStyle = '#2a0000'; g.lineWidth = 1.5; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 8); g.lineTo(0, 3.5); g.lineTo(-7, 8); g.closePath();
      g.fill(); g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = '#ffd9d9'; g.beginPath(); g.arc(0, -1, 1.6, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    this.foot.textContent = this.hover ? `${this.hover.name} · ${this.hover.lat.toFixed(2)}°, ${this.hover.lon.toFixed(2)}°E · click to go` : `YOU ${camera.lat.toFixed(3)}°, ${camera.lon.toFixed(3)}°E`;
  }
}
