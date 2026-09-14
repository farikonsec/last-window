import * as T from 'three';
import {EARTH_RADIUS} from '../sim/ephemeris';
import {exposure, globeGeometry, GLSL_COMMON} from './common';

/**
 * Earth as seen from the Moon: Blue Marble surface, cloud layer, city lights on the night side, an ocean sun glint
 * and a thin scattering rim. Its phase and rotation come from the ephemeris.
 * Art-directed: night lights are boosted about 20x so they read at the exposures a sunlit crescent allows.
 */
export class EarthGlobe {
  group = new T.Group();
  uniforms: Record<string, T.IUniform>;

  constructor(day: T.Texture, night: T.Texture, clouds: T.Texture) {
    this.uniforms = {
      exposure, dayMap: {value: day}, nightMap: {value: night}, cloudMap: {value: clouds},
      fixedToWorld: {value: new T.Matrix3()}, centre: {value: new T.Vector3()}, radius: {value: EARTH_RADIUS},
      sunDir: {value: new T.Vector3(1, 0, 0)}, nightBoost: {value: 0.02},
    };
    const vertexShader = /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform mat3 fixedToWorld; uniform vec3 centre; uniform float radius; uniform float shell;
      varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
      void main() {
        vUv = uv;
        vNormal = fixedToWorld * position;
        vWorld = centre + vNormal * radius * shell;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        #include <logdepthbuf_vertex>
      }`;
    const surface = new T.ShaderMaterial({
      uniforms: {...this.uniforms, shell: {value: 1}},
      vertexShader,
      fragmentShader: /* glsl */`
        #include <logdepthbuf_pars_fragment>
        ${GLSL_COMMON}
        uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D cloudMap;
        uniform vec3 sunDir; uniform float exposure; uniform float nightBoost;
        varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 n = normalize(vNormal), view = normalize(-vWorld);
          vec3 day = srgbToLinear(texture(dayMap, vUv).rgb);
          float cloud = pow(texture(cloudMap, vUv).r, 1.4);
          float ocean = smoothstep(0.02, 0.06, day.b - day.r) * (1.0 - cloud);
          float mu0 = dot(n, sunDir), mu = max(dot(n, view), 0.0);
          float lit = smoothstep(-0.04, 0.12, mu0) * max(mu0 + 0.04, 0.0);
          vec3 ground = mix(day * 0.9, vec3(0.78), cloud);
          // Blue haze thickens toward the limb.
          ground = mix(ground, vec3(0.22, 0.36, 0.75) * 0.5, 0.45 * pow(1.0 - mu, 2.0));
          vec3 h = normalize(sunDir + view);
          float glint = ocean * pow(max(dot(n, h), 0.0), 180.0) * 2.5;
          // Twilight reddening in a narrow band at the terminator.
          vec3 twilight = vec3(1.0, 0.45, 0.2) * exp(-abs(mu0 - 0.02) * 60.0) * 0.004 * lit;
          vec3 lights = vec3(1.0, 0.78, 0.45) * pow(texture(nightMap, vUv).r, 2.2) * (1.0 - 0.8 * cloud) * smoothstep(0.02, -0.12, mu0);
          vec3 radiance = ground * lit + glint * lit + twilight + lights * nightBoost;
          gl_FragColor = vec4(radiance * exposure, 1.0);
        }`,
    });
    const atmosphere = new T.ShaderMaterial({
      uniforms: {...this.uniforms, shell: {value: 1.018}},
      vertexShader,
      fragmentShader: /* glsl */`
        #include <logdepthbuf_pars_fragment>
        uniform vec3 sunDir; uniform float exposure;
        varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 n = normalize(vNormal), view = normalize(-vWorld);
          float rim = pow(1.0 - abs(dot(n, view)), 4.0);
          float sunSide = smoothstep(-0.3, 0.5, dot(n, sunDir));
          vec3 colour = vec3(0.3, 0.55, 1.0) * rim * sunSide * 0.5;
          gl_FragColor = vec4(colour * exposure, 1.0);
        }`,
      blending: T.AdditiveBlending, transparent: true, depthWrite: false,
    });
    const geometry = globeGeometry(256, 128);
    const surfaceMesh = new T.Mesh(geometry, surface), shellMesh = new T.Mesh(geometry, atmosphere);
    for (const m of [surfaceMesh, shellMesh]) {m.frustumCulled = false; this.group.add(m);}
    // Uniform objects are shared, so updating this.uniforms updates both materials.
    for (const key of Object.keys(this.uniforms)) {surface.uniforms[key] = this.uniforms[key]; atmosphere.uniforms[key] = this.uniforms[key];}
  }
}
