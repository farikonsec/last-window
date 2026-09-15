import * as T from 'three';
import {R_MOON} from '../sim/constants';
import type {Mat3} from '../sim/ephemeris';
import {apply} from '../sim/ephemeris';
import type {LunarTerrain} from '../sim/terrain';
import {type V3, len, sub} from '../sim/vec';
import {exposure, GLSL_COMMON, GLSL_LUNAR} from './common';
import {anchorBodyFixed, buildRing, RING_QUADS, snapCentre} from './terrain-mesh';
import type {SunShadows} from './shadows';

const LEVELS = 16;
const TERRAIN_DEBUG = ['', 'albedo', 'normal', 'field', 'shadow', 'geometry'].indexOf(new URLSearchParams(globalThis.location?.search ?? '').get('debug') ?? '');
const FINEST_SPACING = 0.25;
/** Terrain self-shadow height field around the anchor: size x size texels at `spacing` metres (+-61 km). */
const FIELD = {size: 1536, spacing: 80};

interface Level {
  spacing: number;
  mesh: T.Mesh;
  material: T.ShaderMaterial;
  built: boolean;
  centreX: number;
  centreY: number;
  enabled: boolean;
}

export interface TerrainFrame {
  /** Moon body-fixed -> world (EQJ) rotation. */
  fixedToWorld: Mat3;
  /** Camera position in body-fixed metres (float64). */
  cameraBodyFixed: V3;
  /** Camera position in world metres from the Moon's centre. */
  cameraWorld: V3;
  sunDir: T.Vector3;
  earthDir: T.Vector3;
  earthshine: number;
}

/**
 * Close-range lunar surface: nested square rings of 129^2 vertices from 0.25 m to 8 km spacing, centred under the
 * camera and rebuilt from the shared surface function as it moves. Each ring discards the square its finer neighbour
 * covers; edges morph to the coarser ring (see terrain-mesh.ts), so the seams are exact.
 */
export class TerrainRings {
  group = new T.Group();
  levels: Level[] = [];
  /** Lat/lon bounds of the outermost enabled ring, for the globe to discard beneath it. */
  coverage = {south: 0, north: 0, west: 0, east: 0, active: false};
  altitude = Infinity;
  private anchor: V3;
  private field: T.DataTexture;
  private fieldHeight = 0;

  constructor(private terrain: LunarTerrain, colourMap: T.Texture, private shadows: SunShadows) {
    this.anchor = anchorBodyFixed(terrain);
    this.field = this.buildShadowField();
    this.group.matrixAutoUpdate = false;
    for (let level = 0; level < LEVELS; level++) {
      const material = this.makeMaterial(colourMap, level);
      const mesh = new T.Mesh(new T.BufferGeometry(), material);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      // Rings up to 64 m spacing cast into the sun shadow maps, each with a depth material that keeps its hole discard.
      if (FINEST_SPACING * 2 ** level <= 64) {
        mesh.layers.enable(shadows.layer);
        mesh.userData.shadowMaterial = new T.ShaderMaterial({
          uniforms: {holeMin: material.uniforms.holeMin, holeMax: material.uniforms.holeMax},
          vertexShader: [
            '#include <common>', '#include <logdepthbuf_pars_vertex>',
            'attribute vec2 offset; varying vec2 vOffset;',
            'void main() {', '  vOffset = offset;', '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
            '#include <logdepthbuf_vertex>', '}',
          ].join('\n'),
          fragmentShader: [
            '#include <logdepthbuf_pars_fragment>',
            'uniform vec2 holeMin; uniform vec2 holeMax; varying vec2 vOffset;',
            'void main() {', '  if (all(greaterThan(vOffset, holeMin)) && all(lessThan(vOffset, holeMax))) discard;',
            '#include <logdepthbuf_fragment>', '  gl_FragColor = vec4(0.0);', '}',
          ].join('\n'),
          colorWrite: false,
        });
      }
      this.group.add(mesh);
      this.levels.push({spacing: FINEST_SPACING * 2 ** level, mesh, material, built: false, centreX: 0, centreY: 0, enabled: false});
    }
  }

