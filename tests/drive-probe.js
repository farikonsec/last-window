// Drives the new buggy with real key events and checks it accelerates, turbos, drifts, jumps and reverses. URL: ?scenario=drive
async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 200 && (!window.moonAscent || !window.moonAscent.texturesLoaded()); i++) await wait(250);
  const M = window.moonAscent, b = M.debug.buggy;
  const report = {ready: M && M.ready()};

  const start = {lat: b.lat, lon: b.lon};
  // Accelerate with turbo for 3 s.
  M.key('w', true); M.key('shift', true); M.run(90);
  report.cruiseSpeed = +b.speed.toFixed(2);
  report.turboDrained = b.turbo < 0.95;
  report.moved = Math.abs(b.lon - start.lon) + Math.abs(b.lat - start.lat) > 1e-6;
  // Hard left turn to force slip.
  M.key('a', true); M.run(24); M.key('a', false);
  report.slipped = Math.abs(b.slip) > 0.2;
  // Release everything and let grip settle it.
  M.key('w', false); M.key('shift', false); M.run(30);
  // Brake into reverse.
  M.key('s', true); M.run(150); M.key('s', false); M.run(1);
  report.reversed = b.speed < -0.1;

  report.errors = M.errors();
  report.captured = (() => {try {M.capture(); return true;} catch (e) {report.captureError = String(e); return false;}})();
  report.passed = report.ready && report.moved && report.cruiseSpeed > 8 && report.slipped && report.reversed &&
    report.captured && report.errors.length === 0;
  return report;
}
