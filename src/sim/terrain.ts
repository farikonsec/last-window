import {R_MOON} from './constants';
import type {V3} from './vec';

const DEG = Math.PI / 180;

/** Equirectangular elevation grid: little-endian int16 metres, row 0 at the north edge, pixel registered. */
export interface ElevationGrid {
  heights: Int16Array;
  width: number;
  height: number;
  /** North edge latitude and west edge longitude, degrees; pixels per degree. */
  north: number;
  west: number;
  ppd: number;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

/** Bicubic (Catmull-Rom) height at lat/lon. Longitude wraps for global grids; latitude clamps. */
export function sampleGrid(g: ElevationGrid, latDeg: number, lonDeg: number, cubic = true) {
  let x = (lonDeg - g.west) * g.ppd - 0.5;
  const global = Math.abs(g.width / g.ppd - 360) < 1e-6;
  if (global) x = ((x % g.width) + g.width) % g.width;
  const y = Math.max(0, Math.min(g.height - 1, (g.north - latDeg) * g.ppd - 0.5));
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const at = (i: number, j: number) => {
    const jj = Math.max(0, Math.min(g.height - 1, j));
    const ii = global ? ((i % g.width) + g.width) % g.width : Math.max(0, Math.min(g.width - 1, i));
    return g.heights[jj * g.width + ii];
  };
  if (!cubic) {
    const top = at(xi, yi) * (1 - fx) + at(xi + 1, yi) * fx;
    const bottom = at(xi, yi + 1) * (1 - fx) + at(xi + 1, yi + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  }
  const row = (j: number) => catmullRom(at(xi - 1, j), at(xi, j), at(xi + 1, j), at(xi + 2, j), fx);
  return catmullRom(row(yi - 1), row(yi), row(yi + 1), row(yi + 2), fy);
}

// Deterministic hashing: 32-bit integer mix of (level, cell x, cell y, salt) to [0, 1).
function hash(level: number, ix: number, iy: number, salt: number) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(level + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Procedural crater population below the survey resolution. Each level is a grid of cells; a cell holds at most one
 * simple crater. Mare surfaces at Hadley are ~3.3 billion years old and saturated with small craters, so most are
 * degraded (shallow, rimless) and a few are fresh (bowl d/D 0.16, rim 0.04 D, bright ejecta).
 */
export const CRATER_LEVELS = [
  {cell: 380, probability: 0.28},
  {cell: 120, probability: 0.38},
  {cell: 38, probability: 0.45},
  {cell: 12, probability: 0.5},
  {cell: 3.8, probability: 0.5},
  {cell: 1.2, probability: 0.45},
];

export interface SurfaceSample {
  /** Height above the 1737.4 km reference sphere, metres. */
  height: number;
  /** 0..1 brightness boost from fresh crater ejecta (albedo cue, used for rock density too). */
  ejecta: number;
}

export interface TerrainOptions {
  /** Surveyed regional grid (SLDEM2015 around the site). */
  region: ElevationGrid;
  /** Global grid for everything outside the region. */
  globe: ElevationGrid;
  /** Anchor for local metric coordinates, degrees. */
  anchorLat: number;
  anchorLon: number;
}

/**
 * The single lunar surface function. Physics collision, the terrain meshes, rock placement and the landing pad all
 * read it, so what you see is what you hit.
 * height = surveyed elevation (SLDEM2015 bicubic inside the region, LOLA globe outside, blended at the border)
 *        + procedural craters and regolith undulation below the survey resolution.
 * `minFeature` band-limits the procedural part: coarse distant geometry drops features smaller than ~3 vertex spacings.
 */
export class LunarTerrain {
  readonly region: ElevationGrid;
  readonly globe: ElevationGrid;
  anchorLat: number;
  anchorLon: number;
  private readonly metresPerDegLat = R_MOON * DEG;
  private metresPerDegLon: number;
  private readonly regionBounds: {south: number; east: number};
  /** Flattened pads: local x, y (m), radius (m) and blend width. Heights inside are held level. */
  private pads: {x: number; y: number; radius: number; blend: number; height: number}[] = [];

  constructor(options: TerrainOptions) {
    this.region = options.region;
    this.globe = options.globe;
    this.anchorLat = options.anchorLat;
    this.anchorLon = options.anchorLon;
    this.metresPerDegLon = R_MOON * DEG * Math.cos(options.anchorLat * DEG);
    this.regionBounds = {south: this.region.north - this.region.height / this.region.ppd, east: this.region.west + this.region.width / this.region.ppd};
  }

  /** Move the tangent-plane origin to a new point so the clipmap can render anywhere on the globe (the projection is
   * only accurate near its anchor, so the caller re-anchors as the camera roams). Longitude scale follows the anchor. */
  reanchor(latDeg: number, lonDeg: number) {
    this.anchorLat = latDeg;
    this.anchorLon = lonDeg;
    this.metresPerDegLon = R_MOON * DEG * Math.cos(latDeg * DEG);
  }

  toLocal(latDeg: number, lonDeg: number) {
    // Longitude difference wrapped to [-180, 180] so a clipmap that has re-anchored near the antimeridian is continuous.
    const dLon = (((lonDeg - this.anchorLon + 540) % 360) - 180);
    return {x: dLon * this.metresPerDegLon, y: (latDeg - this.anchorLat) * this.metresPerDegLat};
  }

  fromLocal(x: number, y: number) {
    return {lat: this.anchorLat + y / this.metresPerDegLat, lon: this.anchorLon + x / this.metresPerDegLon};
  }

  /** Surveyed elevation only (no procedural detail), metres. */
  surveyed(latDeg: number, lonDeg: number) {
    const r = this.region, b = this.regionBounds;
    const globe = sampleGrid(this.globe, latDeg, lonDeg, false);
    const border = 0.12; // degrees of blend inside the region edge
    const inside = Math.min(latDeg - b.south, r.north - latDeg, lonDeg - r.west, b.east - lonDeg);
    if (inside <= 0) return globe;
    const regional = sampleGrid(r, latDeg, lonDeg, true);
    if (inside >= border) return regional;
    const t = inside / border, w = t * t * (3 - 2 * t);
    return globe + (regional - globe) * w;
  }

  sample(latDeg: number, lonDeg: number, minFeature = 0): SurfaceSample {
    const {x, y} = this.toLocal(latDeg, lonDeg);
    let height = this.surveyed(latDeg, lonDeg), ejecta = 0;
    for (let level = 0; level < CRATER_LEVELS.length; level++) {
      const {cell, probability} = CRATER_LEVELS[level];
      if (cell * 0.9 < minFeature * 3) break; // largest crater in this level is below the band limit
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const ix = cx + i, iy = cy + j;
        if (hash(level, ix, iy, 0) > probability) continue;
        const radius = cell * (0.12 + 0.33 * hash(level, ix, iy, 1) ** 1.6);
        if (radius * 2 < minFeature * 3) continue;
        const margin = cell * 0.5;
        const px = (ix + 0.5) * cell + (hash(level, ix, iy, 2) - 0.5) * margin;
        const py = (iy + 0.5) * cell + (hash(level, ix, iy, 3) - 0.5) * margin;
        const rho = Math.hypot(x - px, y - py) / radius;
        if (rho > 2.5) continue;
        const age = hash(level, ix, iy, 4) ** 0.5; // skewed old: most small mare craters are degraded
        const diameter = radius * 2;
        // Fresh simple craters: d/D ~0.16 with ~40 degree upper walls; degraded ones shallow out to ~0.04.
        const depth = diameter * (0.16 - 0.1 * age);
        const rim = diameter * 0.04 * (1 - age) ** 1.5;
        if (rho < 1) {
          const p = 2 + 0.3 * (1 - age);
          const rp = rho ** p;
          height += -depth * (1 - rp) + rim * rp;
        } else {
          height += rim * Math.exp(-(rho - 1) / 0.22);
        }
        if (age < 0.35) ejecta = Math.max(ejecta, (1 - age / 0.35) * Math.exp(-Math.max(0, rho - 0.9) * 1.6) * (rho < 0.85 ? 0.5 : 1));
      }
    }
    height += this.undulation(x, y, minFeature);
    if (this.pads.length) height = this.applyPads(x, y, height);
    return {height, ejecta};
  }

  height(latDeg: number, lonDeg: number, minFeature = 0) {
    return this.sample(latDeg, lonDeg, minFeature).height;
  }

  /** Physics interface: radius of the ground beneath a body-fixed unit direction. */
  surfaceRadius(dir: V3) {
    const lat = Math.asin(Math.max(-1, Math.min(1, dir[2]))) / DEG;
    const lon = Math.atan2(dir[1], dir[0]) / DEG;
    return R_MOON + this.height(lat, lon);
  }

  /** Hold the ground level inside a circle (landing pad); returns the pad height used. */
  addPad(latDeg: number, lonDeg: number, radius: number, blend = 6) {
    const {x, y} = this.toLocal(latDeg, lonDeg);
    // Level at the mean natural height across the pad so it neither floats nor sinks.
    let sum = 0, count = 0;
    for (let a = 0; a < 8; a++) for (const f of [0, 0.5, 1]) {
      const p = this.fromLocal(x + Math.cos(a * Math.PI / 4) * radius * f, y + Math.sin(a * Math.PI / 4) * radius * f);
      sum += this.sample(p.lat, p.lon).height; count++;
    }
    const height = sum / count;
    this.pads.push({x, y, radius, blend, height});
    return height;
  }

  private applyPads(x: number, y: number, height: number) {
    for (const pad of this.pads) {
      const d = Math.hypot(x - pad.x, y - pad.y);
      if (d >= pad.radius + pad.blend) continue;
      const t = Math.max(0, Math.min(1, (d - pad.radius) / pad.blend)), w = t * t * (3 - 2 * t);
      height = pad.height + (height - pad.height) * w;
    }
    return height;
  }

  /** Gentle regolith undulation (value-noise fBm), band-limited like the craters. */
  private undulation(x: number, y: number, minFeature: number) {
    let sum = 0;
    const octaves: [number, number][] = [[24, 0.35], [7, 0.1], [2.2, 0.035], [0.7, 0.012]];
    for (let o = 0; o < octaves.length; o++) {
      const [wavelength, amplitude] = octaves[o];
      if (wavelength < minFeature * 3) break;
      sum += amplitude * (valueNoise(x / wavelength, y / wavelength, 90 + o) * 2 - 1);
    }
    return sum;
  }
}

function valueNoise(x: number, y: number, salt: number) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(salt, xi, yi, 11), b = hash(salt, xi + 1, yi, 11), c = hash(salt, xi, yi + 1, 11), d = hash(salt, xi + 1, yi + 1, 11);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export {hash as terrainHash};

export const HADLEY_SITE = {lat: 26.13, lon: 3.63};

/** Grid descriptors for the files produced by tools/prepare_data.py. */
export const GRID_FILES = {
  globe: {url: 'data/moon-dem-8ppd.i16', width: 2880, height: 1440, north: 90, west: -180, ppd: 8},
  // Crop lines 1229-2765, samples 1075-2611 of the 0-30 N / 0-45 E SLDEM2015 tile (see tools/prepare_data.py).
  hadley: {url: 'data/hadley-sldem-512ppd.i16', width: 1536, height: 1536, north: 30 - 1229 / 512, west: 1075 / 512, ppd: 512},
};