  /** Re-anchor to a new terrain origin: rebuild the self-shadow field there, rebind it, and force every ring to rebuild
   * around the new anchor. Called when the camera has roamed far enough that the clipmap must follow it. */
  reanchor(withField = true) {
    this.anchor = anchorBodyFixed(this.terrain);
    // Rebuilding the 1536^2 self-shadow field is a ~second of work — fine as a one-off on travel, too heavy to do while
    // roaming, so a light re-anchor skips it and disables the (now wrong) field self-shadow until the next full one.
    if (withField) {this.field.dispose(); this.field = this.buildShadowField();}
    for (const L of this.levels) {
      L.built = false; L.enabled = false; L.mesh.visible = false;
      L.material.uniforms.field.value = this.field;
      L.material.uniforms.fieldRef.value = this.fieldHeight;
      L.material.uniforms.fieldStrength.value = withField ? 1 : 0;
    }
  }

  /** Rebuild rings that the camera has moved away from, within a time budget. Returns rings rebuilt. */
  update(frame: TerrainFrame, budgetMs = 8) {
    const c = frame.cameraBodyFixed, r = len(c);
    const lat = Math.asin(c[2] / r) * 180 / Math.PI, lon = Math.atan2(c[1], c[0]) * 180 / Math.PI;
    const local = this.terrain.toLocal(lat, lon);
    const ground = this.terrain.height(lat, lon, 8);
    this.altitude = r - R_MOON - ground;
    const horizon = Math.sqrt(2 * R_MOON * (Math.max(this.altitude, 0) + 4500));
    const cover = Math.max(20_000, 1.3 * horizon);
    let minLevel = 0;
    while (minLevel < LEVELS - 1 && this.levels[minLevel].spacing < Math.max(0, this.altitude) / 250) minLevel++;
    let maxLevel = minLevel;
    while (maxLevel < LEVELS - 1 && this.levels[maxLevel].spacing * (RING_QUADS / 2) < cover) maxLevel++;
    const active = this.altitude < 150_000 && Math.hypot(local.x, local.y) < 400_000;

    const start = performance.now();
    let rebuilt = 0;
    // Coarse first: a stale fine ring stays covered by its parent; a missing parent would open a hole to space.
    for (let level = LEVELS - 1; level >= 0; level--) {
      const L = this.levels[level];
      L.enabled = active && level >= minLevel && level <= maxLevel;
      L.mesh.visible = L.enabled && L.built;
      if (!L.enabled) continue;
      const cx = snapCentre(local.x, L.spacing), cy = snapCentre(local.y, L.spacing);
      const stale = !L.built || Math.abs(cx - L.centreX) > L.spacing * 8 || Math.abs(cy - L.centreY) > L.spacing * 8;
      if (!stale || (rebuilt > 0 && performance.now() - start > budgetMs && L.built)) continue;
      const build = buildRing(this.terrain, level, L.spacing, cx, cy);
      L.mesh.geometry.dispose();
      L.mesh.geometry = build.geometry;
      L.centreX = cx; L.centreY = cy; L.built = true; L.mesh.visible = true;
      rebuilt++;
    }

    // Holes and coverage from what is actually built.
    let outer: Level | null = null;
    for (let level = 0; level < LEVELS; level++) {
      const L = this.levels[level];
      if (!L.mesh.visible) continue;
      outer = L;
      const inner = level > 0 ? this.levels[level - 1] : null;
      const u = L.material.uniforms;
      if (inner && inner.mesh.visible) {
        const half = inner.spacing * RING_QUADS / 2;
        u.holeMin.value.set(inner.centreX - half - L.centreX, inner.centreY - half - L.centreY);
        u.holeMax.value.set(inner.centreX + half - L.centreX, inner.centreY + half - L.centreY);
      } else {
        u.holeMin.value.set(1, 1); u.holeMax.value.set(-1, -1);
      }
      u.noiseOrigin.value.set(L.centreX % 4096, L.centreY % 4096);
      u.ringCentre.value.set(L.centreX, L.centreY);
    }
    if (outer) {
      const half = outer.spacing * RING_QUADS / 2 - outer.spacing; // tuck the globe under the last cell
      const sw = this.terrain.fromLocal(outer.centreX - half, outer.centreY - half), ne = this.terrain.fromLocal(outer.centreX + half, outer.centreY + half);
      this.coverage = {south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon, active: true};
    } else {
      this.coverage.active = false;
    }
    return rebuilt;
  }

