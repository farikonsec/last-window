import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {R_MOON} from '../sim/constants';
import type {LunarTerrain} from '../sim/terrain';
import {assetUrl, exposure, GLSL_COMMON} from './common';
import type {SunShadows} from './shadows';
import {anchorBodyFixed} from './terrain-mesh';

/** Lighting inputs shared by every hardware material, updated once per frame. */
export const hardwareLight = {
  sunDir: {value: new T.Vector3(1, 0, 0)},
  earthDir: {value: new T.Vector3(0, 1, 0)},
  upDir: {value: new T.Vector3(0, 0, 1)},
  earthshine: {value: 0},
  groundRadiance: {value: 0.02},
  /** Soft inspection-camera fill used only by ARGO's dedicated orbit view so the shaded truss remains readable. */
  inspectionFill: {value: 0},
  /** KESTREL's docking floodlight: camera-relative position, beam axis, and radiant intensity (0 = off). */
  lampPos: {value: new T.Vector3()},
  lampDir: {value: new T.Vector3(0, 0, 1)},
  lampIntensity: {value: 0},
};

/**
 * Metal/rough PBR for spacecraft under a single hard Sun, in the same radiance units as the terrain (a white Lambert
 * surface facing the Sun has radiance 1). GGX specular, Lambert diffuse, sun shadow maps, earthshine, and a two-tone
 * environment: black sky above the horizon, sunlit regolith below. That lower half is what makes gold foil and polished
 * aluminium read as metal on the Moon, where there is no sky light at all.
 */
