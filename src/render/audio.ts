/**
 * All game sound is synthesised with Web Audio: no samples, no licences.
 * - Music: an upbeat 8-bit techno sequencer (square/pulse lead, triangle bass, noise hats, sine kick). Tempo and
 *   density follow the flight phase; it ducks during warnings and stops dead on a failure.
 * - Cabin sounds: engine rumble heard through the structure (there is no sound in vacuum), RCS thumps.
 * - Caution and warning: amber two-tone chirp, red master alarm.
 * - Events: soft-capture clunk, docking chime (rising major arpeggio), impact thud followed by radio static.
 */
export type Warning = 'none' | 'caution' | 'master';

export interface AudioFrame {
  phase: string;
  throttle: number;
  rcsActive: boolean;
  warning: Warning;
}

// A-minor-pentatonic flavoured progression that resolves to major: Am – F – C – G.
const ROOTS = [57, 53, 60, 55];
const LEAD = [0, 7, 12, 15, 12, 7, 10, 12, 0, 7, 12, 19, 17, 15, 12, 10];
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

export class GameAudio {
  enabled = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private cabin!: GainNode;
  private engine!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private step = 0;
  private nextStep = 0;
  private lastChirp = 0;
  private lastRcs = 0;
  private ended = false;
  private lastPhase = '';

  /** Must run inside a user gesture the first time (browser autoplay rules). */
  toggle(force?: boolean) {
    const want = force ?? !this.enabled;
    if (want && !this.ctx) this.build();
    this.enabled = want;
    if (!this.ctx) return this.enabled;
    if (want) this.ctx.resume().catch(() => {});
    this.master.gain.setTargetAtTime(want ? 0.7 : 0, this.ctx.currentTime, 0.08);
    return this.enabled;
  }

  /**
   * iOS Safari starts every AudioContext suspended and only resumes it from inside a real touch gesture, and a single
   * pointerdown often isn't enough. Call this on every tap: it resumes a stalled context (silent when not needed).
   */
  resume() {
    if (this.enabled && this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  private build() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain(); this.music.gain.value = 0.32; this.music.connect(this.master);
    this.cabin = ctx.createGain(); this.cabin.gain.value = 0.9; this.cabin.connect(this.master);
    const length = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    // Engine: looping low-passed noise, level follows throttle.
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    this.engineFilter = ctx.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 180;
    this.engine = ctx.createGain(); this.engine.gain.value = 0;
    src.connect(this.engineFilter).connect(this.engine).connect(this.cabin);
    src.start();
    this.nextStep = ctx.currentTime + 0.1;
  }

  private tone(freq: number, at: number, duration: number, level: number, type: OscillatorType, dest: AudioNode, slideTo?: number) {
    const ctx = this.ctx!, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + duration);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(g).connect(dest);
    osc.start(at); osc.stop(at + duration + 0.02);
  }

  private burst(at: number, duration: number, level: number, highpass: number, dest: AudioNode) {
    const ctx = this.ctx!, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise;
    f.type = 'highpass'; f.frequency.value = highpass;
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    src.connect(f).connect(g).connect(dest);
    src.start(at, Math.random() * 0.5); src.stop(at + duration + 0.02);
  }

  update(frame: AudioFrame) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, now = ctx.currentTime;
    this.engine.gain.setTargetAtTime(frame.throttle * 0.5, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(120 + frame.throttle * 260, now, 0.1);
    if (frame.rcsActive && now - this.lastRcs > 0.11) {this.lastRcs = now; this.burst(now, 0.07, 0.12, 900, this.cabin);}
    if (frame.phase !== this.lastPhase) {
      if (frame.phase === 'capture') this.tone(70, now, 0.35, 0.5, 'sine', this.cabin, 40);
      if (frame.phase === 'docked') [72, 76, 79, 84, 88].forEach((n, i) => this.tone(midi(n), now + i * 0.11, 0.5, 0.18, 'square', this.master));
      this.lastPhase = frame.phase;
    }
    if (frame.warning !== 'none' && now - this.lastChirp > (frame.warning === 'master' ? 0.5 : 1.6)) {
      this.lastChirp = now;
      if (frame.warning === 'master') {this.tone(2200, now, 0.22, 0.12, 'square', this.master); this.tone(1800, now + 0.25, 0.2, 0.1, 'square', this.master);}
      else {this.tone(880, now, 0.12, 0.1, 'triangle', this.master); this.tone(1100, now + 0.14, 0.12, 0.1, 'triangle', this.master);}
    }
    this.music.gain.setTargetAtTime(frame.warning === 'master' ? 0.12 : frame.phase === 'docked' ? 0.4 : 0.32, now, 0.3);
    if (frame.phase === 'ended') {
      if (!this.ended) {
        this.ended = true;
        this.tone(60, now, 0.9, 0.9, 'sine', this.cabin, 25);
        this.burst(now + 0.05, 1.6, 0.25, 1200, this.master);
        this.music.gain.setTargetAtTime(0.0001, now, 0.05);
      }
      return;
    }
    this.ended = false;
    this.sequence(frame.phase, now);
  }

  private sequence(phase: string, now: number) {
    const bpm = phase === 'ascent' ? 136 : phase === 'terminal' || phase === 'capture' ? 104 : phase === 'docked' ? 128 : 120;
    const sixteenth = 60 / bpm / 4;
    const intense = phase === 'ascent' || phase === 'docked';
    while (this.nextStep < now + 0.12) {
      const t = Math.max(this.nextStep, now), s = this.step++;
      const bar = Math.floor(s / 16) % 4, root = ROOTS[bar] - (bar === 0 ? 0 : 0);
      // Kick on the beat, open hats on the offbeat, closed ticks between.
      if (s % 4 === 0 && phase !== 'parked') this.tone(150, t, 0.16, 0.55, 'sine', this.music, 42);
      if (s % 4 === 2) this.burst(t, 0.08, 0.16, 7000, this.music);
      else if (intense && s % 2 === 1) this.burst(t, 0.025, 0.06, 9000, this.music);
      // Rolling triangle bass: root and octave.
      if (s % 2 === 0) this.tone(midi(root - 24 + (s % 4 === 2 ? 12 : 0)), t, sixteenth * 1.8, 0.22, 'triangle', this.music);
      // 8-bit arpeggio lead: sparser while parked and on final approach, busier during the climb.
      const density = phase === 'parked' || phase === 'terminal' ? 4 : phase === 'coast' ? 2 : 1;
      if (s % density === 0) this.tone(midi(root + LEAD[s % 16]), t, sixteenth * 0.9, phase === 'terminal' ? 0.05 : 0.08, 'square', this.music);
      // Major lift every fourth bar when docked or climbing.
      if (intense && bar === 3 && s % 8 === 0) this.tone(midi(root + 16), t, sixteenth * 6, 0.05, 'sawtooth', this.music);
      this.nextStep = t + sixteenth;
    }
  }
}