  /** Place the rings for this frame (floating origin) and update lighting uniforms. */
  place(frame: TerrainFrame) {
    const [x, y, z] = frame.fixedToWorld;
    const anchorWorld = apply(frame.fixedToWorld, this.anchor);
    const t = sub(anchorWorld, frame.cameraWorld);
    const m = new T.Matrix4().set(
      x[0], y[0], z[0], t[0],
      x[1], y[1], z[1], t[1],
      x[2], y[2], z[2], t[2],
      0, 0, 0, 1,
    );
    // Local sun direction in the anchor's east/north/up frame, for the height-field shadow march.
    const lat = this.terrain.anchorLat * Math.PI / 180, lon = this.terrain.anchorLon * Math.PI / 180;
    const up: V3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    const east: V3 = [-Math.sin(lon), Math.cos(lon), 0], north: V3 = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
    const sw = [frame.sunDir.x, frame.sunDir.y, frame.sunDir.z] as V3;
    const sunFixed: V3 = [x[0] * sw[0] + x[1] * sw[1] + x[2] * sw[2], y[0] * sw[0] + y[1] * sw[1] + y[2] * sw[2], z[0] * sw[0] + z[1] * sw[1] + z[2] * sw[2]];
    const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const sunLocal = new T.Vector3(dot(sunFixed, east), dot(sunFixed, north), dot(sunFixed, up));
    for (const L of this.levels) {
      L.mesh.matrix.copy(m);
      L.mesh.matrixWorld.copy(m);
      const u = L.material.uniforms;
      u.sunDir.value.copy(frame.sunDir);
      u.earthDir.value.copy(frame.earthDir);
      u.earthshine.value = frame.earthshine;
      u.sunLocal.value.copy(sunLocal);
      u.eastWorld.value.set(...apply(frame.fixedToWorld, east));
    }
  }

