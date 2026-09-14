/**
 * All game sound is synthesised with Web Audio: no samples, no licences.
 * - Music: a calm, hopeful ambient score (warm triangle/sine pads through C–G–Am–F, a soft bell melody, sub bass).
 *   Tempo and density lift a little while climbing or docked; it ducks during warnings and stops dead on a failure.
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

// A gentle, hopeful progression: C – G – Am – F, each a warm major/minor triad (root, third, fifth as MIDI notes).
const CHORDS = [[48, 55, 64, 67], [43, 55, 62, 67], [45, 57, 64, 69], [41, 53, 60, 65]];
// A sparse C-major-pentatonic bell melody drifting over the pads.
const MELODY = [67, 72, 76, 74, 72, 69, 72, 76, 79, 76, 72, 74, 69, 67, 72, 74];
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

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
   * A calm, hopeful ambient score, not chiptune techno: warm sustained pads move through C–G–Am–F, a soft sine bell
   * melody drifts over them, and a gentle sub bass marks the root. Motion picks up a little while climbing or docked,
   * but nothing is harsh — no noise percussion, no square-wave lead.
   */
  private sequence(phase: string, now: number) {
    const bpm = phase === 'ascent' ? 96 : phase === 'docked' ? 100 : 84;
    const beat = 60 / bpm;
    const step = beat / 2;                       // an eighth-note grid
    const busy = phase === 'ascent' || phase === 'docked';
    while (this.nextStep < now + 0.15) {
      const t = Math.max(this.nextStep, now), s = this.step++;
      const barLen = 8;                          // eighth-notes per bar
      const bar = Math.floor(s / barLen) % 4, inBar = s % barLen, chord = CHORDS[bar];
      // Warm pad chord: swell in at the top of each bar and hold across it.
      if (inBar === 0) for (const [i, note] of chord.entries()) this.pad(midi(note), t, beat * 3.6, i === 0 ? 0.05 : 0.035, i < 2 ? 'triangle' : 'sine', this.music);
      // Sub bass on the root, once (twice a bar when busy).
      if (inBar === 0 || (busy && inBar === 4)) this.pad(midi(chord[0] - 12), t, beat * 1.8, 0.09, 'sine', this.music);
      // Sparse bell melody: every other eighth when parked/coasting, most eighths when busy.
      if (busy ? inBar % 2 === 0 : inBar % 4 === 0) this.tone(midi(MELODY[s % MELODY.length]), t, step * 1.6, phase === 'terminal' ? 0.03 : 0.05, 'sine', this.music);
      // A soft high sparkle to lift the fourth bar when climbing or docked.
      if (busy && bar === 3 && inBar === 0) this.tone(midi(chord[2] + 12), t, beat * 2.4, 0.03, 'triangle', this.music);
      this.nextStep = t + step;
    }
  }
}
