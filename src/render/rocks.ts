import * as T from 'three';
import {R_MOON} from '../sim/constants';
import {type LunarTerrain, terrainHash} from '../sim/terrain';
import {exposure, GLSL_COMMON, GLSL_LUNAR} from './common';
import type {SunShadows} from './shadows';
import {anchorBodyFixed} from './terrain-mesh';

interface Population {
  /** Placement cell size, metres, and the radius around the camera that is populated. */
  cell: number;
  radius: number;
  /** Mean count per cell on old mare and extra per unit of fresh-crater ejecta. */
  base: number;
  ejectaBoost: number;
  /** Diameter distribution: dMin * u^(-1/slope), capped at dMax. */
  dMin: number;
  dMax: number;
  slope: number;
  maxInstances: number;
  /** Re-populate after the camera moves this far. */
  refresh: number;
  salt: number;
}

const BOULDERS: Population = {cell: 5, radius: 260, base: 0.035, ejectaBoost: 1.6, dMin: 0.28, dMax: 3.5, slope: 2.4, maxInstances: 9000, refresh: 20, salt: 301};
const COBBLES: Population = {cell: 0.7, radius: 22, base: 0.1, ejectaBoost: 2.5, dMin: 0.03, dMax: 0.35, slope: 1.7, maxInstances: 12000, refresh: 2.5, salt: 302};

/** Angular boulder: a displaced icosphere with flat facets, slightly flattened underneath. */
function rockGeometry(seed: number, detail: number) {
  const g = new T.IcosahedronGeometry(1, detail);
  const pos = g.getAttribute('position');
  const v = new T.Vector3();
  const lump = (x: number, y: number, z: number, f: number, s: number) =>
    terrainHash(s, Math.floor(x * f + 100), Math.floor(y * f + 100), Math.floor(z * f + 100)) - 0.5;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = 1 + 0.32 * lump(v.x, v.y, v.z, 1.3, seed) + 0.14 * lump(v.x, v.y, v.z, 2.9, seed + 1) + 0.05 * lump(v.x, v.y, v.z, 6.1, seed + 2);
    if (v.y < -0.35) r *= 0.75 + 0.25 * (1 + v.y); // flatter base sits into the regolith
    v.multiplyScalar(r);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // IcosahedronGeometry is already non-indexed, so computed normals are per face: angular facets.
  g.computeVertexNormals();
  return g;
}

/**
 * Boulders (0.3-3.5 m, out to 260 m) and cobbles (4-30 cm, out to 22 m), placed deterministically per cell from the
 * surface function: sparse on the old mare, clustered on fresh crater rims and ejecta. Sizes follow a power law, so
 * most rocks are small and a few are big. Rendering only; the lander does not collide with them yet.
 */
export class RockField {
  group = new T.Group();
  private meshes: {population: Population; mesh: T.InstancedMesh; centre: [number, number] | null}[] = [];
  private boulders: {x: number; y: number; diameter: number}[] = [];
  private anchor: [number, number, number];
  uniforms: Record<string, T.IUniform>;

