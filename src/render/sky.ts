import * as T from 'three';
import {SUN_RADIUS} from '../sim/ephemeris';
import {exposure, SUN_RADIANCE} from './common';

/** Sky objects sit on this sphere around the camera (inside the far plane). */
export const SKY_RADIUS = 1e10;

const logDepthVertexPars = '#include <common>\n#include <logdepthbuf_pars_vertex>';

export type StarMode = 'real' | 'bright' | 'off';

/**
 * Stars from the Yale Bright Star Catalogue, drawn as point spread functions with physically scaled brightness.
 * A V = 0 star delivers 2.0e-11 of the Sun's irradiance; spread over one pixel's solid angle that is its radiance in
 * the same units as the lit surfaces, so a sunlit landscape really does wash the stars out.
 */
export class Stars {
  points: T.Points;
  mode: StarMode = 'real';
  private material: T.ShaderMaterial;

  constructor(catalogue: Float32Array) {
    const count = catalogue.length / 4;
    const positions = new Float32Array(count * 3), colours = new Float32Array(count * 3), flux = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const ra = catalogue[i * 4], dec = catalogue[i * 4 + 1], vmag = catalogue[i * 4 + 2], bv = catalogue[i * 4 + 3];
      positions.set([Math.cos(dec) * Math.cos(ra) * SKY_RADIUS, Math.cos(dec) * Math.sin(ra) * SKY_RADIUS, Math.sin(dec) * SKY_RADIUS], i * 3);
      colours.set(bvToRgb(bv), i * 3);
      flux[i] = Math.PI * 2.02e-11 * 10 ** (-0.4 * vmag);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(positions, 3));
    g.setAttribute('starColour', new T.BufferAttribute(colours, 3));
    g.setAttribute('flux', new T.BufferAttribute(flux, 1));
    this.material = new T.ShaderMaterial({
      uniforms: {exposure, pixelSolidAngle: {value: 6e-7}, boost: {value: 1}, pixelRatio: {value: 1}},
      vertexShader: /* glsl */`
        ${logDepthVertexPars}
        attribute vec3 starColour; attribute float flux;
        uniform float exposure; uniform float pixelSolidAngle; uniform float boost; uniform float pixelRatio;
        varying vec3 vColour;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
          // Radiance if the star's light landed in one device pixel.
          float radiance = flux * boost * exposure / pixelSolidAngle;
          // Saturated stars grow a little instead of clipping, like a real sensor's blooming core.
          float size = 2.0 * pixelRatio * clamp(sqrt(max(radiance, 1.0)), 1.0, 3.0);
          gl_PointSize = size;
          // Spread the same energy over the point: the Gaussian below integrates to ~0.224 of the square.
          vColour = starColour * radiance / (size * size * 0.224);
        }`,
      fragmentShader: /* glsl */`
        #include <logdepthbuf_pars_fragment>
        varying vec3 vColour;
        void main() {
          #include <logdepthbuf_fragment>
          vec2 d = gl_PointCoord - 0.5;
          float psf = exp(-dot(d, d) * 14.0);
          if (psf < 0.01) discard;
          gl_FragColor = vec4(vColour * psf, 1.0);
        }`,
      blending: T.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.points = new T.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -10;
  }

  /** heightPx: drawing-buffer height in device pixels. */
  update(camera: T.PerspectiveCamera, heightPx: number, pixelRatio: number) {
    const pixelAngle = (camera.fov * Math.PI) / 180 / heightPx;
    this.material.uniforms.pixelSolidAngle.value = pixelAngle * pixelAngle;
    this.material.uniforms.pixelRatio.value = pixelRatio;
    this.material.uniforms.boost.value = this.mode === 'bright' ? 30 : 1;
    this.points.visible = this.mode !== 'off';
  }
}

/** Approximate sRGB-linear colour for a B-V index (Ballesteros temperature, then a blackbody tint). */
export function bvToRgb(bv: number): [number, number, number] {
  const kelvin = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.7 * (t - 60) ** -0.133;
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.1 : 288.1 * (t - 60) ** -0.0755;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5 * Math.log(t - 10) - 305;
  const lin = (x: number) => {const c = Math.max(0, Math.min(255, x)) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;};
  const rgb = [lin(r), lin(g), lin(b)];
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return rgb.map(c => c / lum) as [number, number, number];
}

/**
 * Milky Way background (NASA SVS Deep Star Maps 2020, bright stars removed) on an inside-out sphere.
 * Surface brightness is scaled to ~2e-7 of sunlit regolith, so it only appears with dark-adapted exposure.
 */
export class MilkyWay {
  mesh: T.Mesh;

  constructor(texture: T.Texture) {
    texture.colorSpace = T.NoColorSpace;
    const material = new T.ShaderMaterial({
      uniforms: {map: {value: texture}, exposure, scale: {value: 6e-7}},
      vertexShader: /* glsl */`
        ${logDepthVertexPars}
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D map; uniform float exposure; uniform float scale;
        varying vec3 vDir;
        vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
        void main() {
          #include <logdepthbuf_fragment>
          vec3 d = normalize(vDir);
          float ra = atan(d.y, d.x), dec = asin(clamp(d.z, -1.0, 1.0));
          // Map centred on 0h with right ascension increasing to the left; first row is +90 dec.
          vec2 uv = vec2(fract(0.5 - ra / 6.2831853), 0.5 - dec / 3.14159265);
          vec3 c = srgbToLinear(textureLod(map, uv, 0.0).rgb);
          gl_FragColor = vec4(c * scale * exposure, 1.0);
        }`,
      side: T.BackSide, depthWrite: false,
    });
    this.mesh = new T.Mesh(new T.SphereGeometry(SKY_RADIUS * 1.05, 64, 32), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -20;
  }
}

/** The Sun's disc with limb darkening, drawn at its true angular size, plus a faint lens glare. */
export class SunDisc {
  mesh: T.Mesh;
  private material: T.ShaderMaterial;

  constructor() {
    this.material = new T.ShaderMaterial({
      uniforms: {exposure, radiance: {value: SUN_RADIANCE}},
      vertexShader: /* glsl */`
        ${logDepthVertexPars}
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          // Billboard: keep the quad facing the camera.
          vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float size = length(modelMatrix[0].xyz);
          centre.xy += position.xy * size;
          gl_Position = projectionMatrix * centre;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <logdepthbuf_pars_fragment>
        uniform float exposure; uniform float radiance;
        varying vec2 vUv;
        void main() {
          #include <logdepthbuf_fragment>
          float r = length(vUv) * 4.0; // quad spans 8 solar radii edge to edge
          float mu = sqrt(max(0.0, 1.0 - r * r));
          float disc = r < 1.0 ? (0.3 + 0.7 * mu) : 0.0; // linear limb darkening, u = 0.7
          float glare = 0.004 * exp(-(r - 1.0) * 2.2) * step(1.0, r);
          float value = min((disc + glare) * radiance * exposure, 90.0);
          if (value <= 0.0001) discard;
          gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * value, 1.0);
        }`,
      blending: T.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.mesh = new T.Mesh(new T.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
  }

  /** Place the disc along `direction` (unit) at a proxy distance with the true angular size. */
  place(direction: T.Vector3, distanceToSun: number) {
    const proxy = SKY_RADIUS * 0.9;
    this.mesh.position.copy(direction).multiplyScalar(proxy);
    this.mesh.scale.setScalar(8 * SUN_RADIUS * (proxy / distanceToSun));
  }
}