  private buildShadowField() {
    const {size, spacing} = FIELD;
    const data = new Float32Array(size * size);
    const half = (size / 2) * spacing;
    this.fieldHeight = this.terrain.height(this.terrain.anchorLat, this.terrain.anchorLon, spacing);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const p = this.terrain.fromLocal(-half + (i + 0.5) * spacing, -half + (j + 0.5) * spacing);
        data[j * size + i] = this.terrain.height(p.lat, p.lon, spacing) - this.fieldHeight;
      }
    }
    const texture = new T.DataTexture(data, size, size, T.RedFormat, T.FloatType);
    // R32F, not R16F: half-float's ~1-2 m quantization at these heights terraced the field normal into contour ripples.
    texture.internalFormat = 'R32F';
    texture.magFilter = T.LinearFilter;
    texture.minFilter = T.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  private makeMaterial(colourMap: T.Texture, level: number) {
    const half = (FIELD.size / 2) * FIELD.spacing;
    return new T.ShaderMaterial({
      uniforms: {
        exposure,
        colourMap: {value: colourMap},
        albedoScale: {value: 0.26},
        sunDir: {value: new T.Vector3(1, 0, 0)},
        earthDir: {value: new T.Vector3(0, 1, 0)},
        earthshine: {value: 0},
        sunLocal: {value: new T.Vector3(0, 0, 1)},
        fieldStrength: {value: 1},
        eastWorld: {value: new T.Vector3(1, 0, 0)},
        holeMin: {value: new T.Vector2(1, 1)},
        holeMax: {value: new T.Vector2(-1, -1)},
        noiseOrigin: {value: new T.Vector2()},
        ringCentre: {value: new T.Vector2()},
        field: {value: this.field},
        fieldHalf: {value: half},
        fieldRef: {value: this.fieldHeight},
        spacing: {value: FINEST_SPACING * 2 ** level},
        debugMode: {value: TERRAIN_DEBUG},
        ...this.shadows.uniforms,
      },
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec2 offset; attribute float ejecta; attribute float height;
        varying vec2 vUv; varying vec2 vOffset; varying float vEjecta; varying float vHeight;
        varying vec3 vNormal; varying vec3 vWorld;
        void main() {
          vUv = uv; vOffset = offset; vEjecta = ejecta; vHeight = height;
          vNormal = normalize(mat3(modelMatrix) * normal);
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <logdepthbuf_pars_fragment>
        ${GLSL_COMMON}
        ${GLSL_LUNAR}
        ${this.shadows.glsl}
        uniform float exposure; uniform sampler2D colourMap; uniform float albedoScale;
        uniform vec3 sunDir; uniform vec3 earthDir; uniform float earthshine; uniform vec3 sunLocal;
        uniform vec2 holeMin; uniform vec2 holeMax; uniform vec2 noiseOrigin; uniform vec2 ringCentre; uniform vec3 eastWorld;
        uniform sampler2D field; uniform float fieldHalf; uniform float fieldRef; uniform float spacing; uniform int debugMode; uniform float fieldStrength;
        varying vec2 vUv; varying vec2 vOffset; varying float vEjecta; varying float vHeight;
        varying vec3 vNormal; varying vec3 vWorld;

        vec2 fieldUv(vec2 local) { return (local + fieldHalf) / (2.0 * fieldHalf); }
        bool inField(vec2 uv) { return all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0))); }
        /** 1 inside the field, fading to 0 over its outer 5%, so its edge never shows as a line. */
        float fieldWeight(vec2 uv) { return smoothstep(0.0, 0.05, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y))); }

        // March the regional height field (60 m texels: survey plus large craters) toward the Sun.
        // Coarse rings take their start height from the same field: their flat triangles sit below the bicubic field
        // on convex slopes, and marching from there found false shadows (the dotted rims seen from orbit).
        float fieldShadow(vec2 local, float h) {
          if (fieldStrength <= 0.0) return 1.0; // self-shadow field disabled (e.g. roaming far from its anchor)
          if (sunLocal.z <= 0.0) return 0.0;
          float horizontal = length(sunLocal.xy);
          if (horizontal < 1e-4) return 1.0;
          vec2 uv0 = fieldUv(local);
          if (!inField(uv0)) return 1.0;
          vec2 dir = sunLocal.xy / horizontal;
          float slope = sunLocal.z / horizontal;
          float own = mix(h - fieldRef, texture(field, uv0).r, smoothstep(2.0, 32.0, spacing));
          float start = own + 1.0 + 0.3 * spacing;
          float visible = 1.0, d = max(90.0, 2.5 * spacing);
          for (int i = 0; i < 28; i++) {
            vec2 uv = fieldUv(local + dir * d);
            if (!inField(uv)) break;
            float margin = start + d * slope + d * d / 3474800.0 - texture(field, uv).r;
            // Penumbra from the Sun's 0.53 degree disc, plus half a field texel so edges resolve smoothly.
            float soft = d * 0.0093 + 30.0;
            visible = min(visible, smoothstep(-soft, soft, margin));
            if (visible <= 0.0) break;
            d *= 1.2;
          }
          return mix(1.0, visible, fieldWeight(uv0));
        }

        // Relief normal from the 60 m field for rings too coarse to carry that detail in their vertices.
        vec3 fieldNormal(vec2 local, vec3 N, vec3 east, vec3 north, float footprint) {
          vec2 uv = fieldUv(local);
          if (!inField(uv)) return N;
          // Two-texel central differences: steep rille walls span only a few 60 m texels, one-texel steps look stepped.
          float e = 2.0 / 1536.0, texelMetres = 2.0 * fieldHalf / 1536.0;
          float dx = (texture(field, uv + vec2(e, 0.0)).r - texture(field, uv - vec2(e, 0.0)).r) / (2.0 * texelMetres);
          float dy = (texture(field, uv + vec2(0.0, e)).r - texture(field, uv - vec2(0.0, e)).r) / (2.0 * texelMetres);
          vec3 fieldN = normalize(N - east * dx - north * dy);
          // Weight by pixel footprint, which is continuous across ring boundaries (ring spacing would leave square seams).
          return normalize(mix(N, fieldN, smoothstep(12.0, 50.0, footprint) * fieldWeight(uv)));
        }

        void main() {
          if (all(greaterThan(vOffset, holeMin)) && all(lessThan(vOffset, holeMax))) discard;
          #include <logdepthbuf_fragment>
          vec3 view = normalize(-vWorld);
          vec3 N = normalize(vNormal);
          // Ground tangent frame matching the local x (east) / y (north) coordinates used by the noise.
          vec3 east = normalize(eastWorld - N * dot(eastWorld, N));
          vec3 north = cross(N, east);
          vec2 local = vOffset + ringCentre;
          vec2 p = vOffset + noiseOrigin;
          float footprint = max(length(dFdx(p)), length(dFdy(p))) + 1e-4;
          N = fieldNormal(local, N, east, north, footprint);

          // Metre-to-centimetre regolith relief as height noise: slope = amplitude * gradient / wavelength.
          // Each octave is rotated so no grid direction lines up; octaves fade before a pixel can alias them.
          vec2 slope = vec2(0.0);
          float albedoNoise = 0.0;
          float lambda = 2.6, heightAmp = 0.05;
          mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
          vec2 q = p;
          for (int i = 0; i < 7; i++) {
            float fade = clamp((lambda / footprint - 3.0) / 6.0, 0.0, 1.0);
            if (fade <= 0.0) break;
            vec3 nz = noised(q / lambda + float(i) * 17.3);
            slope += nz.yz * (heightAmp / lambda) * fade;
            albedoNoise += (nz.x - 0.5) * 0.08 * fade;
            lambda *= 0.45; heightAmp *= 0.62;
            q = turn * q;
          }
          // Scattered pebbles: sparse, a few centimetres, slightly brighter; a gentle dome, not a hemisphere.
          float pebble = 0.0;
          float pebbleFade = clamp((0.15 / footprint - 2.0) / 4.0, 0.0, 1.0);
          if (pebbleFade > 0.0) {
            vec2 cell = floor(p / 0.15), f = fract(p / 0.15);
            vec2 centre = hash22(cell) * 0.6 + 0.2;
            float size = 0.1 + 0.25 * hash12(cell + 3.1) * hash12(cell + 5.3);
            float d = length(f - centre) / size;
            if (hash12(cell + 7.7) < 0.07 && d < 1.0) {
              pebble = (1.0 - d * d) * pebbleFade;
              slope += (f - centre) / size * 0.5 * pebbleFade;
            }
          }
          // Sub-centimetre grain: a per-millimetre-cell speckle that averages out to nothing once pixels are larger.
          float grainFade = clamp((0.02 / footprint - 1.5) / 3.0, 0.0, 1.0);
          albedoNoise += (hash12(floor(p / 0.006)) - 0.5) * 0.22 * grainFade;
          vec3 n = normalize(N - east * slope.x - north * slope.y);

          vec3 albedo = srgbToLinear(texture(colourMap, vUv).rgb) * albedoScale;
          // Normalise the orbital colour map toward regolith grey, then add local variation and fresh ejecta.
          float grey = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
          albedo = mix(vec3(grey), albedo, 0.55) * vec3(1.0, 0.985, 0.955);
          // Hectometre-to-kilometre mottling (small craters' ejecta, space weathering) below the 1.3 km colour map.
          float broad = 0.0, bl = 900.0, ba = 0.07;
          for (int i = 0; i < 4; i++) {
            float fade = clamp((bl / footprint - 2.0) / 4.0, 0.0, 1.0);
            broad += (noised(mod(local, 65536.0) / bl + 3.7 * float(i)).x - 0.5) * ba * fade;
            bl *= 0.4; ba *= 0.85;
          }
          albedo *= (1.0 + albedoNoise + broad) * (1.0 + 0.55 * vEjecta) * (1.0 + 0.35 * pebble);

          float mu0 = dot(n, sunDir), mu = dot(n, view);
          float g = acos(clamp(dot(sunDir, view), -1.0, 1.0));
          float lit = smoothstep(-0.03, 0.06, dot(N, sunDir));
          lit *= fieldShadow(local, vHeight);
          lit *= sunShadow(vWorld, normalize(vNormal));
          vec3 radiance = albedo * lunarLambert(max(mu0, 0.0), mu, g, 0.9) * lit;
          radiance += albedo * earthshine * max(dot(n, earthDir), 0.0);
          // Light bounced off nearby sunlit regolith: a few percent of direct sun, the only thing that keeps crater
          // shadows from being pure black on camera. Scales with how high the Sun stands.
          radiance += albedo * 0.06 * clamp(sunLocal.z * 2.5, 0.0, 1.0) * (1.0 - lit * 0.7);
          gl_FragColor = vec4(radiance * exposure, 1.0);
          // Debug views (?debug=): 1 albedo, 2 shading normal, 3 field shadow, 4 sun-map shadow, 5 geometric normal.
          if (debugMode == 1) gl_FragColor = vec4(albedo * 2.5, 1.0);
          if (debugMode == 2) gl_FragColor = vec4(vec3(max(dot(n, sunDir), 0.0)), 1.0);
          if (debugMode == 3) gl_FragColor = vec4(vec3(fieldShadow(local, vHeight)), 1.0);
          if (debugMode == 4) gl_FragColor = vec4(vec3(sunShadow(vWorld, normalize(vNormal))), 1.0);
          if (debugMode == 5) gl_FragColor = vec4(vec3(max(dot(normalize(vNormal), sunDir), 0.0)), 1.0);
        }`,
    });
  }
}
