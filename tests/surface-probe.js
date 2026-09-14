// Run with a URL carrying ?view=nadir&fixture=post&settle=1 and a debug mode (see tests/browser-run.ts).
async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const assert = (ok, message) => {if (!ok) throw Error(message);};
  for (let i = 0; i < 160 && document.body.dataset.settled !== '1'; i++) await wait(250);
  const M = window.moonAscent;
  assert(M && M.ready(), 'app not ready: ' + (M ? M.errors().join(' | ') : 'missing'));
  const query = new URLSearchParams(location.search);
  // Differential shadow measurement: pixels that are dark only while the post is present.
  let baseline = null;
  if (M.debug.fixture) {
    M.debug.fixture.visible = false; M.settle(1);
    baseline = M.debug.viewer.measure().luminance.slice();
    M.debug.fixture.visible = true; M.settle(1);
  }
  const m = M.debug.viewer.measure();
  const aspect = M.debug.viewer.camera.aspect;
  const report = {mode: query.get('debug'), eye: query.get('eye')};

  if (query.get('debug') === 'shadow' && !M.debug.fixture) {
    // Ground truth: ray-march the surface function toward the Sun over exactly the ground this nadir view shows.
    // Too much shadow bias erases small crater shadows; too little speckles the ground with acne. Both move the
    // rendered fraction away from the CPU fraction.
    M.debug.rocks.group.visible = false; M.debug.hardware.group.visible = false; M.settle(3);
    const s = M.debug.viewer.measure();
    let dark = 0;
    for (const l of s.luminance) if (l < 0.5) dark++;
    const rendered = dark / s.luminance.length * 100;
    const t = M.debug.terrain, site = t.toLocal(t.anchorLat, t.anchorLon);
    const sun = M.sitePanorama().sun, az = sun.azimuth * Math.PI / 180, slope = Math.tan(sun.elevation * Math.PI / 180);
    const halfH = 25 * Math.tan(25 * Math.PI / 180), halfW = halfH * M.debug.viewer.camera.aspect;
    const H = (x, y) => {const q = t.fromLocal(x, y); return t.height(q.lat, q.lon);};
    let shadowed = 0, n = 0;
    for (let y = -halfH; y < halfH; y += 0.3) for (let x = -halfW; x < halfW; x += 0.3) {
      const px = site.x + x, py = site.y + y, h0 = H(px, py) + 0.02;
      for (let d = 0.3; d < 40; d *= 1.15) if (H(px + Math.sin(az) * d, py + Math.cos(az) * d) > h0 + d * slope) {shadowed++; break;}
      n++;
    }
    const truth = shadowed / n * 100;
    Object.assign(report, {renderedPercent: +rendered.toFixed(2), cpuPercent: +truth.toFixed(2)});
    // The CPU march has no penumbra or PCF, so hair-thin crater crescents count there and blur away in the render.
    // Acne would push the ratio far above 1; over-biasing (the bug this guards) drove it to ~0.
    const ratio = rendered / Math.max(truth, 1e-6);
    assert(truth > 0.2 && ratio > 0.35 && ratio < 1.6, `rendered shadow ${rendered.toFixed(2)}% vs CPU ray-march ${truth.toFixed(2)}%`);
  }

  if (query.get('debug') === 'shadow' && M.debug.fixture) {
    // Shadow of the 4 m post: dark pixels 1.5-10 m from the post (screen centre), north up and east right.
    const halfHeight = 25 * Math.tan((50 / 2) * Math.PI / 180);
    let sx = 0, sy = 0, n = 0;
    for (let j = 0; j < m.height; j++) for (let i = 0; i < m.width; i++) {
      const k = j * m.width + i;
      if (m.luminance[k] > 0.5 || !baseline || baseline[k] < 0.5) continue;
      const x = ((i + 0.5) / m.width * 2 - 1) * halfHeight * aspect, y = ((j + 0.5) / m.height * 2 - 1) * halfHeight;
      const d = Math.hypot(x, y);
      if (d < 1.5 || d > 10) continue;
      sx += x; sy += y; n++;
    }
    const measured = (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360;
    const expected = (M.sitePanorama().sun.azimuth + 180) % 360;
    const error = Math.abs(((measured - expected + 540) % 360) - 180);
    Object.assign(report, {darkPixels: n, measured, expected, error});
    assert(n > 20, 'post shadow not found');
    assert(error < 5, `shadow points to ${measured.toFixed(1)} deg, sun says ${expected.toFixed(1)} deg`);
  }

  if (query.get('debug') === 'albedo') {
    // Looking straight down, every pixel must be ground: a black pixel is a crack or hole between terrain rings.
    // Rocks and hardware are hidden first (their unlit sides and black blankets are legitimately dark).
    M.debug.rocks.group.visible = false; M.debug.hardware.group.visible = false; M.settle(1);
    const ground = M.debug.viewer.measure();
    let holes = 0;
    for (let k = 0; k < ground.luminance.length; k++) if (ground.luminance[k] < 0.01) holes++;
    Object.assign(report, {holes});
    assert(holes <= 2, `${holes} hole pixels in the terrain (ring seam or discard error)`);
  }
  return {passed: true, report};
}
