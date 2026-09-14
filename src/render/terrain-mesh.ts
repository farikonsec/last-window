import * as T from 'three';
import {R_MOON} from '../sim/constants';
import {latLonToUnit} from '../sim/orbit';
import type {LunarTerrain} from '../sim/terrain';

/** Quads per ring side. Each ring is a (N+1)^2 vertex grid; its centre (N/2)^2 is replaced by the next finer ring. */
export const RING_QUADS = 128;
const HALF = RING_QUADS / 2;
/** Vertices within this many cells of the ring edge morph toward the coarser ring's heights, so rings meet without cracks. */
const MORPH_CELLS = 10;

export interface RingBuild {
  level: number;
  spacing: number;
  /** Ring centre in terrain-local metres (x east, y north), snapped to multiples of 2 * spacing. */
  centreX: number;
  centreY: number;
  geometry: T.BufferGeometry;
}

/** Body-fixed position of the terrain anchor at the reference radius (metres). All ring vertices are relative to it. */
export function anchorBodyFixed(terrain: LunarTerrain): [number, number, number] {
  const u = latLonToUnit(terrain.anchorLat, terrain.anchorLon);
  return [u[0] * R_MOON, u[1] * R_MOON, u[2] * R_MOON];
}

export const snapCentre = (value: number, spacing: number) => Math.round(value / (2 * spacing)) * 2 * spacing;

/**
 * Build one terrain ring. Heights come from the shared surface function, band-limited to the ring's spacing.
 * Attributes (all body-fixed or terrain-local, float32):
 *   position  body-fixed metres relative to the anchor point
 *   normal    body-fixed unit normal from the height grid
 *   offset    local metres relative to the ring centre (for detail noise and hole discard)
 *   uv        global equirectangular texture coordinate (LROC colour map)
 *   ejecta    fresh-crater brightness cue
 *   height    metres above the reference sphere (for terrain self-shadowing)
 */
export function buildRing(terrain: LunarTerrain, level: number, spacing: number, centreX: number, centreY: number): RingBuild {
  const n = RING_QUADS + 1;
  const grid = n + 2; // one extra sample on every side for normals
  const heights = new Float64Array(grid * grid), ejecta = new Float32Array(n * n);
  const coarse = spacing * 2;
  for (let j = -1; j <= n; j++) {
    for (let i = -1; i <= n; i++) {
      const x = centreX + (i - HALF) * spacing, y = centreY + (j - HALF) * spacing;
      const p = terrain.fromLocal(x, y);
      // The finest ring carries full detail so it is exactly the physics surface.
      const s = terrain.sample(p.lat, p.lon, level === 0 ? 0 : spacing);
      let h = s.height;
      const edge = Math.min(i, j, RING_QUADS - i, RING_QUADS - j);
      if (edge < MORPH_CELLS && i >= 0 && j >= 0 && i < n && j < n) {
        // Height the coarser ring would show here: its band limit at its even vertices, linear in between.
        const hc = (ci: number, cj: number) => {
          const q = terrain.fromLocal(centreX + (ci - HALF) * spacing, centreY + (cj - HALF) * spacing);
          return terrain.height(q.lat, q.lon, coarse);
        };
        const oddI = i % 2 !== 0, oddJ = j % 2 !== 0;
        const coarseHeight = !oddI && !oddJ ? hc(i, j)
          : oddI && !oddJ ? (hc(i - 1, j) + hc(i + 1, j)) / 2
          : !oddI && oddJ ? (hc(i, j - 1) + hc(i, j + 1)) / 2
          : (hc(i - 1, j - 1) + hc(i + 1, j - 1) + hc(i - 1, j + 1) + hc(i + 1, j + 1)) / 4;
        const t = Math.max(0, Math.min(1, (MORPH_CELLS - edge) / MORPH_CELLS));
        const w = t * t * (3 - 2 * t);
        h = h + (coarseHeight - h) * w;
      }
      heights[(j + 1) * grid + (i + 1)] = h;
      if (i >= 0 && j >= 0 && i < n && j < n) ejecta[j * n + i] = s.ejecta;
    }
  }

  const anchor = anchorBodyFixed(terrain);
  const positions = new Float32Array(n * n * 3), normals = new Float32Array(n * n * 3);
  const offsets = new Float32Array(n * n * 2), uvs = new Float32Array(n * n * 2), vertexHeights = new Float32Array(n * n);
  const DEG = Math.PI / 180;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = centreX + (i - HALF) * spacing, y = centreY + (j - HALF) * spacing;
      const {lat, lon} = terrain.fromLocal(x, y);
      const h = heights[(j + 1) * grid + (i + 1)];
      vertexHeights[k] = h;
      const cl = Math.cos(lat * DEG), sl = Math.sin(lat * DEG), co = Math.cos(lon * DEG), so = Math.sin(lon * DEG);
      const r = R_MOON + h;
      positions[k * 3] = cl * co * r - anchor[0];
      positions[k * 3 + 1] = cl * so * r - anchor[1];
      positions[k * 3 + 2] = sl * r - anchor[2];
      // Gradient in true metres: local x spacing is exact at the anchor latitude only, so correct by cos ratio.
      const dx = spacing * (Math.cos(lat * DEG) / Math.cos(terrain.anchorLat * DEG));
      const dhdx = (heights[(j + 1) * grid + (i + 2)] - heights[(j + 1) * grid + i]) / (2 * dx);
      const dhdy = (heights[(j + 2) * grid + (i + 1)] - heights[j * grid + (i + 1)]) / (2 * spacing);
      const up = [cl * co, cl * so, sl], east = [-so, co, 0], north = [-sl * co, -sl * so, cl];
      let nx = up[0] - east[0] * dhdx - north[0] * dhdy, ny = up[1] - east[1] * dhdx - north[1] * dhdy, nz = up[2] - north[2] * dhdy;
      const nl = Math.hypot(nx, ny, nz);
      nx /= nl; ny /= nl; nz /= nl;
      normals.set([nx, ny, nz], k * 3);
      offsets[k * 2] = (i - HALF) * spacing;
      offsets[k * 2 + 1] = (j - HALF) * spacing;
      uvs[k * 2] = (lon + 180) / 360;
      uvs[k * 2 + 1] = (90 - lat) / 180;
    }
  }

  const indices = new Uint32Array(RING_QUADS * RING_QUADS * 6);
  let q = 0;
  for (let j = 0; j < RING_QUADS; j++) {
    for (let i = 0; i < RING_QUADS; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      // Viewed from above (x east right, y north up) a -> b -> d is counter-clockwise.
      indices[q++] = a; indices[q++] = b; indices[q++] = d;
      indices[q++] = a; indices[q++] = d; indices[q++] = c;
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
  geometry.setAttribute('offset', new T.BufferAttribute(offsets, 2));
  geometry.setAttribute('uv', new T.BufferAttribute(uvs, 2));
  geometry.setAttribute('ejecta', new T.BufferAttribute(ejecta, 1));
  geometry.setAttribute('height', new T.BufferAttribute(vertexHeights, 1));
  geometry.setIndex(new T.BufferAttribute(indices, 1));
  geometry.boundingSphere = new T.Sphere(new T.Vector3(), 1e9);
  return {level, spacing, centreX, centreY, geometry};
}
