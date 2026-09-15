/**
 * The flight manual: a full-screen reference the player can open any time, covering the science and the controls of
 * every phase — launch window, gravity-turn ascent, orbit, rendezvous and docking, powered descent, and driving and
 * flying the buggy — plus a glossary of the constants the HUD shows and what good numbers look like. Pure DOM; the
 * numbers are the same ones the sim uses, so the manual and the game never drift apart.
 */
export class Manual {
  readonly button = document.createElement('button');
  private overlay = document.createElement('div');
  private open = false;

  constructor(parent: HTMLElement) {
    this.button.id = 'manual-btn';
    this.button.textContent = 'Manual ?';
    this.button.title = 'Open the flight manual: the science of ascent, orbit, docking and descent, all controls, and what the numbers mean';
    this.overlay.className = 'manual-overlay';
    this.overlay.hidden = true;
    this.overlay.innerHTML = this.content();
    parent.appendChild(this.overlay);
    this.button.onclick = () => this.toggle();
    this.overlay.addEventListener('click', e => {if ((e.target as HTMLElement).closest('[data-close], .manual-backdrop')) this.toggle(false);});
    addEventListener('keydown', e => {if (e.key === 'Escape' && this.open) this.toggle(false); if (e.key === '?' && !(e.target as HTMLElement).matches('input,textarea')) this.toggle();});
  }

  toggle(want = !this.open) {
    this.open = want;
    this.overlay.hidden = !want;
    this.button.classList.toggle('view-active', want);
  }

