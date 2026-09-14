// Browser checks in real headless Chrome (Interceptor VerifyViewport). Needs `bun run dev` running.
import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdirSync} from 'node:fs';

const verifier = process.env.INTERCEPTOR_VERIFY_SCRIPT ?? join(homedir(), '.claude/skills/Interceptor/Tools/VerifyViewport.ts');
const base = process.env.GAME_TEST_URL ?? 'http://127.0.0.1:5181';

async function run(args: string[]) {
  const p = Bun.spawn(['bun', verifier, ...args], {stdout: 'pipe', stderr: 'inherit'});
  const output = await new Response(p.stdout).text();
  if (await p.exited) {console.log(output); process.exit(1);}
  return output;
}

const probe = await run(['probe', base + '/', '--widths', '1440,600', '--expr', '@tests/sky-probe.js']);
console.log(probe);
const result = JSON.parse(probe.slice(probe.indexOf('{')));
if (!result.results?.length || result.results.some((r: {value?: {passed: boolean}}) => r.value?.passed !== true)) process.exit(1);

// Surface checks: shadow direction from a fixture post, and no holes between terrain rings at several heights.
for (const query of [
  'view=nadir&fixture=post&debug=shadow&ev=1',
  'view=nadir&debug=shadow&ev=1',
  'view=nadir&debug=albedo&ev=1&eye=3',
  'view=nadir&debug=albedo&ev=1&eye=400',
  'view=nadir&debug=albedo&ev=1&eye=6000',
]) {
  const output = await run(['probe', `${base}/?${query}&settle=1&hud=0`, '--widths', '1200', '--expr', '@tests/surface-probe.js']);
  const parsed = JSON.parse(output.slice(output.indexOf('{')));
  console.log(query, JSON.stringify(parsed.results[0].value));
  if (parsed.results[0].value?.passed !== true) process.exit(1);
}

// Navigation, exposure and live launch checks at desktop and compact layouts.
const navigation = await run(['probe', base + '/?view=pad', '--widths', '1440,600', '--expr', '@tests/navigation-probe.js']);
console.log(navigation);
const navigationResult = JSON.parse(navigation.slice(navigation.indexOf('{')));
if (!navigationResult.results?.length || navigationResult.results.some((r: {value?: {passed: boolean}}) => r.value?.passed !== true)) process.exit(1);

const docking = await run(['probe', base + '/?scenario=terminal', '--widths', '1440,600', '--expr', '@tests/docking-probe.js']);
console.log(docking);
const dockingResult = JSON.parse(docking.slice(docking.indexOf('{')));
if (!dockingResult.results?.length || dockingResult.results.some((r: {value?: {passed: boolean}}) => r.value?.passed !== true)) process.exit(1);

// Gameplay: real keyboard/button controls through a crash, then cue-flown docking and a collision.
for (const [file, query] of [['controls-probe.js', 'scenario=window-open&view=pad'], ['outcomes-probe.js', 'scenario=terminal']]) {
  const output = await run(['probe', `${base}/?${query}&settle=1`, '--widths', '1280', '--expr', `@tests/${file}`]);
  const parsed = JSON.parse(output.slice(output.indexOf('{')));
  console.log(file, JSON.stringify(parsed.results[0].value));
  if (parsed.results[0].value?.passed !== true) process.exit(1);
}

// Review screenshots for the human visual gate (PLAN.md §8).
if (process.argv.includes('--shots')) {
  const set = process.argv.includes('--sky') ? 'sky' : 'surface';
  const dir = `.artifacts/${set}`;
  mkdirSync(dir, {recursive: true});
  const shots: [string, string][] = set === 'sky' ? [
    ['01-hover-earth', 'view=hover'],
    ['02-earth-telephoto', 'view=earth'],
    ['03-orbit-shadows', 'view=orbit&az=280&el=-30'],
    ['04-orbit-sunward', 'view=orbit&az=97&el=-35'],
    ['05-limb', 'view=limb'],
    ['06-globe', 'view=globe'],
    ['07-nightside-earthshine', 'view=nightside'],
    ['08-dark-sky-milky-way', 'view=site&az=300&el=40'],
  ] : [
    ['00-pad-kestrel', 'view=pad'],
    ['00-apollo15', 'view=apollo'],
    ['00-lander-up', 'view=lander-up'],
    ['00-argo-orbit', 'view=argo'],
    ['00-ascent-live', 'scenario=ascent'],
    ['00-terminal-docking', 'scenario=terminal'],
    ['00-docking-4m', 'scenario=docking'],
    ['01-site-down-sun', 'view=site'],
    ['02-site-cross-sun', 'view=cross'],
    ['03-feet', 'view=site&az=200&el=-55&fov=60'],
    ['04-rille-rim', 'view=rille'],
    ['05-toward-sun', 'view=site&az=100&el=-6'],
    ['06-earth-over-ground', 'view=site&az=188&el=30&fov=90'],
    ['07-low-300m', 'view=low'],
    ['08-hover-4km', 'view=hover&el=-25&az=262'],
    ['09-orbit-hadley-rille', 'view=orbit&el=-89&fov=22'],
    ['10-nadir-25m', 'view=nadir'],
  ];
  const capture = `async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 120 && document.body.dataset.settled !== '1'; i++) await wait(250);
    return window.moonAscent.capture();
  }`;
  for (const [name, query] of shots) {
    const output = await run(['probe', `${base}/?${query}&settle=1&hud=0`, '--widths', '1440', '--expr', capture]);
    const dataUrl: string = JSON.parse(output.slice(output.indexOf('{'))).results[0].value;
    await Bun.write(`${dir}/${name}.png`, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
    console.log('shot', name);
  }
}
