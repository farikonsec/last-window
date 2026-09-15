import * as T from 'three';
import {exposure} from './common';

/**
 * Tyre tracks the buggy leaves in the regolith. Disturbed lunar soil is darker than the surface around it (as Apollo
 * photographs show), so a track is a thin dark ribbon pressed into the ground; braking hard leaves a darker, wider
 * skid. Two ribbons (left and right wheel) are laid as a ring buffer of segments — the last stretch of driving stays
 * on the ground and the oldest fades out as new track overwrites it, so the trail never grows without bound while you
 * can still circle a good distance and see where you have been.
 *
 * Geometry lives in the terrain's anchor frame (metres, body-fixed relative to the anchor point), exactly like the
 * hardware, so the caller places the whole group with the same per-frame anchor->world matrix.
 */
const SEGMENTS = 700;      // last N segments of track kept
const VERTS_PER_SEG = 12;  // two ribbons, two triangles each
const TRACK_HALF = 1.0;    // wheel centre distance from the buggy centreline, m
const TYRE_HALF = 0.22;    // half the width of one tyre's mark, m
const LIFT = 0.05;         // sit just above the ground to beat z-fighting
const DEG = Math.PI / 180;
const R_MOON = 1_737_400;

export class Tracks {
  group = new T.Group();
  private geometry = new T.BufferGeometry();
  private position: T.BufferAttribute;
  private meta: T.BufferAttribute; // x = sequence number, y = darkness (brake)
  private cursor = 0;              // next segment slot to overwrite
  private seq = 0;                 // monotonically increasing segment id
  private have: {lat: number; lon: number; heading: number} | null = null;
  private material: T.ShaderMaterial;

  /** `sample` returns the anchor-frame position of a ground point at the given lat/lon (degrees), lifted a little. */
  constructor(private sample: (lat: number, lon: number, lift: number) => [number, number, number]) {
    this.group.matrixAutoUpdate = false;
    const count = SEGMENTS * VERTS_PER_SEG;
    this.position = new T.BufferAttribute(new Float32Array(count * 3), 3);
    this.meta = new T.BufferAttribute(new Float32Array(count * 2), 2);
    this.position.setUsage(T.DynamicDrawUsage);
    this.meta.setUsage(T.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('meta', this.meta);
    this.material = new T.ShaderMaterial({
      uniforms: {exposure, sunLight: {value: 1}, newest: {value: 0}, span: {value: SEGMENTS}},
      transparent: true, depthWrite: false, blending: T.NormalBlending, polygonOffset: true, polygonOffsetFactor: -2,
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec2 meta; uniform float newest; uniform float span; varying float vFade; varying float vDark;
        void main() {
          // Fade the oldest segments out so the ring buffer's overwrite seam never pops.
          vFade = clamp((meta.x - (newest - span)) / span, 0.0, 1.0);
          vDark = meta.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <logdepthbuf_pars_fragment>
        uniform float exposure; uniform float sunLight; varying float vFade; varying float vDark;
        void main() {
          #include <logdepthbuf_fragment>
          // Pressed regolith reads darker than its surroundings; a skid is darker still.
          float alpha = (0.42 + 0.4 * vDark) * vFade;
          vec3 colour = vec3(0.05, 0.049, 0.052) * (0.1 + 0.9 * sunLight) * exposure;
          gl_FragColor = vec4(colour, alpha);
        }`,
    });
    const mesh = new T.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4; // over the ground, under dust and hardware
    this.group.add(mesh);
  }

  setLight(sunLight: number) {this.material.uniforms.sunLight.value = sunLight;}

  /** Break the trail without wiping it: the next drop starts a fresh segment (e.g. after a jump). */
  pause() {this.have = null;}

  /** Wipe the trail (new drive, or a teleport). */
  clear() {
    this.have = null;
    this.position.array.fill(0);
    this.meta.array.fill(0);
    this.position.needsUpdate = true;
    this.meta.needsUpdate = true;
  }

  private offset(lat: number, lon: number, distance: number, bearing: number) {
    const dLat = (Math.cos(bearing) * distance) / R_MOON / DEG;
    const dLon = (Math.sin(bearing) * distance) / (R_MOON * Math.max(0.02, Math.cos(lat * DEG))) / DEG;
    return [lat + dLat, lon + dLon] as [number, number];
  }

  /**
   * Lay track from the last dropped point to this one. Call it as the buggy drives; it only adds a segment once the
   * buggy has moved far enough, so cadence is distance-based, not frame-based. `dark` (0..1) deepens a braking skid.
   */
  drop(lat: number, lon: number, heading: number, dark: number) {
    const prev = this.have;
    if (!prev) {this.have = {lat, lon, heading}; return;}
    // Only add a segment every ~0.5 m of travel.
    const [dN, dE] = [(lat - prev.lat) * R_MOON * DEG, (lon - prev.lon) * R_MOON * DEG * Math.cos(lat * DEG)];
    if (Math.hypot(dN, dE) < 0.5) return;

    const perp = heading + Math.PI / 2, perpPrev = prev.heading + Math.PI / 2;
    const width = TYRE_HALF * (1 + dark * 0.6);
    // Four wheel-edge points for the current and previous positions, per ribbon side.
    const edge = (la: number, lo: number, side: number, w: number, p: number) => {
      const [wl, wo] = this.offset(la, lo, side * TRACK_HALF, p);      // wheel centre
      return this.offset(wl, wo, w, p);                                // one edge of the tyre
    };
    const slot = this.cursor * VERTS_PER_SEG;
    let v = slot;
    for (const side of [-1, 1]) {
      const a = edge(prev.lat, prev.lon, side, -width, perpPrev), b = edge(prev.lat, prev.lon, side, width, perpPrev);
      const c = edge(lat, lon, side, -width, perp), d = edge(lat, lon, side, width, perp);
      const P = (ll: [number, number]) => this.sample(ll[0], ll[1], LIFT);
      const pa = P(a), pb = P(b), pc = P(c), pd = P(d);
      for (const p of [pa, pb, pc, pb, pd, pc]) {
        this.position.setXYZ(v, p[0], p[1], p[2]);
        this.meta.setXY(v, this.seq, dark);
        v++;
      }
    }
    this.position.needsUpdate = true;
    this.meta.needsUpdate = true;
    this.material.uniforms.newest.value = this.seq;
    this.seq++;
    this.cursor = (this.cursor + 1) % SEGMENTS;
    this.have = {lat, lon, heading};
  }
}