  private content() {
    return `<div class="manual-backdrop"></div><article class="manual" role="dialog" aria-label="Flight manual">
      <header><h2>LAST WINDOW · FLIGHT MANUAL</h2><button data-close aria-label="Close">✕</button></header>
      <div class="manual-body">
        <section>
          <h3>The mission</h3>
          <p>A new crew at Hadley must launch inside a short <b>launch window</b>, fly a manual <b>ascent</b> to a
          100&nbsp;km orbit, then <b>rendezvous and dock</b> with the mothership <b>ARGO</b>. The <b>descent</b> mission
          is the reverse: brake out of orbit and land softly. Everything is real orbital mechanics on real terrain, so
          the same physics rewards patience and punishes a hard, misaligned, or fuel-hungry approach.</p>
          <p class="tip">Watch button: run the whole thing on <b>Autopilot [Y]</b> once to see a clean flight, then fly it yourself.</p>
        </section>

        <section>
          <h3>Launch window &amp; the gravity turn</h3>
          <p>ARGO circles the Moon every ~2&nbsp;hours. You can only reach it if you leave when your launch site is in
          the right place under its orbit — the <b>green window</b> (±3&nbsp;s), with an amber margin (±20&nbsp;s). Miss
          it and you must wait for the next pass (or warp time forward).</p>
          <p>Straight up wastes everything: orbit is <b>sideways speed</b>, not height. So the ascent <b>pitches over</b>
          — a <b>gravity turn</b> — trading vertical climb for horizontal velocity. That lean you see in autopilot is
          correct, not a glitch. Target: raise apoapsis to ~100&nbsp;km, then circularize so periapsis also clears the
          surface. Reaching orbit needs about <b>1.7&nbsp;km/s</b>; KESTREL carries ~2.97&nbsp;km/s of Δv.</p>
          <p><b>Controls:</b> ↑/↓ throttle, Space cut throttle, I/K pitch, J/L yaw, U/O roll. HOLD&nbsp;[Q] damps
          rotation. Keep flight-path angle dropping smoothly toward the horizon as you climb.</p>
        </section>

        <section>
          <h3>Rendezvous &amp; docking</h3>
          <p>Once in orbit you close on ARGO. Relative motion near another orbit is <b>not</b> intuitive: burning toward
          the target changes your orbit and you drift <i>past</i> it. The HUD works in the <b>LVLH</b> frame (local
          vertical / local horizontal) and predicts the drift with the <b>Clohessy–Wiltshire</b> equations, so trust
          the cue, not your eyes.</p>
          <ul>
            <li><b>MATCH [G]</b> — point along the relative velocity and null it, so ARGO stops drifting.</li>
            <li><b>DOCK [E]</b> — line up with the docking port axis.</li>
            <li>Translate with W/S (fore/aft), A/D (left/right), R/F (up/down); the on-screen cue names the keys.</li>
          </ul>
          <p><b>A good dock:</b> closing speed under ~0.2&nbsp;m/s, lateral offset under a metre, port axis and roll
          aligned within a few degrees, rates near zero. Contact faster or crooked and you bounce or break the port.</p>
        </section>

        <section>
          <h3>Powered descent</h3>
          <p>Descent (<b>Descent&nbsp;↓</b> or <code>?scenario=descent</code>) starts at <b>powered-descent initiation</b>:
          15&nbsp;km up with ~1692&nbsp;m/s still to kill, engine pointed into the flight path. You pitch the thrust just
          above retrograde to hold a <b>sink rate</b> that shrinks as you near the ground, while the rest of the thrust
          brakes your horizontal speed.</p>
          <p>Key subtlety: brake toward the <b>surface's</b> velocity, not zero — the Moon's ground moves ~4&nbsp;m/s
          under you, so nulling inertial velocity lands you sideways hard. <b>RETRO&nbsp;[R]</b> holds the braking
          attitude; a soft touchdown is under ~2&nbsp;m/s, near-level.</p>
        </section>

        <section>
          <h3>The buggy — driving</h3>
          <p>Take the surface buggy with <b>Drive buggy</b>. On the ground: <b>W</b> accelerate, <b>S</b> brake then
          reverse, <b>A/D</b> steer, <b>Shift</b> turbo. Top speed ~200&nbsp;km/h, ~400&nbsp;km/h and beyond on turbo
          while the reserve lasts. All real low-gravity physics:</p>
          <ul>
            <li><b>Braking is weak</b> — friction on the Moon is a fraction of Earth's, so stops are long and slidey.</li>
            <li><b>It flies off crests.</b> Over a rise of radius R the wheels leave the ground at <b>v&nbsp;=&nbsp;√(g·R)</b>
              — a sharp crater rim at ~5&nbsp;m/s, a broad hill only at high speed, a cliff edge at any speed.</li>
            <li><b>Hard cornering rolls it.</b> Low gravity means a low tip limit, so fast sharp turns flip it; it rights
              itself after a moment.</li>
            <li>Uphill costs speed, downhill pays it back; rocks and hardware bump you.</li>
          </ul>
        </section>

        <section>
          <h3>The buggy — flying</h3>
          <p>Once airborne the buggy is a <b>vacuum rocket flyer</b> and the keys change meaning: <b>W/S</b> forward /
          retro thrust, <b>A/D</b> turn and bank, <b>R</b> climb, <b>F</b> descend, <b>Shift</b> boost. Thrusters burn
          the same reserve turbo uses; it recharges whenever you are not firing, in the air too. The flight console
          shows <b>AIR SPEED</b>, <b>ALT AGL</b> and climb rate.</p>
        </section>

        <section>
          <h3>Navigation &amp; the whole Moon</h3>
          <p>Pick any real mission from <b>Set target…</b> — Apollo, Luna, the Lunokhod rovers, Surveyor, China's Chang'e
          and the far-side Yutu-2, Chandrayaan-3, SLIM, the UAE's Rashid and more. An on-screen arrow points to it with
          the <b>distance left</b>, and the map draws a bearing line and a ring. Scroll the map to zoom. The Moon is
          ~10,900&nbsp;km around, so a full lap is a long haul — use <b>time-warp [ ] (up to 1000×)</b> for the coasts
          and waits. The far side is genuinely dark when the Sun is down.</p>
        </section>

        <section>
          <h3>Reading the numbers</h3>
          <dl class="glossary">
            <dt>AGL / ALT</dt><dd>Height above the ground directly below (metres, then km).</dd>
            <dt>Vertical / Horizontal speed</dt><dd>Climb rate and sideways speed. Orbit is mostly horizontal.</dd>
            <dt>Flight-path angle</dt><dd>Angle of your velocity above the horizon; drives toward 0° as you circularize.</dd>
            <dt>Periapsis / Apoapsis</dt><dd>Lowest and highest points of your orbit. Both must clear the surface for a stable orbit.</dd>
            <dt>Range / rangeRate</dt><dd>Distance to ARGO's port and how fast it is closing (negative closes).</dd>
            <dt>Δv</dt><dd>Total change in velocity your propellant can give — the true "fuel gauge" for orbital work.</dd>
            <dt>Warp</dt><dd>Time acceleration for coasts and waits, 1×–1000×; automatically 1× during a burn or while driving.</dd>
          </dl>
        </section>
      </div>
    </article>`;
  }
}
