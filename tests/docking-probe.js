async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const assert = (ok, message) => {if (!ok) throw Error(message);};
  for (let i = 0; i < 120 && (!window.moonAscent || !window.moonAscent.texturesLoaded()); i++) await wait(250);
  const M = window.moonAscent, mission = M?.debug.mission;
  assert(M?.ready() && mission, 'terminal scenario did not load');
  M.setView('docking'); M.settle(30);
  const sight = document.querySelector('.docking-sight');
  assert(!sight.hidden && sight.textContent.includes('ARGO PORT'), 'COAS docking sight missing');
  assert(document.querySelector('.flight-readouts').textContent.includes('R-BAR'), 'LVLH readouts missing');
  assert(mission.approach.closestDistance >= 0, 'CW closest-approach prediction missing');
  assert(mission.effectiveWarp === 1, 'terminal approach did not force 1x warp');

  mission.placeForDocking(25, 0.1);
  const fuel = mission.state.rcsPropellant;
  mission.translation = [0, 0, 1];
  mission.advance(1, 1);
  mission.translation = [0, 0, 0];
  mission.advance(0.1, 1);
  assert(mission.state.rcsPropellant < fuel, 'fore/aft RCS input did not consume propellant');
  assert(mission.bus.read().translate[2] === 0, 'released translation input remained active');

  mission.placeForDocking(0.04, 0.1);
  for (let i = 0; i < 100 && !mission.captureRemaining; i++) mission.advance(0.05, 1);
  assert(mission.dockingOutcome === 'capture', 'nominal docking did not soft-capture');
  for (let i = 0; i < 120 && mission.state.status !== 'docked'; i++) mission.advance(0.05, 1);
  M.settle(2);
  assert(mission.state.status === 'docked', 'latches did not complete hard dock');
  assert(sight.textContent.includes('HARD DOCK'), 'docking sight did not show pressure-seal state');
  assert(M.errors().length === 0, 'shader error in terminal view');
  return {passed: true, width: innerWidth, outcome: mission.dockingOutcome, status: mission.state.status};
}
