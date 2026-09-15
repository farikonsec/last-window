import {G0} from '../sim/constants';
import {dot, len, rotate, unit} from '../sim/vec';
import {KESTREL, MOTHERSHIP, altitudeAboveGround} from '../sim/vehicle';
import {RESULT_TEXT, type AttitudeMode, type Mission} from '../sim/mission';
import {scoreDock, scoreLanding} from '../sim/scoring';

const readBest = (key: string) => {try {return Number(localStorage.getItem(`moon-ascent.best-${key}`)) || 0;} catch {return 0;}};
const writeBest = (key: string, total: number) => {try {localStorage.setItem(`moon-ascent.best-${key}`, String(total));} catch {/* storage unavailable */}};

const duration = (s: number) => `${Math.floor(Math.abs(s) / 60).toString().padStart(2, '0')}:${Math.floor(Math.abs(s) % 60).toString().padStart(2, '0')}`;
const distance = (m: number) => Number.isFinite(m) ? `${(m / 1000).toFixed(1)} km` : 'ESCAPE';

/**
 * One-line landing cue. The powered descent is three jobs in order: kill the ~1.7 km/s of orbital speed with the engine
 * pointing retrograde, then pitch up and control the sink rate, then set down under 3 m/s and upright.
 */
export function descentCue(horizontal: number, vertical: number, agl: number): [string, string] {
  if (horizontal > 60) return [`BRAKE: hold PROGRADE-back and burn · ${horizontal.toFixed(0)} m/s to kill`, horizontal > 400 ? 'amber' : 'green'];
  if (agl > 300) return [`DESCEND: pitch upright, hold sink under ${Math.max(10, agl / 25).toFixed(0)} m/s · ${agl.toFixed(0)} m`, vertical < -Math.max(12, agl / 20) ? 'red' : 'green'];
  if (agl > 25) return [`FINAL: sink under 5 m/s, level the ship · ${agl.toFixed(0)} m`, vertical < -8 ? 'red' : 'amber'];
  return [`TOUCHDOWN: under 3 m/s, upright · ${agl.toFixed(0)} m`, vertical < -3.5 ? 'red' : 'green'];
}

/** Body-axis RCS cue (+x right, +y up, +z forward) as the keys to press. */
export function rcsKeys(keys: [number, number, number]) {
  const k = [keys[2] > 0 ? 'W' : keys[2] < 0 ? 'S' : '', keys[0] > 0 ? 'D' : keys[0] < 0 ? 'A' : '', keys[1] > 0 ? 'R' : keys[1] < 0 ? 'F' : ''].filter(Boolean);
  return k.length ? k.join(' + ') : 'coast';
}

