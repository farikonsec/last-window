import * as T from 'three';
import {R_MOON} from '../sim/constants';
import {exposure, globeGeometry, GLSL_COMMON, GLSL_LUNAR} from './common';

/** LOLA elevation grid, little-endian int16 metres, row 0 north, column 0 at 180 W. */
export class LunarElevation {
  constructor(readonly heights: Int16Array, readonly width: number, readonly height: number) {}

  static async load(url: string, width: number, height: number) {
    const buffer = await (await fetch(url)).arrayBuffer();
    return new LunarElevation(new Int16Array(buffer), width, height);
  }

  /** Bilinear height in metres at selenographic latitude/longitude, degrees. */
  sample(latDeg: number, lonDeg: number) {
    const x = (((lonDeg + 180) / 360) * this.width - 0.5 + this.width) % this.width;
    const y = Math.max(0, Math.min(this.height - 1.001, ((90 - latDeg) / 180) * this.height - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const at = (i: number, j: number) => this.heights[j * this.width + ((i % this.width) + this.width) % this.width];
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  }

  texture() {
    const data = new Float32Array(this.heights.length);
    for (let i = 0; i < data.length; i++) data[i] = this.heights[i];
    const t = new T.DataTexture(data, this.width, this.height, T.RedFormat, T.FloatType);
    t.internalFormat = 'R16F';
    t.wrapS = T.RepeatWrapping;
    t.wrapT = T.ClampToEdgeWrapping;
    t.magFilter = T.LinearFilter;
    t.minFilter = T.LinearFilter;
    t.flipY = false;
    t.needsUpdate = true;
    return t;
  }
}

/**
 * Whole-Moon globe for orbital views. LOLA-displaced vertices, normals from the elevation grid, LROC albedo and a
 * lunar-Lambert photometric function (McEwen 1991) with a small opposition surge. Earthshine is a second, faint light.
 */
export class MoonGlobe {
  mesh: T.Mesh;
  uniforms: Record<string, T.IUniform>;

  setCoverage(c: {south: number; west: number; north: number; east: number; active: boolean}) {
    this.uniforms.ringCover.value.set(c.south, c.west, c.north, c.east);
    this.uniforms.ringActive.value = c.active ? 1 : 0;
  }

  constructor(colour: T.Texture, elevation: T.Texture) {
    this.uniforms = {
      exposure,
      colourMap: {value: colour},
      heightMap: {value: elevation},
      texel: {value: new T.Vector2(1 / 2880, 1 / 1440)},
      radius: {value: R_MOON},
      fixedToWorld: {value: new T.Matrix3()},
      centre: {value: new T.Vector3()},
      sunDir: {value: new T.Vector3(1, 0, 0)},
      earthDir: {value: new T.Vector3(0, 1, 0)},
      earthshine: {value: 1e-4},
      albedoScale: {value: 0.26},
      ringCover: {value: new T.Vector4(0, 0, 0, 0)},
      ringActive: {value: 0},
    };
    const material = new T.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        uniform sampler2D heightMap; uniform float radius; uniform mat3 fixedToWorld; uniform vec3 centre;
        varying vec2 vUv; varying vec3 vFixed; varying vec3 vWorld;
        void main() {
          vUv = uv;
          vFixed = position;
          float h = textureLod(heightMap, uv, 0.0).r;
          // Camera-relative world position: centre is (Moon centre - camera).
          vWorld = centre + fixedToWorld * (position * (radius + h));
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <logdepthbuf_pars_fragment>
        ${GLSL_COMMON}
        ${GLSL_LUNAR}
        uniform sampler2D colourMap; uniform sampler2D heightMap; uniform vec2 texel; uniform float radius;
        uniform mat3 fixedToWorld; uniform vec3 sunDir; uniform vec3 earthDir; uniform float earthshine;
        uniform float exposure; uniform float albedoScale; uniform vec4 ringCover; uniform float ringActive;
        varying vec2 vUv; varying vec3 vFixed; varying vec3 vWorld;

        float height(vec2 uv) { return texture(heightMap, uv).r; }

        // Terrain shadow: march the elevation grid toward the Sun (1-150 km, exponential steps).
        // Nothing softens shadows on the Moon except the Sun's 0.53 degree disc, modelled as a thin penumbra.
        float castShadow(vec3 up, vec3 east, vec3 north, float lat) {
          vec3 sunFixed = transpose(fixedToWorld) * sunDir;
          float sinElevation = dot(sunFixed, up);
          if (sinElevation <= -0.01) return 0.0;
          if (sinElevation > 0.7) return 1.0;
          vec3 horizontal = sunFixed - up * sinElevation;
          float flatLen = length(horizontal);
          vec2 dir = vec2(dot(horizontal, east), dot(horizontal, north)) / max(flatLen, 1e-6);
          float slope = sinElevation / max(flatLen, 1e-6);
          float h0 = height(vUv) + 30.0;
          float visible = 1.0;
          float d = 1000.0;
          for (int i = 0; i < 22; i++) {
            vec2 uv = vUv + vec2(dir.x * d / (6.2831853 * radius * max(cos(lat), 0.02)), -dir.y * d / (3.14159265 * radius));
            // The surface curves away below the tangent plane: drop d^2 / 2R.
            float ray = h0 + d * slope + d * d / (2.0 * radius);
            float margin = ray - height(uv);
            // Penumbra: the Sun's half-width (0.0047 rad) spread over distance d.
            visible = min(visible, clamp(margin / (d * 0.0093) + 0.5, 0.0, 1.0));
            if (visible <= 0.0) break;
            d *= 1.27;
          }
          return visible;
        }

        void main() {
          if (ringActive > 0.5) {
            // Close-range terrain rings cover this lat/lon box (south, west, north, east).
            float latD = 90.0 - vUv.y * 180.0, lonD = vUv.x * 360.0 - 180.0;
            if (latD > ringCover.x && latD < ringCover.z && lonD > ringCover.y && lonD < ringCover.w) discard;
          }
          #include <logdepthbuf_fragment>
          vec3 up = normalize(vFixed);
          float lat = asin(clamp(up.z, -1.0, 1.0));
          vec3 east = normalize(vec3(-up.y, up.x, 0.0) + vec3(1e-6, 0.0, 0.0));
          vec3 north = cross(up, east);
          // Central differences on the elevation grid (v grows southward).
          float dEast = (height(vUv + vec2(texel.x, 0.0)) - height(vUv - vec2(texel.x, 0.0))) / (2.0 * texel.x * 6.2831853 * radius * max(cos(lat), 0.02));
          float dNorth = (height(vUv - vec2(0.0, texel.y)) - height(vUv + vec2(0.0, texel.y))) / (2.0 * texel.y * 3.14159265 * radius);
          vec3 n = normalize(fixedToWorld * normalize(up - east * dEast - north * dNorth));
          vec3 sphereN = normalize(fixedToWorld * up);
          vec3 view = normalize(-vWorld);

          vec3 albedo = srgbToLinear(texture(colourMap, vUv).rgb) * albedoScale;
          // Procedural relief and mottling so the global map is not a flat grey wash when seen from tens of km up.
          // Body-fixed surface metres (seam at the far-side meridian, away from the playable area) drive the noise;
          // every octave fades out once it drops below a pixel, so nothing shimmers, and the whole effect fades to a
          // disc at orbital range where per-pixel detail is invisible anyway.
          float dist = length(vWorld);
          float detail = clamp((260000.0 - dist) / 150000.0, 0.0, 1.0);
          if (detail > 0.0) {
            vec2 lp = vec2(atan(up.y, up.x) * radius * max(cos(lat), 0.02), lat * radius);
            float footprint = max(length(vec2(dFdx(lp.x), dFdy(lp.x))), length(vec2(dFdx(lp.y), dFdy(lp.y)))) + 1.0;
            vec2 slope = vec2(0.0); float albedoNoise = 0.0;
            float lambda = 1400.0, hAmp = 46.0, aAmp = 0.11;
            for (int i = 0; i < 6; i++) {
              float f = clamp((lambda / footprint - 2.5) / 5.0, 0.0, 1.0);
              if (f <= 0.0) break;
              vec3 nz = noised(lp / lambda + float(i) * 13.7);
              slope += nz.yz * (hAmp / lambda) * f;
              albedoNoise += (nz.x - 0.5) * aAmp * f;
              lambda *= 0.5; hAmp *= 0.56; aAmp *= 0.62;
            }
            n = normalize(n - (fixedToWorld * east * slope.x + fixedToWorld * north * slope.y) * detail);
            albedo *= 1.0 + albedoNoise * detail;
          }
          float mu0 = dot(n, sunDir), mu = max(dot(n, view), 0.0);
          float g = degrees(acos(clamp(dot(sunDir, view), -1.0, 1.0)));
          float L = clamp(1.0 - 0.019 * g + 2.42e-4 * g * g - 1.46e-6 * g * g * g, 0.0, 1.0);
          float lit = max(mu0, 0.0) * smoothstep(-0.015, 0.01, dot(sphereN, sunDir)) * castShadow(up, east, north, lat);
          float surge = 1.0 + 0.35 * exp(-tan(radians(g) * 0.5) / 0.05);
          float reflectance = lit > 0.0 ? (2.0 * L * lit / (lit + mu + 1e-4) + (1.0 - L) * lit) * surge : 0.0;
          vec3 radiance = albedo * reflectance;
          radiance += albedo * earthshine * max(dot(n, earthDir), 0.0);
          gl_FragColor = vec4(radiance * exposure, 1.0);
        }`,
    });
    this.mesh = new T.Mesh(globeGeometry(1024, 512), material);
    this.mesh.renderOrder = 1; // after the terrain, so its discarded fragments cost little
    this.mesh.frustumCulled = false;
  }
}
