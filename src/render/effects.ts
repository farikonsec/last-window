import * as T from 'three';
import type {Mat3} from '../sim/ephemeris';
import {apply} from '../sim/ephemeris';
import {MU} from '../sim/constants';
import {type V3, add, len, scale, sub, unit} from '../sim/vec';
import {exposure} from './common';

const logDepthVertex = '#include <common>\n#include <logdepthbuf_pars_vertex>';

/**
 * Vacuum-correct engine plume: hypergolic exhaust is almost invisible in sunlight. A faint pink-orange core at the
 * nozzle and a wide, quickly fading blue-grey expansion cone; brightness follows throttle with a little flicker.
 */
export function makePlume(length = 7, radius = 3.2) {
  const geometry = new T.ConeGeometry(radius, length, 32, 8, true);
  geometry.translate(0, -length / 2, 0); // apex at the nozzle, opening downward (-Y)
  const material = new T.ShaderMaterial({
    uniforms: {exposure, throttle: {value: 0}, time: {value: 0}, length: {value: length}},
    vertexShader: `${logDepthVertex}
      varying float vAlong; varying vec3 vNormal; varying vec3 vView;
      void main() {
        vAlong = -position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal); vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
      uniform float exposure; uniform float throttle; uniform float time; uniform float length;
      varying float vAlong; varying vec3 vNormal; varying vec3 vView;
      void main() {
        #include <logdepthbuf_fragment>
        float t = clamp(vAlong / length, 0.0, 1.0);
        float edge = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.5);
        float core = exp(-t * 9.0) * (1.0 - edge);
        float flicker = 0.85 + 0.15 * sin(time * 63.0 + vAlong * 3.0);
        vec3 colour = mix(vec3(1.0, 0.55, 0.45) * core * 1.6, vec3(0.45, 0.55, 0.8) * (1.0 - t) * 0.12, t);
        float radiance = throttle * flicker * 0.45;
        gl_FragColor = vec4(colour * radiance * exposure * 0.35, 1.0);
      }`,
    blending: T.AdditiveBlending, depthWrite: false, transparent: true, side: T.DoubleSide,
  });
  const mesh = new T.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return {mesh, material};
}