export class MissionHud {
  readonly panel = document.createElement('section');
  onLaunch = () => {};
  onReset = () => {};
  /** Asks the app to open or close the phone menu. */
  onMenu = () => {};
  private readouts: HTMLElement;
  private throttle: HTMLInputElement;
  private last = -Infinity;
  constructor(parent: HTMLElement, private mission: Mission) {
    this.panel.className = 'mission-panel';
    this.panel.innerHTML = `<header>KESTREL / FLIGHT COMPUTER <span>MANUAL</span></header>
      <div class="flight-readouts" aria-live="off"></div>
      <div class="flight-actions"><button data-action="wait">Wait to T−30 s</button><button data-action="launch">LAUNCH</button><button data-action="reset">Reset</button></div>
      <label class="throttle-control">THROTTLE <input aria-label="Main engine throttle" type="range" min="0" max="100" value="0"><output>0%</output></label>
      <div class="attitude-modes" role="group" aria-label="Attitude aid">${(['free', 'stabilize', 'dock', 'match', 'prograde', 'retrograde'] as AttitudeMode[]).map(mode => `<button data-attitude="${mode}">${{free: 'FREE', stabilize: 'HOLD [Q]', dock: 'DOCK [E]', match: 'MATCH [G]', prograde: 'PROGRADE', retrograde: 'RETRO [R]'}[mode]}</button>`).join('')}</div>
      <label class="assist-control"><input type="checkbox"> Reference guidance (automatic demo)</label>
      <p>↑ ↓ throttle · Space cut · I/K pitch · J/L yaw · U/O roll<br>W/S fore/aft · A/D left/right · R/F up/down<br>C chase · V cockpit · N docking sight · B ARGO · [ ] warp · P sound</p>`;
    parent.appendChild(this.panel);
    this.readouts = this.panel.querySelector('.flight-readouts')!;
    this.throttle = this.panel.querySelector('input[type=range]')!;
    this.throttle.oninput = () => {mission.throttle = Number(this.throttle.value) / 100;};
    this.panel.querySelector<HTMLInputElement>('input[type=checkbox]')!.onchange = e => {mission.assisted = (e.target as HTMLInputElement).checked;};
    this.panel.querySelector<HTMLButtonElement>('[data-action=wait]')!.onclick = () => mission.waitForWindow();
    this.panel.querySelector<HTMLButtonElement>('[data-action=launch]')!.onclick = () => {if (mission.launch()) this.onLaunch();};
    this.panel.querySelector<HTMLButtonElement>('[data-action=reset]')!.onclick = () => this.onReset();
    this.panel.querySelectorAll<HTMLButtonElement>('[data-attitude]').forEach(b => b.onclick = () => {mission.attitudeMode = b.dataset.attitude as AttitudeMode;});
    this.debrief.className = 'debrief';
    this.debrief.hidden = true;
    this.debrief.innerHTML = `<h2></h2><div class="medal" hidden></div><p class="debrief-detail"></p><dl></dl><div><button data-debrief="retry">Try again [Enter]</button><button data-debrief="watch">Look around</button></div>`;
    parent.appendChild(this.debrief);
    // Compact (phone) HUD: a slim always-on strip plus a menu button that pulls the full panels up on demand, so the
    // 3D view stays visible. Its buttons mirror the panel's launch and attitude aids — the only controls used in flight.
    this.mini.className = 'mini-hud';
    this.mini.innerHTML = `<button class="mini-menu" aria-label="Open flight menu">☰</button>
      <div class="mini-body"><div class="mini-status"></div><div class="mini-cue"></div></div>
      <div class="mini-actions">
        <button data-mini="launch">LAUNCH</button>
        <button data-mini-att="stabilize">HOLD</button><button data-mini-att="dock">DOCK</button><button data-mini-att="match">MATCH</button>
      </div>`;
    parent.appendChild(this.mini);
    // The menu itself is owned by main.ts (it has to move the panels into the sheet); this just asks for a toggle.
    this.mini.querySelector<HTMLButtonElement>('.mini-menu')!.addEventListener('click', () => this.onMenu());
    this.mini.querySelector<HTMLButtonElement>('[data-mini=launch]')!.onclick = () => {if (this.mission.launch()) this.onLaunch();};
    this.mini.querySelectorAll<HTMLButtonElement>('[data-mini-att]').forEach(b => b.onclick = () => {this.mission.attitudeMode = b.dataset.miniAtt as AttitudeMode;});
    this.debrief.querySelector<HTMLButtonElement>('[data-debrief=retry]')!.onclick = () => this.onReset();
    this.debrief.querySelector<HTMLButtonElement>('[data-debrief=watch]')!.onclick = () => {this.dismissed = true; this.debrief.hidden = true;};
  }

  readonly debrief = document.createElement('section');
  readonly mini = document.createElement('div');
  private dismissed = false;

