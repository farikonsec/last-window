/**
 * Capture README media from the running dev server: stills via the game's own canvas capture, and short clips recorded
 * off the canvas with MediaRecorder, then encoded to GIF with ffmpeg. Run with `bun run dev` already serving.
 *
 *   bun tools/capture-media.ts [name ...]
 *
 * Output: .artifacts/media/*.png and *.gif. Nothing here touches the published tree; the deploy step copies what it wants.
 */
import {mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const verifier = process.env.INTERCEPTOR_VERIFY_SCRIPT ?? join(homedir(), '.claude/skills/Interceptor/Tools/VerifyViewport.ts');
const base = process.env.GAME_TEST_URL ?? 'http://127.0.0.1:5181';
const out = '.artifacts/media';
mkdirSync(out, {recursive: true});

const WAIT = `const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 240 && (!window.moonAscent || !window.moonAscent.texturesLoaded()); i++) await wait(250);
  const M = window.moonAscent;`;

/** A still: load the url, run the setup, return the canvas PNG. */
function stillExpr(setup: string) {
  return `async () => {\n  ${WAIT}\n  ${setup}\n  M.run(50, 1/30, true);\n  return {png: M.capture()};\n}`;
}

/** A clip: record the canvas while the setup drives the sim, return a base64 webm. */
function clipExpr(setup: string, frames: number) {
  return `async () => {
  ${WAIT}
  const canvas = M.debug.viewer.renderer.domElement;
  const rec = new MediaRecorder(canvas.captureStream(30), {mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 4e6});
  const chunks = []; rec.ondataavailable = e => chunks.push(e.data);
  rec.start();
  ${setup}
  for (let i = 0; i < ${frames}; i++) { step(i); M.run(1, 1/30, true); await new Promise(r => requestAnimationFrame(r)); }
  await new Promise(r => { rec.onstop = r; rec.stop(); });
  const u8 = new Uint8Array(await new Blob(chunks, {type: 'video/webm'}).arrayBuffer());
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return {webm: btoa(s), bytes: u8.length};
}`;
}

async function probe(url: string, expr: string, width: number) {
  const file = join(out, '.expr.js');
  writeFileSync(file, expr);
  const p = Bun.spawn(['bun', verifier, 'probe', url, '--widths', String(width), '--expr', `@${file}`], {stdout: 'pipe', stderr: 'pipe'});
  const text = await new Response(p.stdout).text();
  await p.exited;
  try {
    return JSON.parse(text.slice(text.indexOf('{'))).results?.[0]?.value ?? {};
  } catch {
    return {}; // probe timed out or returned nothing; the caller reports and moves on
  }
}

interface Shot {name: string; url: string; setup?: string; clip?: {frames: number; fps: number; width: number}; width?: number}

const SHOTS: Shot[] = [
  // Stills.
  {name: 'pad', url: '?view=pad&scenario=window-open&hud=0', setup: ''},
  {name: 'ascent', url: '?scenario=ascent&view=chase&hud=0', setup: 'M.run(260, 1/30, false);'},
  {name: 'docking-sight', url: '?scenario=terminal&view=docking&hud=1', setup: "M.debug.mission.attitudeMode='dock';M.run(60,1/30,false);"},
  {name: 'argo', url: '?scenario=terminal&view=argo&hud=0', setup: 'M.run(20, 1/30, false);'},
  {name: 'surface', url: '?view=rille&hud=0', setup: ''},
  {name: 'orbit', url: '?view=orbit&hud=0', setup: ''},
  {name: 'buggy', url: '?scenario=drive&hud=1', setup: "M.key('w',true);M.key('shift',true);M.run(120,1/30,false);M.key('d',true);M.run(18,1/30,false);M.key('d',false);M.run(8,1/30,false);"},
  {name: 'buggy-flight', url: '?scenario=drive&buggy=flight&hud=1', setup: "M.run(40,1/30,false);"},
  {name: 'mission-lunokhod', url: '?probe=lunokhod2&hud=1', setup: "M.run(8,1/30,false);M.key('w',true);M.run(10,1/30,false);M.key('w',false);M.key('s',true);M.run(14,1/30,false);M.key('s',false);"},
  {name: 'mission-surveyor', url: '?probe=surveyor1&hud=1', setup: "M.run(8,1/30,false);M.key('w',true);M.run(10,1/30,false);M.key('w',false);M.key('s',true);M.run(14,1/30,false);M.key('s',false);"},
  {name: 'mission-yutu', url: '?probe=change4&hud=1', setup: "M.run(8,1/30,false);M.key('w',true);M.run(10,1/30,false);M.key('w',false);M.key('s',true);M.run(14,1/30,false);M.key('s',false);"},
  {name: 'mission-vikram', url: '?probe=chandrayaan3&hud=1', setup: "M.run(8,1/30,false);M.key('w',true);M.run(10,1/30,false);M.key('w',false);M.key('s',true);M.run(14,1/30,false);M.key('s',false);"},
  {name: 'mission-odysseus', url: '?probe=im1&hud=1', setup: "M.run(8,1/30,false);M.key('w',true);M.run(10,1/30,false);M.key('w',false);M.key('s',true);M.run(14,1/30,false);M.key('s',false);"},
  {name: 'map', url: '?scenario=drive&hud=1', setup: "M.debug.lunarMap.mode='moon';const s=document.querySelector('#target');s.value='change4';s.dispatchEvent(new Event('change',{bubbles:true}));M.run(6,1/30,false);"},
  // Clips.
  {name: 'dock', url: '?scenario=terminal&view=docking&hud=1', clip: {frames: 150, fps: 12, width: 900},
    setup: "M.debug.mission.attitudeMode='dock';const step=i=>{M.debug.mission.translation=M.debug.mission.translationCue.keys;};"},
  {name: 'drive', url: '?scenario=drive&hud=1', clip: {frames: 110, fps: 10, width: 800},
    setup: "M.key('w',true);M.key('shift',true);const step=i=>{if(i===60)M.key('d',true);if(i===85)M.key('d',false);};"},
  {name: 'dock-out', url: '?scenario=terminal&view=argo&hud=0', clip: {frames: 140, fps: 10, width: 800},
    setup: "M.debug.mission.attitudeMode='dock';const step=i=>{M.debug.mission.translation=M.debug.mission.translationCue.keys;};"},
  {name: 'liftoff', url: '?scenario=window-open&view=chase&hud=1', clip: {frames: 150, fps: 12, width: 900},
    setup: "M.debug.mission.waitForWindow();M.debug.mission.advance(30,1);M.debug.mission.assisted=true;M.debug.mission.launch();const step=i=>{};"},
];

const only = process.argv.slice(2);
for (const shot of SHOTS) {
  if (only.length && !only.includes(shot.name)) continue;
  const url = base + '/' + shot.url;
  if (shot.clip) {
    const v = await probe(url, clipExpr(shot.setup ?? 'const step=i=>{};', shot.clip.frames), shot.clip.width);
    if (!v.webm) {console.log(`${shot.name}: FAILED (no video)`); continue;}
    const webm = join(out, `${shot.name}.webm`);
    writeFileSync(webm, Buffer.from(v.webm, 'base64'));
    const gif = join(out, `${shot.name}.gif`);
    const pal = join(out, `${shot.name}-pal.png`);
    const vf = `fps=${shot.clip.fps},scale=760:-1:flags=lanczos`;
    Bun.spawnSync(['ffmpeg', '-y', '-i', webm, '-vf', `${vf},palettegen=max_colors=160`, pal], {stdout: 'ignore', stderr: 'ignore'});
    Bun.spawnSync(['ffmpeg', '-y', '-i', webm, '-i', pal, '-lavfi', `${vf} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3`, gif], {stdout: 'ignore', stderr: 'ignore'});
    rmSync(pal, {force: true});
    console.log(`${shot.name}: ${(v.bytes / 1e6).toFixed(1)} MB webm -> gif`);
  } else {
    const v = await probe(url, stillExpr(shot.setup ?? ''), shot.width ?? 1280);
    if (!v.png) {console.log(`${shot.name}: FAILED`); continue;}
    writeFileSync(join(out, `${shot.name}.png`), Buffer.from(String(v.png).split(',')[1], 'base64'));
    console.log(`${shot.name}: ok`);
  }
}
rmSync(join(out, '.expr.js'), {force: true});
