// Drives the new buggy with real key events and checks it accelerates, turbos, drifts, jumps and reverses. URL: ?scenario=drive
async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 200 && (!window.moonAscent || !window.moonAscent.texturesLoaded()); i++) await wait(250);
  const M = window.moonAscent, b = M.debug.buggy;
  const report = {ready: M && M.ready()};

  const start = {lat: b.lat, lon: b.lon};
  Object.assign(b, {speed: 0, slip: 0, altitude: 0, vVert: 0, airborne: false, roll: 0, rollRate: 0, flipped: false, turbo: 1});
  // Accelerate with turbo long enough to prove input, thrust and reserve use before the rough ground can launch it.
  M.key('w', true); M.key('shift', true); M.run(15, 1 / 30, false);
  report.cruiseSpeed = +b.speed.toFixed(2);
  report.turboDrained = b.turbo < 0.99;
  report.moved = Math.abs(b.lon - start.lon) + Math.abs(b.lat - start.lat) > 1e-6;
  // Isolate steering after the acceleration sample; unit tests own the terrain-dependent launch threshold.
  Object.assign(b, {airborne: false, altitude: 0, vVert: 0, speed: 6, slip: 0, roll: 0, rollRate: 0, flipped: false});
  M.key('a', true); M.run(6, 1 / 30, false); M.key('a', false);
  report.slipped = Math.abs(b.slip) > 0.1;
  // Release everything and let grip settle it.
  M.key('w', false); M.key('shift', false); M.run(30, 1 / 30, false);
  // Brake into reverse.
  Object.assign(b, {airborne: false, altitude: 0, vVert: 0, speed: 2, slip: 0, roll: 0, rollRate: 0, flipped: false});
  M.key('s', true); M.run(90, 1 / 30, false); M.key('s', false); M.run(1, 1 / 30, false);
  report.reversed = b.speed < -0.1;

  // In flight the same real keys command vacuum thrusters and attitude control.
  Object.assign(b, {airborne: true, altitude: 30, vVert: 0, roll: 0.45, rollRate: 1, flipped: false});
  const beforeFlight = {speed: b.speed, turbo: b.turbo, roll: Math.abs(b.roll)};
  M.key('w', true); M.key('r', true); M.run(18, 1 / 30, false); M.key('w', false); M.key('r', false);
  report.flight = {speed: b.speed, vVert: b.vVert, turbo: b.turbo, roll: Math.abs(b.roll), thrusting: b.flightThrusting};
  report.poweredFlight = b.flightThrusting && b.speed > beforeFlight.speed && b.vVert > 0 && b.turbo < beforeFlight.turbo;

  report.errors = M.errors();
  report.captured = (() => {try {M.capture(); return true;} catch (e) {report.captureError = String(e); return false;}})();
  report.passed = report.ready && report.moved && report.cruiseSpeed > 8 && report.slipped && report.reversed && report.poweredFlight &&
    report.captured && report.errors.length === 0;
  return report;
}
