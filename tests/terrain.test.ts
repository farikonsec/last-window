import {describe, expect, test} from 'bun:test';
import {R_MOON} from '../src/sim/constants';
import {GRID_FILES, HADLEY_SITE, LunarTerrain, sampleGrid, type ElevationGrid} from '../src/sim/terrain';
import {anchorBodyFixed, buildRing, RING_QUADS, snapCentre} from '../src/render/terrain-mesh';
import {inertialToBody, latLonToUnit, surfaceVelocity} from '../src/sim/orbit';
import {KESTREL, stepVehicle, type VehicleState} from '../src/sim/vehicle';
import {add, len, quatFromUpForward, scale, unit} from '../src/sim/vec';

const load = async (g: typeof GRID_FILES.globe): Promise<ElevationGrid> =>
  ({...g, heights: new Int16Array(await Bun.file(new URL('../public/' + g.url, import.meta.url)).arrayBuffer())});
const region = await load(GRID_FILES.hadley), globe = await load(GRID_FILES.globe);
const terrain = new LunarTerrain({region, globe, anchorLat: HADLEY_SITE.lat, anchorLon: HADLEY_SITE.lon});

describe('11. surface function', () => {
  test('surveyed heights equal SLDEM2015 at pixel centres inside the region', () => {
    for (const [row, col] of [[768, 768], [300, 1200], [1100, 250]]) {
      const lat = region.north - (row + 0.5) / region.ppd, lon = region.west + (col + 0.5) / region.ppd;
      expect(terrain.surveyed(lat, lon)).toBeCloseTo(region.heights[row * region.width + col], 6);
    }
  });

  test('Hadley Rille is ~300 m deeper than the plain beside the landing site', () => {
    // Plain at the Apollo 15 site vs the rille floor ~1.4 km west (hillshade in PLAN decision log).
    const plain = terrain.surveyed(26.13, 3.63);
    let rille = Infinity;
    for (let lon = 3.50; lon < 3.62; lon += 0.002) rille = Math.min(rille, terrain.surveyed(26.12, lon));
    expect(plain - rille).toBeGreaterThan(200);
    expect(plain - rille).toBeLessThan(450);
  });

  test('continuous: no steps across the region border or crater edges', () => {
    let worst = 0;
    for (let lat = 24.55; lat < 24.8; lat += 0.00005) {
      const a = terrain.height(lat, 3.6), b = terrain.height(lat + 0.00005, 3.6); // 1.5 m apart
      worst = Math.max(worst, Math.abs(a - b));
    }
    expect(worst).toBeLessThan(1.8); // under 50 degrees anywhere
  });

  test('deterministic and band-limited', () => {
    expect(terrain.height(26.2, 3.7)).toBe(terrain.height(26.2, 3.7));
    // Coarse sampling keeps the survey but drops metre-scale detail.
    const p = terrain.fromLocal(333, -777);
    expect(Math.abs(terrain.height(p.lat, p.lon, 5000) - terrain.surveyed(p.lat, p.lon))).toBeLessThan(0.001);
  });

  test('procedural craters: saturated, mostly degraded mare with metre-scale relief', () => {
    let min = Infinity, max = -Infinity, sumSq = 0, count = 0;
    for (let y = 0; y < 400; y += 2) for (let x = 0; x < 400; x += 2) {
      const p = terrain.fromLocal(x, y);
      const d = terrain.height(p.lat, p.lon) - terrain.surveyed(p.lat, p.lon);
      min = Math.min(min, d); max = Math.max(max, d); sumSq += d * d; count++;
    }
    const rms = Math.sqrt(sumSq / count);
    expect(rms).toBeGreaterThan(0.3);
    expect(rms).toBeLessThan(8);
    expect(min).toBeLessThan(-2);
    expect(max).toBeLessThan(12);
  });

  test('a landing pad holds the ground level', () => {
    const t = new LunarTerrain({region, globe, anchorLat: HADLEY_SITE.lat, anchorLon: HADLEY_SITE.lon});
    const h = t.addPad(26.131, 3.632, 12);
    const c = t.toLocal(26.131, 3.632);
    for (const [dx, dy] of [[0, 0], [8, 0], [0, -11], [-6, 6]]) {
      const p = t.fromLocal(c.x + dx, c.y + dy);
      expect(t.height(p.lat, p.lon)).toBeCloseTo(h, 6);
    }
  });

  test('fast enough for mesh building: < 5 microseconds per full-detail sample', () => {
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) terrain.height(26.1 + i * 1e-6, 3.6 + i * 1e-6);
    expect((performance.now() - t0) / 20000).toBeLessThan(0.005);
  });
});

