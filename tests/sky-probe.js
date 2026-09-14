async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const assert = (ok, message) => {if (!ok) throw Error(message);};
  for (let i = 0; i < 80 && !window.moonAscent; i++) await wait(250);
  const M = window.moonAscent;
  assert(M, 'app did not start');
  for (let i = 0; i < 80 && !M.texturesLoaded(); i++) await wait(250);
  assert(M.texturesLoaded(), 'textures did not load');
  assert(M.ready(), 'shader errors: ' + M.errors().join(' | '));
  const report = {};

  // Earth: projected position and size match the rendered disc (outer limb of the lit crescent).
  M.setView('earth'); M.settle(150);
  const centre = M.earthNdc(), radius = M.earthRadiusNdc();
  const lit = M.brightExtent(centre.x, centre.y, 0.02);
  report.earth = {centre, radius, extent: lit.extent, litPixels: lit.count};
  assert(centre.visible, 'Earth not in the telephoto view');
  assert(lit.finite, 'NaN or Inf in the HDR buffer (earth view)');
  assert(lit.count > 200, 'too few lit Earth pixels: ' + lit.count);
  assert(Math.abs(lit.extent - radius) < 3 * lit.pixelNdc, `Earth limb at ${lit.extent.toFixed(3)} NDC, expected ${radius.toFixed(3)} +- 3 px`);

  // Daylight at Hadley: black sky above a lit landscape, stars washed out by exposure.
  M.setView('site'); M.settle(200);
  report.daylight = {exposure: M.exposure(), topRow: M.rowLuminance(140), bottomRow: M.rowLuminance(2)};
  assert(report.daylight.bottomRow > 0.005, 'sunlit ground too dark: ' + report.daylight.bottomRow); // Earth in frame caps exposure; P3 terrain tightens this
  assert(report.daylight.topRow < 0.01 * report.daylight.bottomRow, 'sky not black against sunlit ground');
  assert(report.daylight.exposure < 200, 'daylight exposure implausibly high: ' + report.daylight.exposure);

  // Dark sky: exposure adapts up to show stars and the Milky Way.
  M.setView('site'); M.look(300, 40); M.settle(300);
  const stars = M.brightExtent(0, 0, 0.3);
  report.darkSky = {exposure: M.exposure(), brightPixels: stars.count};
  assert(report.darkSky.exposure > 1e5, 'eye did not dark-adapt: ' + report.darkSky.exposure);
  assert(stars.count > 20, 'no stars visible in a dark sky');

  // Night side of the Moon lit only by earthshine, never pure black where Earth is up.
  M.setView('nightside'); M.settle(300);
  report.nightside = {exposure: M.exposure(), centre: M.pixelLuminance(0.15, 0)};

  // Regression (2026-09-14): from a dark-adapted sky, turning to Earth or zooming out must not blow Earth out.
  M.setView('site'); M.look(300, 40); M.settle(300);
  M.setView('earth'); M.settle(2);
  const turned = M.brightExtent(M.earthNdc().x, M.earthNdc().y, 20);
  report.turnToEarth = {exposure: M.exposure(), saturatedPixels: turned.count};
  assert(turned.count === 0, 'Earth blown out right after turning to it from a dark sky');
  M.look(M.sitePanorama().earth.azimuth, M.sitePanorama().earth.elevation, 100); M.settle(300);
  const small = M.brightExtent(M.earthNdc().x, M.earthNdc().y, 20);
  report.zoomedOut = {exposure: M.exposure(), saturatedPixels: small.count};
  assert(small.count === 0, 'small Earth in a wide black sky is blown out');
  M.setView('nightside'); M.look(0, -60); M.settle(300);
  M.setView('globe'); M.settle(2);
  report.moonEntersView = {exposure: M.exposure(), saturatedPixels: M.brightExtent(0, 0, 20).count};
  assert(report.moonEntersView.saturatedPixels === 0, 'sunlit Moon flashes white when it enters a dark-adapted view');

  report.fps = M.fps();
  return {passed: true, report};
}
