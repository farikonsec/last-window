import {describe, expect, test} from 'bun:test';

/** Minimal GLB reader: JSON chunk plus accessor min/max, enough to check budgets, names and real-world size. */
async function readGlb(name: string) {
  const bytes = new Uint8Array(await Bun.file(new URL(`../public/models/${name}`, import.meta.url)).arrayBuffer());
  const view = new DataView(bytes.buffer);
  expect(view.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  return json as {
    nodes: {name?: string; mesh?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]}[];
    meshes: {primitives: {attributes: {POSITION: number}; indices?: number}[]}[];
    accessors: {count: number; min?: number[]; max?: number[]}[];
    scenes: {nodes: number[]}[];
  };
}

type Glb = Awaited<ReturnType<typeof readGlb>>;

function triangles(g: Glb) {
  let total = 0;
  const meshUse = new Map<number, number>();
  for (const n of g.nodes) if (n.mesh !== undefined) meshUse.set(n.mesh, (meshUse.get(n.mesh) ?? 0) + 1);
  for (const [mesh, uses] of meshUse) {
    for (const p of g.meshes[mesh].primitives) total += uses * (p.indices !== undefined ? g.accessors[p.indices].count : g.accessors[p.attributes.POSITION].count) / 3;
  }
  return total;
}

/** World-space bounds from node TRS (quaternion rotation applied to the 8 accessor-box corners). */
function bounds(g: Glb, include: (name: string) => boolean = () => true) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const rotate = (q: number[], v: number[]) => {
    const [x, y, z, w] = q, [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
  };
  type Frame = (v: number[]) => number[];
  const visit = (index: number, parent: Frame) => {
    const n = g.nodes[index];
    const t = n.translation ?? [0, 0, 0], r = n.rotation ?? [0, 0, 0, 1], s = n.scale ?? [1, 1, 1];
    const frame: Frame = v => parent(rotate(r, [v[0] * s[0], v[1] * s[1], v[2] * s[2]]).map((c, i) => c + t[i]));
    if (n.mesh !== undefined && include(n.name ?? '')) {
      for (const p of g.meshes[n.mesh].primitives) {
        const a = g.accessors[p.attributes.POSITION];
        for (let k = 0; k < 8; k++) {
          const corner = [k & 1 ? a.max![0] : a.min![0], k & 2 ? a.max![1] : a.min![1], k & 4 ? a.max![2] : a.min![2]];
          const w = frame(corner);
          for (let i = 0; i < 3; i++) {lo[i] = Math.min(lo[i], w[i]); hi[i] = Math.max(hi[i], w[i]);}
        }
      }
    }
    for (const c of n.children ?? []) visit(c, frame);
  };
  for (const root of g.scenes[0].nodes) visit(root, v => v);
  return {lo, hi, size: hi.map((h, i) => h - lo[i])};
}

// glTF frame: +Y up, +Z front (Blender -Y). Sizes in metres; triangle budgets from PLAN.md §5.
const MODELS = [
  {file: 'kestrel.glb', maxTriangles: 150_000, nodes: ['descent_stage', 'ascent_stage', 'engine_main', 'engine_descent', 'dock_port', 'rcs_front_left', 'rcs_front_right', 'rcs_aft_left', 'rcs_aft_right', 'window_left', 'window_right', 'radiator_rack', 'hull_identification', 'lidar_lens_1'],
    height: [5.0, 6.0], width: [6.5, 8.5], groundAtZero: true},
  {file: 'argo.glb', maxTriangles: 150_000, nodes: ['dock_port', 'engine_main', 'solar_left', 'solar_right', 'hga'], length: [52, 60]},
  // Legs sit on the diagonals, so the axis-aligned box is ~9 m / sqrt(2) plus pads and probes (real footpad span 9.4 m diagonal).
  {file: 'apollo-lm-descent.glb', maxTriangles: 60_000, nodes: [], height: [2.5, 3.0], width: [7.2, 8.6], groundAtZero: true},
  {file: 'lrv.glb', maxTriangles: 20_000, nodes: [], height: [1.5, 2.1], width: [1.9, 2.3], length: [3.0, 3.5], groundAtZero: true},
  {file: 'alsep.glb', maxTriangles: 20_000, nodes: [], height: [1.2, 1.7]},
  {file: 'flag-us.glb', maxTriangles: 20_000, nodes: [], height: [2.2, 2.5]},
  {file: 'flag-un.glb', maxTriangles: 20_000, nodes: [], height: [2.2, 2.5]},
];

describe('Blender models (tools/blender/*.py -> public/models)', () => {
  for (const m of MODELS) {
    test(`${m.file}: budget, attach points, real-world size`, async () => {
      const g = await readGlb(m.file);
      const tris = triangles(g);
      expect(tris).toBeGreaterThan(50);
      expect(tris).toBeLessThanOrEqual(m.maxTriangles);
      const names = new Set(g.nodes.map(n => n.name));
      for (const node of m.nodes) expect(names.has(node)).toBe(true);
      const b = bounds(g);
      b.size = b.size.map(v => v / 1.25); // shared presentation scale
      if (m.height) {expect(b.size[1]).toBeGreaterThanOrEqual(m.height[0]); expect(b.size[1]).toBeLessThanOrEqual(m.height[1]);}
      if (m.width) {expect(b.size[0]).toBeGreaterThanOrEqual(m.width[0]); expect(b.size[0]).toBeLessThanOrEqual(m.width[1]);}
      if (m.length) {expect(b.size[2]).toBeGreaterThanOrEqual(m.length[0]); expect(b.size[2]).toBeLessThanOrEqual(m.length[1]);}
      // Landed hardware stands on its origin: nothing more than a few cm below the ground plane.
      if (m.groundAtZero) expect(b.lo[1]).toBeGreaterThan(-0.1);
    });
  }

  test('each lower landing strut connects through a ball joint into its footpad', async () => {
    for (const file of ['kestrel.glb', 'apollo-lm-descent.glb']) {
      const g = await readGlb(file);
      for (let k = 0; k < 4; k++) {
        const joint = bounds(g, n => n === `leg_${k}_ball_joint`);
        const pad = bounds(g, n => n === `leg_${k}_footpad`);
        const lower = bounds(g, n => n === `leg_${k}_lower`);
        expect(Number.isFinite(joint.lo[1])).toBe(true);
        expect(joint.lo[1]).toBeLessThanOrEqual(pad.hi[1]);
        expect(lower.lo[1]).toBeLessThanOrEqual(joint.hi[1]);
        for (const axis of [0, 2]) {
          expect(joint.lo[axis]).toBeLessThan(pad.hi[axis]);
          expect(joint.hi[axis]).toBeGreaterThan(pad.lo[axis]);
        }
      }
    }
  });

  test('docking ports sit at the front (+Z) with the probe axis turned forward', async () => {
    const g = await readGlb('kestrel.glb');
    const port = g.nodes.find(n => n.name === 'dock_port')!;
    expect(port.translation![2]).toBeGreaterThan(1.3); // front of the cabin
    // Blender's +90 degree X rotation on the empty survives as a quarter turn about X in glTF.
    expect(Math.abs(port.rotation![0])).toBeCloseTo(Math.SQRT1_2, 5);
  });
});