export function hardwareMaterial(source: T.MeshStandardMaterial, shadows: SunShadows) {
  const map = source.map ?? null;
  if (map) map.colorSpace = T.NoColorSpace;
  const emissive = source.emissive ? source.emissive.clone().multiplyScalar(source.emissiveIntensity ?? 1) : new T.Color(0, 0, 0);
  return new T.ShaderMaterial({
    uniforms: {
      solarVisibility: {value: 1}, receiveSunShadows: {value: 1},
      exposure, ...hardwareLight, ...shadows.uniforms,
      baseColour: {value: source.color.clone()},
      metalness: {value: source.metalness ?? 0},
      roughness: {value: Math.max(0.08, source.roughness ?? 0.5)},
      emissiveColour: {value: new T.Vector3(emissive.r, emissive.g, emissive.b)},
      colourMap: {value: map},
      hasMap: {value: map ? 1 : 0},
    },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vNormal; varying vec3 vWorld; varying vec2 vUv;
      void main() {
        vUv = uv;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <logdepthbuf_pars_fragment>
      ${GLSL_COMMON}
      ${shadows.glsl}
      uniform float exposure; uniform vec3 sunDir; uniform vec3 earthDir; uniform vec3 upDir; uniform float earthshine;
      uniform float solarVisibility; uniform float receiveSunShadows;
      uniform float groundRadiance; uniform float inspectionFill; uniform vec3 lampPos; uniform vec3 lampDir; uniform float lampIntensity; uniform vec3 baseColour; uniform float metalness; uniform float roughness;
      uniform vec3 emissiveColour; uniform sampler2D colourMap; uniform float hasMap;
      varying vec3 vNormal; varying vec3 vWorld; varying vec2 vUv;

      float ggx(float nh, float a) { float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (3.14159265 * d * d); }
      float smith(float nv, float nl, float a) { float k = a * 0.5; return (nv / (nv * (1.0 - k) + k)) * (nl / (nl * (1.0 - k) + k)); }

      void main() {
        #include <logdepthbuf_fragment>
        vec3 n = normalize(vNormal);
        vec3 v = normalize(-vWorld);
        if (dot(n, v) < 0.0) n = -n; // thin shells (engine bells, flags) are seen from both sides
        vec3 albedo = baseColour * (hasMap > 0.5 ? srgbToLinear(texture(colourMap, vUv).rgb) : vec3(1.0));
        float a = roughness * roughness;
        vec3 F0 = mix(vec3(0.04), albedo, metalness);
        float nl = max(dot(n, sunDir), 0.0), nv = max(dot(n, v), 1e-3);
        vec3 h = normalize(sunDir + v);
        float nh = max(dot(n, h), 0.0), vh = max(dot(v, h), 0.0);
        vec3 F = F0 + (1.0 - F0) * pow(1.0 - vh, 5.0);
        float shadow = solarVisibility * (receiveSunShadows > 0.5 ? sunShadow(vWorld, normalize(vNormal)) : 1.0);
        // Irradiance convention: the Sun delivers pi, so Lambert radiance = albedo * cos.
        vec3 specular = ggx(nh, a) * smith(nv, nl, a) * F / max(4.0 * nv * nl, 1e-4) * 3.14159265 * nl;
        vec3 diffuse = albedo * (1.0 - metalness) * nl;
        vec3 radiance = (diffuse + min(specular, vec3(2.5))) * shadow;
        // Environment: sunlit ground below the horizon, black sky above.
        vec3 r = reflect(-v, n);
        float groundSeen = 1.0 - smoothstep(-0.08 - a, 0.08 + a, dot(r, upDir));
        vec3 Fenv = F0 + (1.0 - F0) * pow(1.0 - nv, 5.0) * (1.0 - a);
        radiance += Fenv * groundRadiance * groundSeen;
        radiance += albedo * (1.0 - metalness) * groundRadiance * 0.5 * (1.0 - dot(n, upDir));
        radiance += albedo * earthshine * max(dot(n, earthDir), 0.0);
        radiance += mix(albedo, F0, metalness) * inspectionFill;
        // Docking floodlight: a 40-degree beam from KESTREL's nose, so a target in Earth's shadow or against the Sun
        // still shows its port. Inverse square, capped at 0.3 of full Sun inside ~19 m so the port never blows out.
        if (lampIntensity > 0.0) {
          vec3 toLamp = lampPos - vWorld; float d2 = dot(toLamp, toLamp); vec3 l = toLamp * inversesqrt(d2);
          float beam = smoothstep(0.93, 0.985, dot(-l, lampDir));
          float ln = max(dot(n, l), 0.0);
          if (beam > 0.0 && ln > 0.0) {
            vec3 hl = normalize(l + v);
            vec3 Fl = F0 + (1.0 - F0) * pow(1.0 - max(dot(v, hl), 0.0), 5.0);
            vec3 specL = ggx(max(dot(n, hl), 0.0), max(a, 0.12)) * smith(nv, ln, a) * Fl / max(4.0 * nv * ln, 1e-4) * 3.14159265 * ln;
            radiance += (albedo * (1.0 - metalness) * ln + min(specL, vec3(0.8))) * beam * min(0.3, lampIntensity / d2);
          }
        }
        // Emissive lights and lit windows: glTF emissive strength scaled into scene radiance.
        radiance += emissiveColour * 0.05;
        // A faint ambient floor (deep-space starlight and scattered fill) so a backlit hull never reads as pure black.
        radiance += albedo * 0.02;
        gl_FragColor = vec4(radiance * exposure, 1.0);
      }`,
  });
}

export interface Placement {
  name: string;
  url: string;
  lat: number;
  lon: number;
  /** Direction the model's front (+Z) faces, degrees clockwise from north. */
  heading: number;
  /** Metres above the ground at the origin (0 = standing on it). */
  lift?: number;
  /** Nose-up tilt in radians (a driven vehicle following the fore-aft slope). */
  pitch?: number;
  /** Bank in radians, right side up positive (following the side slope). */
  roll?: number;
}

/**
 * Loads glTF hardware, swaps every material for `hardwareMaterial`, and stands each model on the shared surface
 * function at its latitude/longitude. Models live in the terrain's anchor frame, so the terrain's per-frame matrix
 * (body-fixed to camera-relative world) places them too.
 */
export class HardwareSet {
  group = new T.Group();
  objects = new Map<string, T.Object3D>();
  private anchor: [number, number, number];
  private loader = new GLTFLoader();

  constructor(private terrain: LunarTerrain, private shadows: SunShadows) {
    this.anchor = anchorBodyFixed(terrain);
    this.group.matrixAutoUpdate = false;
  }

  async load(placements: Placement[]) {
    await Promise.all(placements.map(async p => {
      const gltf = await this.loader.loadAsync(assetUrl(p.url));
      const model = gltf.scene;
      model.traverse(o => {
        const mesh = o as T.Mesh;
        if (!mesh.isMesh) return;
        const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const converted = sources.map(m => hardwareMaterial(m as T.MeshStandardMaterial, this.shadows));
        mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
        mesh.frustumCulled = false;
        mesh.layers.enable(this.shadows.layer);
      });
      const holder = new T.Group();
      holder.name = p.name;
      holder.add(model);
      holder.matrixAutoUpdate = false;
      holder.matrix.copy(this.placementMatrix(p));
      this.group.add(holder);
      this.objects.set(p.name, holder);
    }));
  }

  /** Model frame (+Y up, +Z front) -> terrain anchor frame (body-fixed, relative to the anchor point). */
  placementMatrix(p: Placement) {
    const DEG = Math.PI / 180;
    const lat = p.lat * DEG, lon = p.lon * DEG, h = p.heading * DEG;
    const up = new T.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
    const east = new T.Vector3(-Math.sin(lon), Math.cos(lon), 0);
    const north = new T.Vector3().crossVectors(up, east);
    const front = north.clone().multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
    const right = new T.Vector3().crossVectors(up, front);
    const r = R_MOON + this.terrain.height(p.lat, p.lon) + (p.lift ?? 0);
    const origin = up.clone().multiplyScalar(r).sub(new T.Vector3(...this.anchor));
    const base = new T.Matrix4().makeBasis(right, up, front).setPosition(origin);
    // A driven vehicle tilts in its own frame: pitch about +X (nose up) and roll about +Z (bank), applied before the
    // stand-up basis so the model leans on the slope instead of sitting flat.
    if (p.pitch || p.roll) {
      const lean = new T.Matrix4().makeRotationX(-(p.pitch ?? 0)).multiply(new T.Matrix4().makeRotationZ(p.roll ?? 0));
      base.multiply(lean);
    }
    return base;
  }

  /** Follow the terrain's anchor transform for this frame. */
  place(anchorToWorld: T.Matrix4) {
    this.group.matrix.copy(anchorToWorld);
    this.group.updateMatrixWorld(true);
  }
}

/** Where things stand at Hadley. Apollo 15 LM position from LROC; the rest relative to it. */
export const APOLLO15_LM = {lat: 26.13222, lon: 3.63386};
/** KESTREL lands 2.1 km east of Apollo 15, outside NASA's recommended 2 km heritage keep-out for landings. */
export const KESTREL_PAD = {lat: 26.1322, lon: 3.7115};

export function offset(from: {lat: number; lon: number}, eastMetres: number, northMetres: number) {
  const DEG = Math.PI / 180;
  return {lat: from.lat + northMetres / (R_MOON * DEG), lon: from.lon + eastMetres / (R_MOON * DEG * Math.cos(from.lat * DEG))};
}

export const HADLEY_HARDWARE: Placement[] = [
  {name: 'apollo15-lm', url: 'models/apollo-lm-descent.glb', ...APOLLO15_LM, heading: 280},
  {name: 'apollo15-flag', url: 'models/flag-us.glb', ...offset(APOLLO15_LM, 9, 6), heading: 250},
  // The rover was parked about 90 m east of the LM, its TV camera facing west to film the liftoff.
  {name: 'apollo15-lrv', url: 'models/lrv.glb', ...offset(APOLLO15_LM, 90, -8), heading: 270},
  {name: 'apollo15-alsep', url: 'models/alsep.glb', ...offset(APOLLO15_LM, -105, 30), heading: 90},
  {name: 'kestrel', url: 'models/kestrel.glb', ...KESTREL_PAD, heading: 132},
  {name: 'un-flag', url: 'models/flag-us.glb', ...offset(KESTREL_PAD, -12, 9), heading: 200},
  // The crew's fast buggy, parked a few metres from KESTREL; driven live, so re-placed every frame from its sim state.
  {name: 'buggy', url: 'models/buggy.glb', ...offset(KESTREL_PAD, 10, -5), heading: 90},
];