/** Short white RCS puffs (frozen propellant catching the Sun) at a thruster cluster. */
export function makeRcsPuff() {
  const geometry = new T.SphereGeometry(0.35, 12, 8);
  const material = new T.ShaderMaterial({
    uniforms: {exposure, level: {value: 0}},
    vertexShader: `${logDepthVertex}
      varying vec3 vNormal; varying vec3 vView;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vNormal = normalize(normalMatrix * normal); vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
      uniform float exposure; uniform float level; varying vec3 vNormal; varying vec3 vView;
      void main() {
        #include <logdepthbuf_fragment>
        float soft = pow(abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        gl_FragColor = vec4(vec3(0.9, 0.93, 1.0) * soft * level * 0.25 * exposure, 1.0);
      }`,
    blending: T.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const mesh = new T.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {mesh, material};
}

interface Burst {
  /** MCI position/velocity, metres and m/s (float64). */
  r: Float64Array;
  v: Float64Array;
  born: number;
  life: number;
  kind: 'dust' | 'vapour' | 'flash';
  count: number;
  points: T.Points;
  /** Surface radius function for ground contact of dust grains (MCI direction -> radius), or null in orbit. */
  ground: ((r: V3) => number) | null;
  /** Per-grain cached ground radius, refreshed a slice at a time: the terrain function is too dear for 9000 grains a frame. */
  groundCache: Float64Array | null;
}

/**
 * Particle bursts integrated in the Moon-centred inertial frame and drawn camera-relative:
 * - dust: regolith thrown by the ascent engine or an impact, ballistic under lunar gravity, no drag, no billowing;
 * - vapour: propellant and cabin air flashing to ice crystals that glitter in sunlight while they expand and fade;
 * - flash: a brief hypergolic fireball that dies in a fraction of a second because nothing sustains it in vacuum.
 */
export class Effects {
  group = new T.Group();
  private bursts: Burst[] = [];
  private frame = 0;
  private debris: {mesh: T.Mesh; r: V3; v: V3; spin: T.Vector3; axis: T.Vector3; angle: number; resting: boolean}[] = [];
  private material(kind: Burst['kind']) {
    // Dust is opaque-ish grey grains drawn with normal blending at regolith brightness; vapour and the flash glow.
    const size = kind === 'flash' ? '18.0' : kind === 'vapour' ? '0.12' : '0.08';
    return new T.ShaderMaterial({
      uniforms: {exposure, age: {value: 0}, life: {value: 1}, sunLight: {value: 1}, viewportHeight: {value: 900}},
      vertexShader: `${logDepthVertex}
        attribute float seed; uniform float age; uniform float life; uniform float viewportHeight; varying float vSeed;
        void main() {
          vSeed = seed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float metres = ${size} * (0.4 + 1.2 * seed * seed);
          float dist = -mv.z;
          gl_PointSize = clamp(metres * projectionMatrix[1][1] * viewportHeight * 0.5 / max(dist, 0.05), 1.0, ${kind === 'flash' ? '256.0' : kind === 'vapour' ? '3.0' : '10.0'});
          // Grains passing right in front of the lens would be blurred giant discs; drop them.
          if (dist < ${kind === 'flash' ? '0.0' : '2.5'}) gl_PointSize = 0.0;
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <logdepthbuf_pars_fragment>
        uniform float exposure; uniform float age; uniform float life; uniform float sunLight; varying float vSeed;
        void main() {
          #include <logdepthbuf_fragment>
          vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0;
          if (r > 1.0) discard;
          float fade = clamp(1.0 - age / life, 0.0, 1.0);
          ${kind === 'flash'
            ? 'float heat = exp(-age * 9.0); gl_FragColor = vec4(mix(vec3(1.0, 0.45, 0.2), vec3(1.0, 0.95, 0.8), heat) * (1.0 - r) * heat * 30.0 * exposure, 1.0);'
            : kind === 'vapour'
              ? 'float glint = 0.3 + 0.7 * step(0.92, fract(vSeed * 91.7 + age * 5.0)); float thin = 1.0 / (1.0 + age * age * 0.6); gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * exp(-r * 3.0) * fade * thin * glint * 0.5 * sunLight * exposure, 1.0);'
              : 'float shade = 0.6 + 0.4 * vSeed; gl_FragColor = vec4(vec3(0.115, 0.11, 0.105) * shade * (0.08 + 0.92 * sunLight) * 0.55 * exposure, fade * 0.9);'}
        }`,
      blending: kind === 'dust' ? T.NormalBlending : T.AdditiveBlending, depthWrite: false, transparent: true,
    });
  }

  constructor() {
    this.group.matrixAutoUpdate = false;
  }

  get active() {return this.bursts.length + this.debris.length;}

  /** Spray regolith radially from a point on the ground (liftoff blast or impact ejecta). */
  dust(centre: V3, velocity: V3, t: number, count: number, speed: [number, number], ground: (r: V3) => number, life = 6) {
    const up = unit(centre);
    const east = unit([-up[1], up[0], 0]), north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]] as V3;
    const r = new Float64Array(count * 3), v = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = speed[0] + (speed[1] - speed[0]) * Math.random() ** 2;
      const loft = 0.05 + 0.35 * Math.random();
      const dir = add(add(scale(east, Math.cos(a)), scale(north, Math.sin(a))), scale(up, loft));
      const start = add(centre, add(scale(dir, 1 + Math.random() * 4), scale(up, 0.3)));
      r.set(start, i * 3);
      v.set(add(velocity, scale(unit(dir), s)), i * 3);
    }
    this.add('dust', r, v, t, life, ground);
  }

  /** A rooster-tail of regolith from a wheel dragging over the surface; `strength` 0..1 scales grains and throw speed. */
  wheelSpray(centre: V3, velocity: V3, t: number, ground: (r: V3) => number, strength = 0) {
    const count = Math.round(26 + 90 * strength);
    this.dust(centre, velocity, t, count, [1, 9 + 34 * strength], ground, 1.5 + strength);
  }

  /**
   * Explosive decompression: the pressurised cabin's air blasts out of a hull breach as a narrow, fast jet that
   * flash-freezes to ice crystals in vacuum, then goes ballistic and disperses. Directed, unlike the radial vapour ball.
   */
  vent(centre: V3, direction: V3, velocity: V3, t: number, speed = 70) {
    const axis = unit(direction);
    const side = unit(Math.abs(axis[2]) < 0.9 ? [axis[1], -axis[0], 0] : [0, axis[2], -axis[1]]);
    const other: V3 = [axis[1] * side[2] - axis[2] * side[1], axis[2] * side[0] - axis[0] * side[2], axis[0] * side[1] - axis[1] * side[0]];
    const n = 1400, r = new Float64Array(n * 3), v = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const spread = 0.28 * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
      const dir = unit(add(axis, add(scale(side, Math.cos(a) * spread), scale(other, Math.sin(a) * spread))));
      r.set(add(centre, scale(dir, Math.random() * 1.5)), i * 3);
      v.set(add(velocity, scale(dir, speed * (0.3 + 0.7 * Math.random()))), i * 3);
    }
    this.add('vapour', r, v, t, 2.6, null);
  }

  /** Ice vapour cloud and fireball flash at a destroyed craft, plus tumbling debris fragments. */
  explode(centre: V3, velocity: V3, t: number, pieces: T.Material[], ground: ((r: V3) => number) | null) {
    // Two crossed decompression jets from the breach, so a rupturing pressure hull vents before it fully breaks up.
    for (let j = 0; j < 2; j++) this.vent(centre, unit([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]), velocity, t);
    const n = 6000, r = new Float64Array(n * 3), v = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const dir = unit([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]);
      r.set(add(centre, scale(dir, Math.random() * 2)), i * 3);
      v.set(add(velocity, scale(dir, 4 + 30 * Math.random() ** 1.5)), i * 3);
    }
    this.add('vapour', r, v, t, 7, null);
    const fr = new Float64Array(3 * 6), fv = new Float64Array(3 * 6);
    for (let i = 0; i < 6; i++) {fr.set(centre, i * 3); fv.set(velocity, i * 3);}
    this.add('flash', fr, fv, t, 0.9, null);
    for (let i = 0; i < 70; i++) {
      const size = 0.15 + Math.random() ** 2.5 * 2.2; // panels, struts, tank fragments
      const geometry = Math.random() < 0.5 ? new T.BoxGeometry(size, size * (0.2 + Math.random()), size * (0.4 + Math.random())) : new T.TetrahedronGeometry(size * 0.7);
      const mesh = new T.Mesh(geometry, pieces[i % pieces.length]);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      const dir = unit([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]);
      this.debris.push({mesh, r: add(centre, scale(dir, 0.5)), v: add(velocity, scale(dir, 3 + Math.random() * 25)),
        spin: new T.Vector3(), axis: new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), angle: 0, resting: false});
    }
    if (ground) this.dust(centre, velocity, t, 9000, [4, 70], ground);
  }

  private add(kind: Burst['kind'], r: Float64Array, v: Float64Array, t: number, life: number, ground: Burst['ground']) {
    const count = r.length / 3;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(count * 3), 3));
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) seeds[i] = Math.random();
    geometry.setAttribute('seed', new T.BufferAttribute(seeds, 1));
    const points = new T.Points(geometry, this.material(kind));
    points.frustumCulled = false;
    points.renderOrder = 6;
    this.group.add(points);
    const groundCache = ground ? new Float64Array(count) : null;
    if (ground && groundCache) groundCache.fill(ground([r[0], r[1], r[2]]));
    this.bursts.push({r, v, born: t, life, kind, count, points, ground, groundCache});
  }

  /** Integrate (ballistic, no drag) and re-base everything onto the camera for this frame. */
  update(t: number, dt: number, mciToEqj: Mat3, cameraEqj: V3, sunLit: number, viewportHeight = 900) {
    const dtc = Math.max(0, Math.min(dt, 0.1));
    const slice = this.frame++ % 24;
    for (const b of this.bursts.slice()) {
      const age = t - b.born;
      if (age > b.life || age < -1) {
        this.group.remove(b.points);
        b.points.geometry.dispose();
        (b.points.material as T.Material).dispose();
        this.bursts.splice(this.bursts.indexOf(b), 1);
        continue;
      }
      const positions = b.points.geometry.getAttribute('position') as T.BufferAttribute;
      for (let i = 0; i < b.count; i++) {
        const k = i * 3;
        const p: V3 = [b.r[k], b.r[k + 1], b.r[k + 2]];
        const g = scale(p, -MU / len(p) ** 3);
        if (b.kind !== 'flash') {
          b.v[k] += g[0] * dtc; b.v[k + 1] += g[1] * dtc; b.v[k + 2] += g[2] * dtc;
          b.r[k] += b.v[k] * dtc; b.r[k + 1] += b.v[k + 1] * dtc; b.r[k + 2] += b.v[k + 2] * dtc;
          if (b.ground && b.groundCache) {
            const q: V3 = [b.r[k], b.r[k + 1], b.r[k + 2]];
            if (i % 24 === slice) b.groundCache[i] = b.ground(q);
            const ground = b.groundCache[i];
            if (len(q) < ground && (b.v[k] || b.v[k + 1] || b.v[k + 2])) {const fix = scale(unit(q), ground); b.r.set(fix, k); b.v[k] = b.v[k + 1] = b.v[k + 2] = 0;}
          }
        } else {
          b.r[k] += b.v[k] * dtc; b.r[k + 1] += b.v[k + 1] * dtc; b.r[k + 2] += b.v[k + 2] * dtc;
        }
        const w = sub(apply(mciToEqj, [b.r[k], b.r[k + 1], b.r[k + 2]]), cameraEqj);
        positions.setXYZ(i, w[0], w[1], w[2]);
      }
      positions.needsUpdate = true;
      const u = (b.points.material as T.ShaderMaterial).uniforms;
      u.age.value = age; u.life.value = b.life; u.sunLight.value = sunLit; u.viewportHeight.value = viewportHeight;
    }
    for (const d of this.debris) {
      if (!d.resting) {
        const g = scale(d.r, -MU / len(d.r) ** 3);
        d.v = add(d.v, scale(g, dtc));
        d.r = add(d.r, scale(d.v, dtc));
        d.angle += dtc * 4;
      }
      const w = sub(apply(mciToEqj, d.r), cameraEqj);
      d.mesh.matrix.makeRotationAxis(d.axis, d.angle).setPosition(w[0], w[1], w[2]);
      d.mesh.matrixWorld.copy(d.mesh.matrix);
    }
  }

  /** Stop debris that has reached the ground (called by the scene with the surface function). */
  settleDebris(ground: (r: V3) => number) {
    for (const d of this.debris) {
      if (d.resting) continue;
      const surface = ground(d.r);
      if (len(d.r) <= surface) {d.r = scale(unit(d.r), surface + 0.1); d.v = [0, 0, 0]; d.resting = true;}
    }
  }
}
