import * as T from 'three';
import type {Mat3} from '../sim/ephemeris';
import type {V3} from '../sim/vec';

/**
 * Rendering conventions
 * - World axes are J2000 equatorial (EQJ), so stars never move. Units are metres.
 * - Floating origin: the camera sits at the render origin. Every object is placed at (position - camera) each frame
 *   from float64 state, so float32 GPU coordinates stay precise next to the camera.
 * - Custom shaders output linear radiance multiplied by the shared `exposure` uniform. The HDR buffer therefore holds
 *   display-scale values (half-float friendly), bloom runs on that, and OutputPass applies ACES + sRGB.
 *   Radiance unit: a white Lambert surface facing the Sun has radiance 1.
 */
export const exposure = {value: 1};

/** Solar-irradiance-relative radiance of the Sun's disc: 1 / (solid angle of the Sun at 1 AU) ~ 14,700 x white paper. */
export const SUN_RADIANCE = 1 / 6.8e-5;

export const toThree = (v: V3) => new T.Vector3(v[0], v[1], v[2]);

export function matrix3(m: Mat3) {
  const [x, y, z] = m;
  return new T.Matrix3().set(x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]);
}

/** GLSL helpers shared by body shaders. */
export const GLSL_COMMON = /* glsl */`
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
`;

/**
 * Latitude/longitude grid on the unit sphere in a body-fixed frame (x lon 0, z north).
 * uv.x = (lon + 180) / 360 and uv.y = (90 - lat) / 180, matching equirectangular maps whose first row is north and
 * first column 180 W (NASA SVS, Blue Marble). Textures must be loaded with flipY = false.
 */
export function globeGeometry(lonSegments: number, latSegments: number) {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let j = 0; j <= latSegments; j++) {
    const v = j / latSegments, lat = Math.PI / 2 - v * Math.PI;
    for (let i = 0; i <= lonSegments; i++) {
      const u = i / lonSegments, lon = u * 2 * Math.PI - Math.PI;
      positions.push(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
      uvs.push(u, v);
    }
  }
  const row = lonSegments + 1;
  for (let j = 0; j < latSegments; j++) {
    for (let i = 0; i < lonSegments; i++) {
      const a = j * row + i, b = a + row;
      // Seen from outside with north up, east is to the right: a (NW), b (SW), a + 1 (NE) is counter-clockwise.
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

/** Equirectangular map, decoded from sRGB manually in shaders. */
export function loadMap(loader: T.TextureLoader, url: string) {
  const texture = loader.load(url);
  texture.flipY = false;
  texture.wrapS = T.RepeatWrapping;
  texture.wrapT = T.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = T.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = T.LinearMipmapLinearFilter;
  return texture;
}

export const assetUrl = (path: string) => new URL(path, document.baseURI).toString();

/** Hash noise, gradient noise and the lunar photometric function, shared by terrain and rocks. */
export const GLSL_LUNAR = /* glsl */`
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
/** Gradient (Perlin-style) noise with analytic derivatives: returns (value in ~[0,1], d/dx, d/dy).
 *  Value noise showed its grid as blocky facets in the shading normals, so this uses random gradients. */
vec2 gradient2(vec2 i) {
  float a = hash12(i) * 6.2831853;
  return vec2(cos(a), sin(a));
}
vec3 noised(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = gradient2(i), gb = gradient2(i + vec2(1, 0)), gc = gradient2(i + vec2(0, 1)), gd = gradient2(i + vec2(1, 1));
  float va = dot(ga, f), vb = dot(gb, f - vec2(1, 0)), vc = dot(gc, f - vec2(0, 1)), vd = dot(gd, f - vec2(1, 1));
  float value = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd);
  vec2 deriv = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
             + du * (u.yx * (va - vb - vc + vd) + vec2(vb, vc) - va);
  return vec3(0.5 + 0.7 * value, 0.7 * deriv);
}
/**
 * Lunar-Lambert (McEwen 1991) with an opposition surge. mu0/mu are cosines to Sun and viewer, g is phase angle (rad).
 * Returns reflectance to multiply by albedo; 1.0 for a white Lambert surface facing the Sun.
 */
float lunarLambert(float mu0, float mu, float g, float surge) {
  if (mu0 <= 0.0) return 0.0;
  float gd = degrees(g);
  float L = clamp(1.0 - 0.019 * gd + 2.42e-4 * gd * gd - 1.46e-6 * gd * gd * gd, 0.0, 1.0);
  float opposition = 1.0 + surge * exp(-tan(g * 0.5) / 0.06);
  return (2.0 * L * mu0 / (mu0 + max(mu, 0.0) + 1e-4) + (1.0 - L) * mu0) * opposition;
}
`;
