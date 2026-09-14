async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const assert = (ok, msg) => {if (!ok) throw new Error(msg);};
  for (let i = 0; i < 160 && (!window.moonAscent || !window.moonAscent.texturesLoaded()); i++) await wait(250);
  const M = window.moonAscent;
  assert(M && M.ready(), 'Game did not load cleanly');
  const {labels, lunarMap, hardware, mission} = M.debug;
  assert(hardware.objects.size === 6, 'Missing surface hardware');
  assert(document.querySelectorAll('.label.kind-hardware').length === 7, 'Every model needs a label including ARGO');
  document.querySelector('#label-mode').click(); assert(labels.mode === 'all', 'Label button failed');
  document.querySelector('#label-mode').click(); assert(labels.mode === 'off', 'Labels off failed');
  document.querySelector('#label-mode').click();
  document.querySelector('#map-mode').click(); assert(lunarMap.mode === 'moon', 'Moon map toggle failed');
  await wait(250);
  assert(lunarMap.track.length === 121, 'ARGO ground track missing');
  document.querySelector('#map-mode').click(); assert(lunarMap.mode === 'off', 'Map off failed');
  document.querySelector('#map-mode').click();
  const pick = document.querySelector('#inspect-equipment');
  for (const id of ['apollo15-lrv', 'apollo15-alsep', 'un-flag', 'kestrel']) {
    pick.value = id; pick.dispatchEvent(new Event('change')); await wait(100);
  }
  // Zoom and sunward camera tests: illumination should not pump with framing.
  M.setView('apollo'); M.settle(180); const wide = M.exposure();
  M.look(322, -2, 12); M.settle(180); const close = M.exposure();
  M.setView('site'); M.look(98, 3, 55); M.settle(180); const sunward = M.exposure();
  assert(close / wide > 0.75 && close / wide < 1.3, 'Zoom changes surface exposure');
  assert(sunward / wide > 0.75 && sunward / wide < 1.3, 'Sun darkens surface');
  assert(M.rowLuminance(2) > 0.02, 'Sunward ground is too dark');
  const nav = document.querySelector('.nav-controls').getBoundingClientRect();
  assert(nav.left >= 0 && nav.right <= innerWidth, 'Navigation outside viewport');
  const panel = document.querySelector('.mission-panel').getBoundingClientRect();
  assert(panel.left >= 0 && panel.right <= innerWidth && panel.bottom <= innerHeight, 'Flight controls outside viewport');
  M.setView('pad');
  document.querySelector('[data-action=wait]').click();
  assert(mission.countdown <= 30.1 && mission.countdown > 25, 'Wait button did not reach window');
  document.querySelector('[data-action=launch]').click();
  await wait(2000);
  assert(mission.launched && mission.state.status === 'flying', 'Launch button failed');
  assert(M.debug.ascentFrame.children.length === 1, 'Ascent stage did not separate');
  assert(mission.state.mainPropellant < 4999, 'No real fuel burn');
  const slider = document.querySelector('input[type=range]'); slider.value = '0'; slider.dispatchEvent(new Event('input')); await wait(100);
  assert(mission.bus.read().throttle === 0, 'Throttle cut did not reach actuators');
  assert(M.errors().length === 0, 'Shader error during launch');
  return {passed: true, exposure: {wide, close, sunward}, flight: {status: mission.state.status, t: mission.state.t, propellant: mission.state.mainPropellant}, width: innerWidth};
}
