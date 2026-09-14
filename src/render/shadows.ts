import * as T from 'three';

/** Casters render into the sun shadow maps only if they enable this layer. */
const SHADOW_LAYER = 2;

interface Cascade {
  radius: number;
  target: T.WebGLRenderTarget;
  camera: T.OrthographicCamera;
  matrix: T.Matrix4;
}

/**
 * Sun shadow maps for everything near the camera: three cascades (48 m, 220 m, 840 m across) that follow the camera and
 * snap to whole texels so edges do not crawl. The Sun is 0.53 degrees wide, so on the Moon the only softening is a
 * penumbra growing with occluder distance; a small rotated Poisson PCF keeps edges crisp without stair steps.
 */
export class SunShadows {
  readonly layer = SHADOW_LAYER;
  cascades: Cascade[];
  uniforms: Record<string, T.IUniform>;
  private depthMaterial = new T.MeshBasicMaterial({colorWrite: false});

  constructor(size = 2048) {
    this.cascades = [24, 110, 420].map(radius => {
      const target = new T.WebGLRenderTarget(size, size, {depthBuffer: true});
      target.depthTexture = new T.DepthTexture(size, size, T.FloatType);
      target.depthTexture.compareFunction = T.LessEqualCompare;
      target.depthTexture.minFilter = T.LinearFilter;
      target.depthTexture.magFilter = T.LinearFilter;
      const camera = new T.OrthographicCamera(-radius, radius, radius, -radius, 1, 20_000);
      camera.layers.set(SHADOW_LAYER);
      return {radius, target, camera, matrix: new T.Matrix4()};
    });
    this.uniforms = {
      shadowMap0: {value: this.cascades[0].target.depthTexture},
      shadowMap1: {value: this.cascades[1].target.depthTexture},
      shadowMap2: {value: this.cascades[2].target.depthTexture},
      shadowMatrix0: {value: this.cascades[0].matrix},
      shadowMatrix1: {value: this.cascades[1].matrix},
      shadowMatrix2: {value: this.cascades[2].matrix},
      shadowTexel: {value: 1 / size},
      shadowsEnabled: {value: 1},
      sunDirShadow: {value: new T.Vector3(0, 0, 1)},
    };
  }

  /** GLSL: sunShadow(worldPosition, geometricNormal) -> 0 (shadow) .. 1 (lit). */
  get glsl() {
    return /* glsl */`
      uniform sampler2DShadow shadowMap0; uniform sampler2DShadow shadowMap1; uniform sampler2DShadow shadowMap2;
      uniform mat4 shadowMatrix0; uniform mat4 shadowMatrix1; uniform mat4 shadowMatrix2;
      uniform float shadowTexel; uniform float shadowsEnabled; uniform vec3 sunDirShadow;
      // 8-tap Poisson disc, rotated per pixel: grazing sunlight stretches texels along the ground, and a square
      // 2x2 kernel left comb-like teeth on long shadow edges.
      const vec2 POISSON[8] = vec2[](vec2(-0.613, 0.617), vec2(0.170, -0.040), vec2(-0.299, -0.792), vec2(0.645, 0.493),
        vec2(-0.651, -0.106), vec2(0.422, -0.505), vec2(-0.080, 0.944), vec2(0.962, -0.195));
      float cascadeLookup(sampler2DShadow map, vec3 c, float bias) {
        float angle = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
        mat2 r = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
        float s = 0.0;
        for (int i = 0; i < 8; i++) s += texture(map, vec3(c.xy + r * POISSON[i] * shadowTexel * 1.6, c.z - bias));
        return s / 8.0;
      }
      bool inside(vec3 p, float margin) {
        return all(greaterThan(p.xy, vec2(margin))) && all(lessThan(p.xy, vec2(1.0 - margin))) && p.z < 1.0;
      }
      // normal: geometric surface normal. Sampling slightly off the surface (normal offset) removes the striped
      // self-shadowing that grazing sunlight otherwise leaves on terrain, without detaching contact shadows.
      float sunShadow(vec3 world, vec3 normal) {
        if (shadowsEnabled < 0.5) return 1.0;
        // Slope-scaled: grazing sunlight needs more offset. Depth range is 20 km, so bias(depth) = metres / 20000.
        // Tuned so the shadowed fraction in view matches a CPU ray-march of the surface function (tests/surface-probe.js).
        float grazing = 1.0 / max(dot(normal, sunDirShadow), 0.25);
        vec4 c0 = shadowMatrix0 * vec4(world + normal * 0.01 * grazing, 1.0);
        if (inside(c0.xyz, 0.03)) return cascadeLookup(shadowMap0, c0.xyz, 0.006 * grazing / 20000.0);
        vec4 c1 = shadowMatrix1 * vec4(world + normal * 0.04 * grazing, 1.0);
        if (inside(c1.xyz, 0.03)) return cascadeLookup(shadowMap1, c1.xyz, 0.025 * grazing / 20000.0);
        vec4 c2 = shadowMatrix2 * vec4(world + normal * 0.14 * grazing, 1.0);
        if (inside(c2.xyz, 0.0)) {
          vec3 p = c2.xyz;
          float edge = smoothstep(0.0, 0.08, min(min(p.x, p.y), min(1.0 - p.x, 1.0 - p.y)));
          return mix(1.0, cascadeLookup(shadowMap2, p, 0.09 * grazing / 20000.0), edge);
        }
        return 1.0;
      }`;
  }

  /**
   * Render the cascades. `focus` is the camera-relative world point to centre on (the ground below the camera),
   * `sunDir` the world direction to the Sun. Casters must be positioned for this frame already.
   */
  render(renderer: T.WebGLRenderer, scene: T.Scene, focus: T.Vector3, sunDir: T.Vector3) {
    const up = Math.abs(sunDir.z) > 0.9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 0, 1);
    this.uniforms.sunDirShadow.value.copy(sunDir);
    const previousTarget = renderer.getRenderTarget();
    // Swap in depth-only materials. Terrain rings bring their own (userData.shadowMaterial) that keeps the hole
    // discard: without it a coarse ring overlapping a finer one casts false shadows onto the ground below it.
    const swapped: [T.Mesh, T.Material | T.Material[]][] = [];
    scene.traverse(o => {
      const mesh = o as T.Mesh;
      if (!mesh.isMesh || !mesh.layers.isEnabled(SHADOW_LAYER)) return;
      swapped.push([mesh, mesh.material]);
      mesh.material = (mesh.userData.shadowMaterial as T.Material | undefined) ?? this.depthMaterial;
    });
    for (const c of this.cascades) {
      const cam = c.camera;
      // Snap the focus to whole texels in the light's view plane.
      const lookAt = new T.Matrix4().lookAt(new T.Vector3(), sunDir.clone().negate(), up);
      const inverse = lookAt.clone().invert();
      const texel = (2 * c.radius) / c.target.width;
      const lightSpace = focus.clone().applyMatrix4(inverse);
      lightSpace.x = Math.round(lightSpace.x / texel) * texel;
      lightSpace.y = Math.round(lightSpace.y / texel) * texel;
      const snapped = lightSpace.applyMatrix4(lookAt);
      cam.position.copy(snapped).addScaledVector(sunDir, 10_000);
      cam.up.copy(up);
      cam.lookAt(snapped);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      renderer.setRenderTarget(c.target);
      renderer.clear();
      renderer.render(scene, cam);
      c.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
        .multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    }
    for (const [mesh, material] of swapped) mesh.material = material;
    renderer.setRenderTarget(previousTarget);
  }
}
