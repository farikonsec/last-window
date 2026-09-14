/**
 * All game sound is synthesised with Web Audio: no samples, no licences.
 * - Music: Beethoven's "Ode to Joy" (public domain) as a warm bell melody over a soft C/G drone, lifting a little
 *   while climbing or docked; it ducks during warnings and stops dead on a failure.
 * - Cabin sounds: engine rumble heard through the structure (there is no sound in vacuum), a soft RCS hiss.
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

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// Beethoven, "Ode to Joy" (Symphony No. 9, public domain) as [MIDI note, beats]; the recognisable, hopeful main
// theme. A soft C/G drone underneath keeps it warm without fighting the diatonic melody.
const ODE: [number, number][] = [
  [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1], [60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2],
  [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1], [60, 1], [60, 1], [62, 1], [64, 1], [62, 1.5], [60, 0.5], [60, 2],
  [62, 1], [62, 1], [64, 1], [60, 1], [62, 1], [64, 0.5], [65, 0.5], [64, 1], [60, 1], [62, 1], [64, 0.5], [65, 0.5], [64, 1], [62, 1], [60, 1], [62, 1], [55, 2],
  [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1], [60, 1], [60, 1], [62, 1], [64, 1], [62, 1.5], [60, 0.5], [60, 2],
];

export class GameAudio {
  enabled = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private cabin!: GainNode;
  private engine!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private rcs!: GainNode;
  private noise!: AudioBuffer;
  private step = 0;
  private nextStep = 0;
  private melodyAt = 0;
  private melodyI = 0;
  private beat = 0;
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
    // RCS: a soft, continuous band-passed hiss whose level follows the thrusters, instead of a machine-gun of clicks.
    const rsrc = ctx.createBufferSource(); rsrc.buffer = this.noise; rsrc.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 1400; rf.Q.value = 0.7;
    this.rcs = ctx.createGain(); this.rcs.gain.value = 0;
    rsrc.connect(rf).connect(this.rcs).connect(this.cabin);
    rsrc.start();
    this.nextStep = ctx.currentTime + 0.1;
  }

  /** Slow-attack pad voice for warm sustained chords. */
  private pad(freq: number, at: number, duration: number, level: number, type: OscillatorType, dest: AudioNode) {
    const ctx = this.ctx!, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + duration * 0.4);   // slow swell
    g.gain.exponentialRampToValueAtTime(0.0001, at + duration);         // gentle fade
    osc.connect(g).connect(dest);
    osc.start(at); osc.stop(at + duration + 0.05);
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
    // A short soft thump on the leading edge of a thruster pulse, then a steady hiss while held — no machine-gun.
    if (frame.rcsActive && now - this.lastRcs > 0.25) {this.lastRcs = now; this.tone(150, now, 0.09, 0.06, 'sine', this.cabin, 90);}
    this.rcs.gain.setTargetAtTime(frame.rcsActive ? 0.06 : 0, now, 0.05);
    if (frame.phase !== this.lastPhase) {
      if (frame.phase === 'capture') this.tone(70, now, 0.35, 0.5, 'sine', this.cabin, 40);
      if (frame.phase === 'docked') [72, 76, 79, 84, 88].forEach((n, i) => this.tone(midi(n), now + i * 0.12, 0.6, 0.14, 'triangle', this.master));
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

  /**
   * The theme is "Ode to Joy", played as a warm bell melody over a soft C/G drone and sub bass. Tempo and fullness lift
   * a little while climbing or docked. Nothing harsh; it ducks during warnings and stops on a failure.
   */
  private sequence(phase: string, now: number) {
    const bpm = phase === 'ascent' ? 104 : phase === 'docked' ? 112 : 92;
    this.beat = 60 / bpm;
    const busy = phase === 'ascent' || phase === 'docked';
    // Drone/bass on a two-beat grid so the harmony is always present under the tune.
    while (this.nextStep < now + 0.2) {
      const t = Math.max(this.nextStep, now), s = this.step++;
      const fifth = s % 2 === 0; // alternate C and G roots
      this.pad(midi(fifth ? 48 : 43), t, this.beat * 2.2, 0.06, 'sine', this.music);         // sub bass
      this.pad(midi(fifth ? 60 : 62), t, this.beat * 2.4, 0.03, 'triangle', this.music);      // soft pad
      this.pad(midi(fifth ? 67 : 67), t, this.beat * 2.4, 0.022, 'sine', this.music);         // fifth
      this.nextStep = t + this.beat * 2;
    }
    // Melody: schedule the next few Ode-to-Joy notes as their time comes up.
    if (this.melodyAt < now - 1) this.melodyAt = now + 0.1;
    while (this.melodyAt < now + 0.2) {
      const [note, beats] = ODE[this.melodyI % ODE.length];
      const dur = beats * this.beat;
      this.tone(midi(note), Math.max(this.melodyAt, now), dur * 0.92, busy ? 0.09 : 0.07, 'triangle', this.music);
      if (busy) this.tone(midi(note + 12), Math.max(this.melodyAt, now), dur * 0.5, 0.02, 'sine', this.music); // faint octave sparkle
      this.melodyAt += dur;
      this.melodyI++;
    }
  }
}