  /** End-of-flight card: what happened, the numbers that decided it, and a one-key retry. */
  private showDebrief() {
    const m = this.mission, s = m.state;
    const success = s.status === 'docked' || m.result === 'touchdown';
    if (this.dismissed || (!m.result && !success)) {this.debrief.hidden = true; return;}
    this.debrief.hidden = false;
    this.debrief.classList.toggle('success', success);
    const text = s.status === 'docked' ? {title: 'HARD DOCK · CREW HOME', detail: 'Latches closed and the tunnel is pressurised. Welcome aboard ARGO.'} : RESULT_TEXT[m.result!];
    this.debrief.querySelector('h2')!.textContent = text.title;
    this.debrief.querySelector('.debrief-detail')!.textContent = text.detail;
    const row = (k: string, v: string) => `<dt>${k}</dt><dd>${v}</dd>`;
    const flight = m.launched ? s.t - m.liftoffTime : 0;
    // Both missions are scored: a dock on contact quality and RCS, a landing on touch, attitude, precision and fuel.
    const score = m.result === 'touchdown' && m.landingContact
      ? scoreLanding({...m.landingContact, mainLeft: s.mainPropellant, seconds: flight})
      : success && m.dockingContact ? scoreDock({...m.dockingContact, rcsLeft: s.rcsPropellant, seconds: flight}) : null;
    const scoreKey = m.result === 'touchdown' ? 'landing' : 'dock';
    this.debrief.querySelector('dl')!.innerHTML = [
      row('Flight time', duration(flight)),
      m.impactSpeed ? row('Impact speed', `${m.impactSpeed.toFixed(1)} m/s`) : '',
      m.mode === 'descent' ? '' : row('Launch timing', m.launched ? `${(m.liftoffTime - m.window.liftoffTime).toFixed(1)} s off window` : 'did not launch'),
      row('Propellant left', `${(s.mainPropellant / KESTREL.mainPropellantCapacity * 100).toFixed(0)}% main · ${(s.rcsPropellant / KESTREL.rcsPropellantCapacity * 100).toFixed(0)}% RCS`),
      row('Battery', `${s.batteryKWh.toFixed(1)} kWh`),
      success ? row('Contact', m.probeDamaged ? 'probe damaged on an earlier attempt' : 'clean first capture') : '',
      ...(score ? score.parts.map(p => row(p.label, `${p.value} · ${Math.round(p.score)}`)) : []),
    ].join('');
    const badge = this.debrief.querySelector<HTMLElement>('.medal')!;
    badge.hidden = !score;
    if (score) {
      const best = readBest(scoreKey);
      const beat = score.total > best;
      if (beat) writeBest(scoreKey, score.total);
      badge.className = `medal ${score.medal}`;
      badge.textContent = `${score.medal.toUpperCase()} · ${score.total}/100${beat ? ' · NEW BEST' : best ? ` · best ${best}` : ''}`;
    }
  }
  update(now: number) {
    if (now - this.last < 150) return;
    this.last = now;
    const m = this.mission, s = m.state, o = m.summary;
    const docking = m.launched && m.dockingRange < 10_000 && o.periapsisAltitude > 10_000;
    const status = m.result ? m.result.replaceAll('-', ' ').toUpperCase()
      : m.state.status === 'docked' ? 'HARD DOCK'
        : m.captureRemaining > 0 ? 'SOFT CAPTURE'
          : docking ? 'TERMINAL APPROACH'
            : !m.launched ? 'AWAITING LAUNCH' : !o.bound ? 'ESCAPE TRAJECTORY' : o.periapsisAltitude > 10_000 ? 'ORBIT ACHIEVED' : 'SUBORBITAL';
    const band = m.result || !o.bound ? 'red' : o.periapsisAltitude > 10_000 ? 'green' : 'amber';
    const pitch = Math.asin(Math.max(-1, Math.min(1, dot(m.guidance.thrustDirection, unit(s.r))))) * 180 / Math.PI;
    const actualPitch = Math.asin(Math.max(-1, Math.min(1, dot(rotate(s.q, [0, 1, 0]), unit(s.r))))) * 180 / Math.PI;
    const burnSeconds = s.mainPropellant * KESTREL.mainIsp * G0 / KESTREL.mainThrust;
    const metric = (name: string, value: string, colour = '') => `<div class="${colour}"><small>${name}</small><b>${value}</b></div>`;
    const rel = m.dockingRelative, approach = m.approach;
    const relSpeed = len(m.relativeVelocity);
    // One plain instruction for what to do next.
    const agl = altitudeAboveGround(s, m.env);
    const cue: [string, string] | null = m.result || s.status === 'docked' ? null
      : m.mode === 'descent' ? descentCue(o.horizontalSpeed, o.verticalSpeed, agl)
      : !m.launched ? (m.windowBand === 'green' ? ['LAUNCH NOW', 'green'] : m.countdown < 40 && m.countdown > 0 ? ['STAND BY · LAUNCH ON T−0', 'amber'] : null)
        : o.periapsisAltitude < 10_000 ? ['CLIMB: follow the pitch cue until apoapsis reads 100 km, then cut throttle', 'amber']
          : m.timeToApoapsis > 30 && m.range > 2_500 && o.verticalSpeed > 0 ? [`COAST: warp with ] · apoapsis and ARGO in ${duration(m.timeToApoapsis)}`, 'green']
            : relSpeed > 2 && m.dockingRange > 300 ? [`MATCH SPEED: press G, then burn ${relSpeed.toFixed(0)} m/s`, 'amber']
              : m.attitudeMode !== 'dock' ? ['PRESS E: DOCK attitude, then follow the RCS keys', 'amber']
                : [`${{hop: 'CLIMB OVER ARGO', stage: 'LINE UP 25 m BEHIND THE PORT', final: 'FINAL: hold ~0.08 m/s'}[m.translationCue.leg]} · RCS ${rcsKeys(m.translationCue.keys)}`, m.translationCue.leg === 'final' ? 'green' : 'amber'];
    const grid = docking ? `${metric('R-BAR', `${rel.position[0].toFixed(1)} m`)}${metric('V-BAR', `${rel.position[1].toFixed(1)} m`)}${metric('H-BAR', `${rel.position[2].toFixed(1)} m`)}${metric('RANGE RATE', `${approach.rangeRate.toFixed(2)} m/s`, Math.abs(approach.rangeRate) <= m.brakingLimit ? 'green' : 'red')}${metric('CLOSEST', `${approach.closestDistance.toFixed(1)} m`)}${metric('BRAKE LIMIT', `${m.brakingLimit.toFixed(2)} m/s`)}`
      : `${metric('ALT / GROUND', distance(altitudeAboveGround(s, m.env)))}${metric('VERTICAL', `${o.verticalSpeed.toFixed(0)} m/s`, Math.abs(o.verticalSpeed) < 20 ? 'green' : 'amber')}${metric('HORIZONTAL', `${o.horizontalSpeed.toFixed(0)} m/s`, Math.abs(o.horizontalSpeed - 1670) < 60 ? 'green' : 'amber')}${metric('FLIGHT PATH', `${(o.flightPathAngle * 180 / Math.PI).toFixed(1)}°`, Math.abs(o.flightPathAngle) < 0.05 ? 'green' : 'amber')}${metric('PERIAPSIS', distance(o.periapsisAltitude), o.periapsisAltitude > 10_000 ? 'green' : 'amber')}${metric('APOAPSIS', distance(o.apoapsisAltitude), Math.abs(o.apoapsisAltitude - 100_000) < 5000 ? 'green' : 'amber')}`;
    this.readouts.innerHTML = `<div class="window-count ${m.launched ? band : m.windowBand}">${m.launched ? status : `T${m.countdown >= 0 ? '−' : '+'}${duration(m.countdown)}`}<small>${m.launched ? `MET ${duration(s.t - m.liftoffTime)}` : 'LAUNCH WINDOW · GREEN ±3 s / AMBER ±20 s'}</small></div>
      <div class="flight-grid">${grid}</div>
      <div class="resources">MAIN ${(s.mainPropellant / KESTREL.mainPropellantCapacity * 100).toFixed(0)}% · RCS ${(s.rcsPropellant / KESTREL.rcsPropellantCapacity * 100).toFixed(0)}% · <span class="${s.batteryKWh < 3 ? 'red' : ''}">BATT ${s.batteryKWh.toFixed(1)} kWh</span><br>ARGO ${distance(m.range)} · reserve ${MOTHERSHIP.mainPropellantCapacity.toLocaleString()} kg · ${m.effectiveWarp}×<br>${docking ? `CW CPA T+${duration(approach.closestTime)} · ${m.probeDamaged ? 'PROBE DAMAGED' : m.dockingOutcome?.toUpperCase() ?? 'DOCK ENVELOPE LIVE'}` : m.launched && !m.result ? `CUE ${m.guidance.phase.toUpperCase()} · target 18 × 100 km` : 'Manual launch remains available outside the window'}<br>${docking ? 'Align all bars to 0.0 · close at 0.03–0.15 m/s' : m.launched ? `PITCH ${actualPitch.toFixed(0)}° → ${pitch.toFixed(0)}° cue · ${burnSeconds.toFixed(0)} s fuel at full thrust` : 'Atlas markers identify sites; only Hadley hardware is modelled'}${cue ? `<br><span class="cue ${cue[1]}">${cue[0]}</span>` : ''}</div>`;
    this.throttle.value = String((m.assisted && m.launched ? m.bus.read().throttle : m.throttle) * 100);
    this.throttle.disabled = m.assisted || !m.launched || !!m.result;
    this.panel.querySelector('output')!.textContent = `${Math.round(Number(this.throttle.value))}%`;
    this.panel.querySelector('header span')!.textContent = m.assisted ? 'AUTO DEMO' : 'MANUAL';
    this.panel.querySelector<HTMLInputElement>('input[type=checkbox]')!.disabled = docking;
    this.panel.querySelector<HTMLButtonElement>('[data-action=wait]')!.disabled = m.launched || !!m.result || (m.countdown >= 0 && m.countdown <= 30);
    const launch = this.panel.querySelector<HTMLButtonElement>('[data-action=launch]')!;
    launch.disabled = m.launched || !!m.result;
    launch.className = m.windowBand;
    this.panel.querySelector('[data-action=wait]')!.textContent = m.countdown < 0 ? 'Next window' : 'Wait to T−30 s';
    this.panel.querySelectorAll<HTMLButtonElement>('[data-attitude]').forEach(b => b.classList.toggle('active', b.dataset.attitude === m.attitudeMode));
    // Compact strip: status/countdown, the one-line cue, and either LAUNCH (pre-flight) or the attitude aids (in flight).
    const statusEl = this.mini.querySelector<HTMLElement>('.mini-status')!;
    statusEl.textContent = m.launched ? status : `T${m.countdown >= 0 ? '−' : '+'}${duration(m.countdown)}`;
    statusEl.className = `mini-status ${m.launched ? band : m.windowBand}`;
    const cueEl = this.mini.querySelector<HTMLElement>('.mini-cue')!;
    cueEl.textContent = cue ? cue[0] : m.launched ? `ALT ${distance(altitudeAboveGround(s, m.env))} · V ${o.verticalSpeed.toFixed(0)} m/s` : '';
    cueEl.className = `mini-cue ${cue ? cue[1] : ''}`;
    const flying = m.launched && !m.result && s.status !== 'docked';
    this.mini.querySelector<HTMLButtonElement>('[data-mini=launch]')!.hidden = m.launched;
    this.mini.querySelectorAll<HTMLButtonElement>('[data-mini-att]').forEach(b => {b.hidden = !flying; b.classList.toggle('active', b.dataset.miniAtt === m.attitudeMode);});
    this.showDebrief();
  }
}