  constructor(private terrain: LunarTerrain, colourMap: T.Texture, shadows: SunShadows) {
    this.anchor = anchorBodyFixed(terrain);
    this.uniforms = {
      exposure, colourMap: {value: colourMap}, sunDir: {value: new T.Vector3(1, 0, 0)},
      earthDir: {value: new T.Vector3(0, 1, 0)}, earthshine: {value: 0}, albedoScale: {value: 0.26}, ...shadows.uniforms,
    };
    const material = new T.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 rockInfo; // albedo factor, uv.x, uv.y
        varying vec3 vNormal; varying vec3 vWorld; varying vec3 vObject; varying vec3 vInfo;
        void main() {
          vInfo = rockInfo;
          vObject = position;
          mat4 m = modelMatrix * instanceMatrix;
          vNormal = normalize(mat3(m) * normal);
          vec4 world = m * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <logdepthbuf_pars_fragment>
        ${GLSL_COMMON}
        ${GLSL_LUNAR}
        ${shadows.glsl}
        uniform float exposure; uniform sampler2D colourMap; uniform vec3 sunDir; uniform vec3 earthDir;
        uniform float earthshine; uniform float albedoScale;
        varying vec3 vNormal; varying vec3 vWorld; varying vec3 vObject; varying vec3 vInfo;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 n = normalize(vNormal), view = normalize(-vWorld);
          vec3 base = srgbToLinear(texture(colourMap, vInfo.yz).rgb) * albedoScale;
          float grey = dot(base, vec3(0.2126, 0.7152, 0.0722));
          // Rocks are less weathered than the fines: a bit brighter, with mottling and a dust-covered top.
          float mottle = noised(vObject.xz * 3.1 + vObject.y * 1.7).x * 0.5 + noised(vObject.xy * 9.0).x * 0.5;
          vec3 albedo = vec3(grey) * vInfo.x * (0.8 + 0.4 * mottle) * vec3(1.0, 0.98, 0.95);
          float mu0 = dot(n, sunDir), mu = dot(n, view);
          float g = acos(clamp(dot(sunDir, view), -1.0, 1.0));
          float lit = sunShadow(vWorld, n);
          vec3 radiance = albedo * lunarLambert(max(mu0, 0.0), mu, g, 0.35) * lit;
          radiance += albedo * earthshine * max(dot(n, earthDir), 0.0);
          radiance += albedo * 0.035 * (1.0 - lit * 0.7); // bounce light from the sunlit ground
          gl_FragColor = vec4(radiance * exposure, 1.0);
        }`,
    });
    for (const population of [BOULDERS, COBBLES]) {
      const geometry = population === BOULDERS ? rockGeometry(7, 2) : rockGeometry(11, 1);
      geometry.setAttribute('rockInfo', new T.InstancedBufferAttribute(new Float32Array(population.maxInstances * 3), 3));
      const mesh = new T.InstancedMesh(geometry, material, population.maxInstances);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.layers.enable(shadows.layer);
      this.group.add(mesh);
      this.meshes.push({population, mesh, centre: null});
    }
  }

  /** Repopulate around the camera ground point (terrain-local metres) when it has moved far enough. */
  update(localX: number, localY: number, altitude: number) {
    for (const entry of this.meshes) {
      const p = entry.population;
      entry.mesh.visible = altitude < p.radius * 1.5;
      if (!entry.mesh.visible) continue;
      if (entry.centre && Math.hypot(localX - entry.centre[0], localY - entry.centre[1]) < p.refresh) continue;
      entry.centre = [localX, localY];
      this.populate(entry.mesh, p, localX, localY);
    }
  }

  place(matrix: T.Matrix4, sunDir: T.Vector3, earthDir: T.Vector3, earthshine: number) {
    for (const {mesh} of this.meshes) {mesh.matrix.copy(matrix); mesh.matrixWorld.copy(matrix);}
    this.uniforms.sunDir.value.copy(sunDir);
    this.uniforms.earthDir.value.copy(earthDir);
    this.uniforms.earthshine.value = earthshine;
  }

  /** Rendered boulders close enough to strike a vehicle, in the terrain's local metric frame. */
  collidersNear(lat: number, lon: number, radius: number) {
    const p = this.terrain.toLocal(lat, lon);
    return this.boulders.filter(b => Math.hypot(b.x - p.x, b.y - p.y) < radius + b.diameter * 0.5);
  }

  private populate(mesh: T.InstancedMesh, p: Population, cx: number, cy: number) {
    const info = mesh.geometry.getAttribute('rockInfo') as T.InstancedBufferAttribute;
    const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), up = new T.Vector3(), pos = new T.Vector3();
    const yaw = new T.Quaternion(), tilt = new T.Quaternion(), align = new T.Quaternion();
    const DEG = Math.PI / 180;
    let count = 0;
    if (p === BOULDERS) this.boulders = [];
    const i0 = Math.floor((cx - p.radius) / p.cell), i1 = Math.floor((cx + p.radius) / p.cell);
    const j0 = Math.floor((cy - p.radius) / p.cell), j1 = Math.floor((cy + p.radius) / p.cell);
    for (let j = j0; j <= j1 && count < p.maxInstances; j++) {
      for (let i = i0; i <= i1 && count < p.maxInstances; i++) {
        const x0 = (i + 0.5) * p.cell, y0 = (j + 0.5) * p.cell;
        if (Math.hypot(x0 - cx, y0 - cy) > p.radius) continue;
        const centre = this.terrain.fromLocal(x0, y0);
        const {ejecta} = this.terrain.sample(centre.lat, centre.lon, p.cell);
        // Rocks cluster: a 40 m patchiness field gives bare stretches and strewn fields instead of an even sprinkle.
        const patch = terrainHash(p.salt + 1, Math.floor(x0 / 40), Math.floor(y0 / 40), 9);
        const mean = p.base * (0.15 + 2.2 * patch * patch) + p.ejectaBoost * ejecta;
        // Up to three candidates per cell, each kept with probability mean/3 (Poisson-like, bounded).
        for (let k = 0; k < 3 && count < p.maxInstances; k++) {
          if (terrainHash(p.salt, i, j, k * 10) > mean / 3) continue;
          const x = (i + terrainHash(p.salt, i, j, k * 10 + 1)) * p.cell, y = (j + terrainHash(p.salt, i, j, k * 10 + 2)) * p.cell;
          const u = Math.max(0.002, terrainHash(p.salt, i, j, k * 10 + 3));
          const diameter = Math.min(p.dMax, p.dMin * u ** (-1 / p.slope));
          if (p === BOULDERS) this.boulders.push({x, y, diameter});
          const {lat, lon} = this.terrain.fromLocal(x, y);
          const ground = this.terrain.height(lat, lon);
          const cl = Math.cos(lat * DEG), sl = Math.sin(lat * DEG), co = Math.cos(lon * DEG), so = Math.sin(lon * DEG);
          const flatten = 0.5 + 0.35 * terrainHash(p.salt, i, j, k * 10 + 4);
          const radius = R_MOON + ground + diameter * 0.5 * flatten * 0.35; // about a third buried
          pos.set(cl * co * radius - this.anchor[0], cl * so * radius - this.anchor[1], sl * radius - this.anchor[2]);
          up.set(cl * co, cl * so, sl);
          align.setFromUnitVectors(new T.Vector3(0, 1, 0), up);
          yaw.setFromAxisAngle(new T.Vector3(0, 1, 0), terrainHash(p.salt, i, j, k * 10 + 5) * Math.PI * 2);
          tilt.setFromAxisAngle(new T.Vector3(1, 0, 0), (terrainHash(p.salt, i, j, k * 10 + 6) - 0.5) * 0.5);
          q.copy(align).multiply(yaw).multiply(tilt);
          s.set(diameter * 0.5 * (0.8 + 0.4 * terrainHash(p.salt, i, j, k * 10 + 7)), diameter * 0.5 * flatten, diameter * 0.5);
          m.compose(pos, q, s);
          mesh.setMatrixAt(count, m);
          info.setXYZ(count, 1.15 + 0.5 * ejecta + 0.25 * (terrainHash(p.salt, i, j, k * 10 + 8) - 0.5), (lon + 180) / 360, (90 - lat) / 180);
          count++;
        }
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    info.needsUpdate = true;
  }
}