describe('rendered terrain sits on the physics surface', () => {
  test('finest ring vertices (outside the morph band) match surfaceRadius within 1 mm', () => {
    const spacing = 0.25, c = terrain.toLocal(HADLEY_SITE.lat, HADLEY_SITE.lon);
    const ring = buildRing(terrain, 0, spacing, snapCentre(c.x, spacing), snapCentre(c.y, spacing));
    const pos = ring.geometry.getAttribute('position'), anchor = anchorBodyFixed(terrain);
    const n = RING_QUADS + 1;
    let worst = 0;
    for (let j = 20; j < n - 20; j += 7) for (let i = 20; i < n - 20; i += 7) {
      const k = j * n + i;
      const p: [number, number, number] = [pos.getX(k) + anchor[0], pos.getY(k) + anchor[1], pos.getZ(k) + anchor[2]];
      // float32 vertex offsets near the anchor are good to a fraction of a millimetre
      worst = Math.max(worst, Math.abs(len(p) - terrain.surfaceRadius(unit(p))));
    }
    expect(worst).toBeLessThan(0.001);
  });

  test('neighbouring ring levels meet without cracks along the shared edge', () => {
    const c = terrain.toLocal(26.2, 3.5);
    const fineSpacing = 4, coarseSpacing = 8;
    const fine = buildRing(terrain, 4, fineSpacing, snapCentre(c.x, fineSpacing), snapCentre(c.y, fineSpacing));
    const pos = fine.geometry.getAttribute('position'), anchor = anchorBodyFixed(terrain);
    const n = RING_QUADS + 1;
    let worst = 0;
    for (let i = 0; i < n; i++) {
      // Edge vertex of the fine ring vs the coarse ring's linear surface at the same place.
      const k = i; // j = 0 row (south edge)
      const x = fine.centreX + (i - RING_QUADS / 2) * fineSpacing, y = fine.centreY - (RING_QUADS / 2) * fineSpacing;
      const coarseAt = (xx: number) => {const q = terrain.fromLocal(xx, y); return terrain.height(q.lat, q.lon, coarseSpacing);};
      const even = Math.round(x / coarseSpacing) * coarseSpacing;
      const expected = Math.abs(x - even) < 1e-6 ? coarseAt(x) : (coarseAt(x - fineSpacing) + coarseAt(x + fineSpacing)) / 2;
      const p: [number, number, number] = [pos.getX(k) + anchor[0], pos.getY(k) + anchor[1], pos.getZ(k) + anchor[2]];
      worst = Math.max(worst, Math.abs(len(p) - R_MOON - expected));
    }
    expect(worst).toBeLessThan(0.01);
  });

  test('the lander touches down on the procedural ground, not the survey sphere', () => {
    const site = latLonToUnit(26.1302, 3.6305);
    const ground = terrain.surfaceRadius(site);
    let s: VehicleState = {t: 0, r: scale(site, ground + 1), v: add(scale(site, -0.5), surfaceVelocity(scale(site, ground + 1))), q: [1, 0, 0, 0], w: [0, 0, 0],
      mainPropellant: 0, rcsPropellant: 0, batteryKWh: 10, status: 'flying'};
    s.q = quatFromUpForward(site, [0, 0, 1]); // upright
    for (let i = 0; i < 600 && s.status === 'flying'; i++) s = stepVehicle(KESTREL, s, {throttle: 0, translate: [0, 0, 0], rotate: [0, 0, 0]}, 1 / 120, terrain);
    expect(s.status).toBe('landed');
    expect(Math.abs(len(s.r) - terrain.surfaceRadius(unit(inertialToBody(s.r, s.t))))).toBeLessThan(0.01);
  });
});

test('globe grid helper agrees with bilinear sampling', () => {
  expect(sampleGrid(globe, 26.13, 3.63, false)).toBeCloseTo(-1939, 0);
});
