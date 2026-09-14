// Drives the real UI with keyboard events and button clicks. URL: ?scenario=window-open&view=pad
async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const assert = (ok, message) => {if (!ok) throw Error(message);};
  for (let i = 0; i < 200 && document.body.dataset.settled !== '1'; i++) await wait(250);
  const M = window.moonAscent, m = M.debug.mission;
  assert(M && M.ready(), 'app not ready');
  const click = selector => {const el = document.querySelector(selector); assert(el, `missing ${selector}`); el.click();};
  const hold = (key, frames) => {M.key(key, true); M.run(frames); M.key(key, false); M.run(1);};
  const report = {};

  // Before launch: countdown, labels and map cycle, sound toggle.
  assert(document.querySelector('.window-count').textContent.includes('T'), 'no launch countdown');
  const labels0 = M.debug.labels.mode; M.key('l'); M.key('l', false);
  assert(M.debug.labels.mode !== labels0, 'L did not cycle labels');
  const map0 = M.debug.lunarMap.mode; M.key('m'); M.key('m', false);
  assert(M.debug.lunarMap.mode !== map0, 'M did not cycle map');
  M.key('p'); M.key('p', false);
  report.soundAfterP = M.debug.audio.enabled;

  // Launch from the HUD, in the window.
  assert(Math.abs(m.countdown) <= 31, `scenario not at T-30 (${m.countdown})`);
  M.run(Math.ceil(m.countdown * 30));
  click('[data-action=launch]');
  M.run(2);
  assert(m.launched, 'LAUNCH button did not launch');
  assert(document.querySelector('#camera-view').value === 'chase', 'launch did not switch to chase camera');

  // Throttle keys and Space cut.
  m.throttle = 0.5;
  hold('ArrowUp', 30);
  assert(m.throttle > 0.6, `ArrowUp did not raise throttle (${m.throttle})`);
  M.key(' '); M.key(' ', false); M.run(1);
  assert(m.throttle === 0, 'Space did not cut the engine');
  m.throttle = 1;

  // Attitude: I pitches while held; releasing with HOLD damps the rate.
  M.key('i'); M.run(20);
  assert(m.bus.read().rotate[0] === 1, 'I key did not command pitch');
  const spin = Math.abs(m.state.w[0]);
  M.key('i', false); M.run(90);
  assert(Math.abs(m.state.w[0]) < spin * 0.5, 'HOLD did not damp the pitch rate after release');
  M.key('q'); M.key('q', false); assert(m.attitudeMode === 'free', 'Q did not toggle HOLD off');
  M.key('e'); M.key('e', false); assert(m.attitudeMode === 'dock', 'E did not select DOCK');
  M.key('g'); M.key('g', false); assert(m.attitudeMode === 'match', 'G did not select MATCH');
  click('[data-attitude=stabilize]'); M.run(2);
  assert(m.attitudeMode === 'stabilize', 'HOLD button did not select stabilize');

  // Cameras and warp (warp must stay 1x while firing).
  for (const [key, view] of [['v', 'cockpit'], ['n', 'docking'], ['b', 'argo'], ['c', 'chase']]) {
    M.key(key); M.key(key, false);
    assert(document.querySelector('#camera-view').value === view, `${key} did not select ${view}`);
  }
  M.key(']'); M.key(']', false); M.run(5);
  assert(m.effectiveWarp === 1, 'warp was allowed while the engine fired');

  // Crash: cut the engine low and fall back.
  m.throttle = 0; m.attitudeMode = 'stabilize';
  for (let i = 0; i < 90 && !m.result; i++) M.run(30);
  assert(m.result === 'surface-impact' || m.result === 'landed-back', `no surface result (${m.result})`);
  M.run(10);
  const debrief = document.querySelector('.debrief');
  assert(!debrief.hidden && /SURFACE|BACK ON/.test(debrief.textContent), 'no debrief after the crash');
  report.crash = {result: m.result, impact: +m.impactSpeed.toFixed(1), debrief: debrief.querySelector('h2').textContent, effects: M.debug.effects.active};
  if (m.result === 'surface-impact') assert(M.debug.effects.active > 0 && !M.debug.ascentFrame.visible, 'impact did not replace the lander with debris');
  click('[data-debrief=watch]'); M.run(2);
  assert(debrief.hidden, 'Look around did not dismiss the debrief');
  assert(M.errors().length === 0, 'shader errors: ' + M.errors().join('|'));
  return {passed: true, width: innerWidth, report};
}
