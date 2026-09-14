// URL: ?scenario=terminal. Flies the final approach with the RCS keys the HUD cue shows, then checks a collision.
async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const assert = (ok, message) => {if (!ok) throw Error(message);};
  for (let i = 0; i < 200 && document.body.dataset.settled !== '1'; i++) await wait(250);
  const M = window.moonAscent, m = M.debug.mission;
  assert(M && M.ready(), 'app not ready');
  const report = {};

  // Docking by following the on-screen cue with real key events (start 6 m out to keep the test short).
  m.placeForDocking(6, 0.08, 0.6, -0.4);
  M.key('e'); M.key('e', false);
  assert(m.attitudeMode === 'dock', 'E did not select DOCK');
  const keyFor = [['a', 'd'], ['f', 'r'], ['s', 'w']];
  const down = new Set();
  for (let frame = 0; frame < 30 * 600 && m.state.status !== 'docked' && !m.result; frame++) {
    const cue = m.translationCue.keys;
    for (let axis = 0; axis < 3; axis++) {
      const want = cue[axis] < 0 ? keyFor[axis][0] : cue[axis] > 0 ? keyFor[axis][1] : null;
      for (const key of keyFor[axis]) {
        if (key === want && !down.has(key)) {M.key(key, true); down.add(key);}
        if (key !== want && down.has(key)) {M.key(key, false); down.delete(key);}
      }
    }
    M.run(1, 1 / 30, frame % 60 === 0);
  }
  for (const key of down) M.key(key, false);
  M.run(10);
  assert(m.state.status === 'docked', `docking by cue failed (${m.state.status}, ${m.result}, ${m.dockingOutcome})`);
  const debrief = document.querySelector('.debrief');
  assert(!debrief.hidden && debrief.classList.contains('success'), 'no success debrief after docking');
  report.docked = {outcome: m.dockingOutcome, rcsLeft: +m.state.rcsPropellant.toFixed(1), title: debrief.querySelector('h2').textContent};

  // Ramming: fast, off-axis approach destroys both ships.
  debrief.querySelector('[data-debrief=watch]').click();
  m.placeForDocking(40, 3.5, 5, 0);
  M.debug.argoFrame.visible = true;
  for (let i = 0; i < 30 * 40 && !m.result; i++) M.run(1, 1 / 30, i % 30 === 0);
  assert(m.result === 'collision', `expected a collision (${m.result})`);
  M.run(15);
  assert(M.debug.effects.active > 0 && !M.debug.argoFrame.visible, 'collision did not destroy both ships visibly');
  report.collision = {impact: +m.impactSpeed.toFixed(2), effects: M.debug.effects.active};
  assert(M.errors().length === 0, 'shader errors: ' + M.errors().join('|'));
  return {passed: true, width: innerWidth, report};
}
