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
  /** Present while the buggy is being driven: engine note follows `rev` (0..1 of top speed), plus turbo and air state. */
  drive?: {rev: number; turbo: boolean; airborne: boolean};
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
  private keepAlive: HTMLAudioElement | null = null;

  /** Must run inside a user gesture the first time (browser autoplay rules). */
  toggle(force?: boolean) {
    const want = force ?? !this.enabled;
    if (want && !this.ctx) this.build();
    this.enabled = want;
    if (!this.ctx) return this.enabled;
    // Everything here runs synchronously inside the tap; iOS rejects audio started after an await.
    if (want) this.unlockIOS(); else this.keepAlive?.pause();
    this.master.gain.setTargetAtTime(want ? 0.7 : 0, this.ctx.currentTime, 0.08);
    return this.enabled;
  }

  /**
   * iPhone keeps Web Audio silent unless the context wakes inside the tap AND the page declares playback audio — the
   * ring/silent switch otherwise mutes it. A silent looping media element declares that; a one-sample buffer wakes the
   * context. Runs synchronously inside a gesture.
   */
  private unlockIOS() {
    const ctx = this.ctx!;
    try {(navigator as unknown as {audioSession?: {type: string}}).audioSession!.type = 'playback';} catch {/* not Safari 16.4+ */}
    if (!this.keepAlive) {
      const rate = 8000, samples = rate / 2, buf = new ArrayBuffer(44 + samples), v = new DataView(buf);
      const w = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + samples, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, samples, true);
      for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128);
      const el = new Audio(URL.createObjectURL(new Blob([buf], {type: 'audio/wav'}))); el.loop = true; el.setAttribute('playsinline', ''); el.volume = 0.01;
      this.keepAlive = el;
    }
    this.keepAlive.play().catch(() => {});
    const b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(0);
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }

  /** Call on every tap: iOS suspends the context after a lock/app-switch, so resume it and restart the keep-alive. */
  resume() {
    if (this.enabled && this.ctx && this.ctx.state !== 'running') {this.ctx.resume().catch(() => {}); this.keepAlive?.play().catch(() => {});}
  }

  private build() {
    const AC = window.AudioContext ?? (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
    const ctx = new AC();
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

  /** A low impact thud for a hard landing or a collision; level 0..1. */
  thump(level: number) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    this.tone(90, now, 0.28, 0.4 + 0.5 * level, 'sine', this.cabin, 32);
    this.burst(now, 0.18, 0.12 + 0.2 * level, 260, this.cabin);
  }

  update(frame: AudioFrame) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (frame.drive) {
      // Buggy motor: a rising whine that tracks speed, brighter and louder on turbo, quieter with the wheels in the air.
      const d = frame.drive, air = d.airborne ? 0.35 : 1;
      this.engine.gain.setTargetAtTime((0.14 + d.rev * 0.42 + (d.turbo ? 0.16 : 0)) * air, now, 0.06);
      this.engineFilter.frequency.setTargetAtTime(110 + d.rev * 620 + (d.turbo ? 260 : 0), now, 0.05);
    } else {
      this.engine.gain.setTargetAtTime(frame.throttle * 0.5, now, 0.08);
      this.engineFilter.frequency.setTargetAtTime(120 + frame.throttle * 260, now, 0.1);
    }
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
    this.sequence(frame.drive ? 'drive' : frame.phase, now);
  }

  /**
   * The theme is "Ode to Joy", played as a warm bell melody over a soft C/G drone and sub bass. Tempo and fullness lift
   * a little while climbing or docked. Nothing harsh; it ducks during warnings and stops on a failure.
   */
  private sequence(phase: string, now: number) {
    if (phase === 'drive') {this.driveGroove(now); return;}
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

  /**
   * A driving groove for the buggy: a synth-rock loop in A minor at 126 bpm — an eighth-note bass pulse alternating
   * A/E roots, a syncopated pentatonic pluck, and a soft pad. Deliberately unlike the Ode-to-Joy mission theme, so
   * hitting Drive feels like changing the record.
   */
  private driveGroove(now: number) {
    const beat = 60 / 126;
    // Bass + pad on a two-beat grid (reusing the same scheduler state as the mission drone).
    while (this.nextStep < now + 0.2) {
      const t = Math.max(this.nextStep, now), s = this.step++;
      const root = [45, 45, 52, 43][s % 4]; // A, A, E, G roots
      for (let e = 0; e < 4; e++) this.tone(midi(root - 12), t + e * beat * 0.5, beat * 0.42, 0.12, 'sawtooth', this.music); // pulsing bass
      this.pad(midi(root), t, beat * 2.1, 0.03, 'triangle', this.music);
      this.nextStep = t + beat * 2;
    }
    // Pentatonic pluck riff on the offbeats.
    const RIFF = [69, 72, 76, 72, 74, 72, 69, 67]; // A minor pentatonic phrase
    if (this.melodyAt < now - 1) this.melodyAt = now + 0.1;
    while (this.melodyAt < now + 0.2) {
      this.tone(midi(RIFF[this.melodyI % RIFF.length]), Math.max(this.melodyAt, now), beat * 0.46, 0.06, 'square', this.music);
      this.melodyAt += beat * 0.5;
      this.melodyI++;
    }
  }
}
