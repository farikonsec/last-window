import * as T from 'three';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';
import {exposure} from './common';

export interface ExposureSettings {
  /** 'auto' adapts like an eye/camera; a number fixes the exposure multiplier. */
  mode: 'auto' | number;
  min: number;
  max: number;
}

/**
 * Renderer, HDR post chain and auto-exposure.
 * Auto-exposure renders the scene into a small float target every few frames and meters two ways:
 * a log-average of the lit subject aiming mid-grey at 0.18, and a highlight meter on a box-filtered copy.
 * The darker of the two wins, so a small sunlit Earth in a black sky is not blown out.
 */
export class Viewer {
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(60, 1, 0.05, 1e12);
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  exposureSettings: ExposureSettings = {mode: 'auto', min: 0.05, max: 3e6};
  shaderErrors: string[] = [];
  fps = 0;
  private meter = new T.WebGLRenderTarget(256, 144, {type: T.FloatType, depthBuffer: true});
  private meterPixels = new Float32Array(256 * 144 * 4);
  private frame = 0;
  private lastFrameTime = performance.now();
  private targetExposure = 1;
  /**
   * Upper exposure limit from bright bodies known to be in view (set by the scene every frame). The pixel meter
   * cannot see an Earth only a few pixels wide in a black sky and would dark-adapt until it blows out; an auto-iris
   * that knows Earth is in frame never opens that far. Applied instantly, so nothing flashes when a body enters view.
   */
  exposureCap = Infinity;
  /** Stable exposure for sunlit surface cameras, independent of zoom and small specular highlights. */
  surfaceExposure: number | null = null;

  constructor(host: HTMLElement) {
    this.renderer = new T.WebGLRenderer({antialias: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true});
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      this.shaderErrors.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].join('\n'));
    };
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new T.Vector2(512, 512), 0.18, 0.2, 4);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
  }

  get bufferHeight() {
    return this.renderer.domElement.height;
  }

  render(realDt: number) {
    const now = performance.now();
    this.fps = this.fps * 0.9 + (1000 / Math.max(1, now - this.lastFrameTime)) * 0.1;
    this.lastFrameTime = now;
    if (this.exposureSettings.mode === 'auto') {
      if (this.frame++ % 6 === 0) this.meterExposure();
      // Eyes and cameras darken faster than they brighten.
      const rate = this.targetExposure < exposure.value ? 3.0 : 1.2;
      const k = 1 - Math.exp(-realDt * rate);
      exposure.value = Math.exp(Math.log(exposure.value) + (Math.log(this.targetExposure) - Math.log(exposure.value)) * k);
      exposure.value = Math.min(exposure.value, this.exposureCap);
    } else {
      exposure.value = this.exposureSettings.mode;
    }
    this.composer.render(realDt);
  }

  /**
   * Picture-in-picture: render the scene again from a second camera into a scissored corner of the canvas, on top of
   * the main image. Skips bloom (a small inset does not need it) but keeps ACES tone mapping and the shared exposure.
   * Rect is in CSS pixels from the top-left; the scene must already be placed for this frame's floating origin.
   */
  renderInset(camera: T.PerspectiveCamera, xCss: number, yCss: number, wCss: number, hCss: number) {
    const r = this.renderer, dpr = r.getPixelRatio(), h = r.domElement.height;
    const x = xCss * dpr, w = wCss * dpr, hh = hCss * dpr, y = h - (yCss + hCss) * dpr; // WebGL y is bottom-up
    camera.aspect = wCss / hCss; camera.updateProjectionMatrix();
    r.autoClear = false;
    r.setScissorTest(true);
    r.setScissor(x, y, w, hh); r.setViewport(x, y, w, hh);
    r.clear(true, true, false);
    r.render(this.scene, camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, r.domElement.width, h);
    r.autoClear = true;
  }

  /** Luminance statistics of the current view at the current exposure (for auto-exposure and tests). */
  measure() {
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.meter);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.readRenderTargetPixels(this.meter, 0, 0, 256, 144, this.meterPixels);
    this.renderer.setRenderTarget(previousTarget);
    const n = 256 * 144, lum = new Float32Array(n);
    let logSum = 0;
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      const l = 0.2126 * this.meterPixels[p] + 0.7152 * this.meterPixels[p + 1] + 0.0722 * this.meterPixels[p + 2];
      lum[i] = Number.isFinite(l) ? l : 1e30; // overflow is the brightest thing in frame, never darkness
    }
    const scene = exposure.value;
    // Meter on a 4x4 box-filtered copy (64 x 36). The Sun's disc, specular glints on foil and single stars are a few
    // pixels each and average away, so they no longer pull the exposure down when they enter the frame; broad bright
    // areas (sunlit ground, a lit hull filling the view) still count. Earth and the Moon as small discs are handled by
    // the scene's analytic exposure cap instead.
    const cw = 64, ch = 36, coarse = new Float32Array(cw * ch);
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      let sum = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) sum += Math.min(lum[(j * 4 + y) * 256 + i * 4 + x], 1e6);
      coarse[j * cw + i] = sum / 16;
    }
    const cn = cw * ch, sorted = coarse.slice().sort();
    const peak = sorted[Math.floor(cn * 0.995)];
    // Black space is not part of the subject: if enough of the frame is lit, average only areas within 10 stops of the
    // highlights; a frame that is mostly dark sky meters on everything (stars, Milky Way).
    const floor = peak * 1e-3;
    let subject = 0;
    for (let i = 0; i < cn; i++) if (coarse[i] > floor) subject++;
    const litFrame = subject > cn * 0.01 && peak > 0;
    let count = 0;
    for (let i = 0; i < cn; i++) {
      if (litFrame && coarse[i] <= floor) continue;
      logSum += Math.log(Math.max(Math.min(coarse[i], 50) / scene, 2e-9));
      count++;
    }
    return {pixels: this.meterPixels, luminance: lum, width: 256, height: 144,
      logAverage: Math.exp(logSum / Math.max(1, count)), highlight: sorted[Math.floor(cn * 0.98)] / scene, peak: peak / scene, litFrame};
  }

  private meterExposure() {
    const m = this.measure();
    const fromAverage = this.surfaceExposure ?? 0.18 / m.logAverage;
    // Keep broad highlights on the ACES shoulder rather than clipped; tiny ones were filtered out above.
    const fromHighlight = this.surfaceExposure === null && m.highlight > 0 ? 2.2 / m.highlight : Infinity;
    const {min, max} = this.exposureSettings;
    this.targetExposure = Math.max(min, Math.min(max, this.exposureCap, fromAverage, fromHighlight));
  }
}
