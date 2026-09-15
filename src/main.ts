import * as T from 'three';
import './style.css';
import {type AttitudeMode, Mission} from './sim/mission';
import {KESTREL, altitudeAboveGround} from './sim/vehicle';
import {MissionHud, rcsKeys} from './render/mission-hud';
import {GameAudio, type Warning} from './render/audio';
import {Effects, makePlume, makeRcsPuff} from './render/effects';
import {Tracks} from './render/tracks';
import {setupTouch} from './render/touch';
import {BUGGY, Buggy, buggyContactLift, NO_DRIVE, type BuggyControls} from './sim/buggy';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {bodyToInertial, circularState, inertialToBody, surfaceVelocity} from './sim/orbit';
import {LabelLayer, type LabelItem} from './render/labels';
import {LunarMap} from './render/map';
import {PLACES, hadleyLandforms} from './sim/atlas';
import {PROBES, type Probe, bearing as greatCircleBearing, surfaceDistance} from './sim/probes';
import {Manual} from './render/manual';
import {R_MOON} from './sim/constants';
import {angularDiameter, apply, bodiesAt, EARTH_RADIUS, earthPhase, moonFixedToEqj, skyAt, topocentric} from './sim/ephemeris';
import {latLonToUnit} from './sim/orbit';
import {type V3, add, cross, len, scale, sub, unit, rotate, dot} from './sim/vec';
import {assetUrl, exposure, loadMap, matrix3, toThree} from './render/common';
import {EarthGlobe} from './render/earth';
import {LunarElevation, MoonGlobe} from './render/moon';
import {MilkyWay, Stars, SunDisc, type StarMode} from './render/sky';
import {Viewer} from './render/viewer';
import {RockField} from './render/rocks';
import {APOLLO15_LM, HADLEY_HARDWARE, SITE_MODELS, hardwareLight, hardwareMaterial, HardwareSet, KESTREL_PAD, offset} from './render/hardware';
import {SunShadows} from './render/shadows';
import {TerrainRings} from './render/terrain';
import {GRID_FILES, HADLEY_SITE, LunarTerrain, type ElevationGrid} from './sim/terrain';

const params = new URLSearchParams(location.search);
export const SCENARIO_EPOCH = '2031-03-02T18:00:00Z';
const HADLEY = HADLEY_SITE;

const app = document.querySelector<HTMLElement>('#app')!;
const viewer = new Viewer(app);
const textures = new T.LoadingManager();
let texturesLoaded = false;
textures.onLoad = () => {texturesLoaded = true;};
const loader = new T.TextureLoader(textures);
const sky = skyAt(new Date(params.get('epoch') ?? SCENARIO_EPOCH));
let simTime = Number(params.get('t') ?? 0);
let warp = 1;
let autopilotOn = false;

const [catalogue, elevation, regionHeights] = await Promise.all([
  fetch(assetUrl('data/stars-bsc5.f32')).then(r => r.arrayBuffer()).then(b => new Float32Array(b)),
  LunarElevation.load(assetUrl(GRID_FILES.globe.url), 2880, 1440),
  fetch(assetUrl(GRID_FILES.hadley.url)).then(r => r.arrayBuffer()).then(b => new Int16Array(b)),
]);
const terrain = new LunarTerrain({
  globe: {...GRID_FILES.globe, heights: elevation.heights} as ElevationGrid,
  region: {...GRID_FILES.hadley, heights: regionHeights} as ElevationGrid,
  anchorLat: HADLEY.lat, anchorLon: HADLEY.lon,
});

const milkyWay = new MilkyWay(loader.load(assetUrl('textures/milkyway-4k.jpg')));
const stars = new Stars(catalogue);
stars.mode = (params.get('stars') as StarMode) ?? 'real';
const sun = new SunDisc();
const moonColour = loadMap(loader, assetUrl('textures/moon-lroc-8k.jpg'));
const moon = new MoonGlobe(moonColour, elevation.texture());
const shadows = new SunShadows();
// Level pads under landed hardware before any terrain geometry or shadow field is built from the surface function.
terrain.addPad(APOLLO15_LM.lat, APOLLO15_LM.lon, 7, 4);
terrain.addPad(KESTREL_PAD.lat, KESTREL_PAD.lon, 7.5, 5);
const rings = new TerrainRings(terrain, moonColour, shadows);
const hardware = new HardwareSet(terrain, shadows);
await hardware.load(params.get('hardware') === '0' ? [] : [...HADLEY_HARDWARE, ...SITE_MODELS]);
for (const m of SITE_MODELS) {const o = hardware.objects.get(m.name); if (o) o.visible = false;}
const mission = new Mission(latLonToUnit(KESTREL_PAD.lat, KESTREL_PAD.lon), terrain, simTime);
if (params.get('scenario') === 'window-open' || params.get('scenario') === 'ascent') {
  mission.waitForWindow();
  if (params.get('scenario') === 'ascent') {mission.launch(); mission.assisted = true; for (let i = 0; i < 1200; i++) mission.advance(1 / 30, 1); mission.assisted = false; mission.throttle = 1;}
  simTime = mission.state.t;
}
if (params.get('scenario') === 'crash') {
  // Launch, cut the engine after a short hop, and fall back onto the pad area.
  mission.waitForWindow(); mission.launch(); mission.attitudeMode = 'stabilize';
  for (let i = 0; i < 120 * 3; i++) mission.advance(1 / 120, 1);
  mission.throttle = 0;
  for (let i = 0; i < 120 * 40 && !mission.result; i++) mission.advance(1 / 120, 1);
  simTime = mission.state.t;
}
if (params.get('scenario') === 'descent') {
  // Powered-descent start: 15 km up, ~1.7 km/s to kill, engine pointing retrograde.
  mission.startDescent();
  simTime = mission.state.t;
}
if (params.get('scenario') === 'collision') {
  mission.placeForDocking(60, 4, 6, 0);
  simTime = mission.state.t;
}
if (params.get('scenario') === 'terminal' || params.get('scenario') === 'docking') {
  mission.placeForDocking(params.get('scenario') === 'docking' ? 4 : 25, 0.1);
  simTime = mission.state.t;
}
const argo = (await new GLTFLoader().loadAsync(assetUrl('models/argo.glb'))).scene;
argo.traverse(o => {
  const mesh = o as T.Mesh;
  if (!mesh.isMesh) return;
  const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const mats = sources.map(m => hardwareMaterial(m as T.MeshStandardMaterial, shadows));
  for (const mat of mats) mat.uniforms.receiveSunShadows.value = 0;
  mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
  mesh.frustumCulled = false;
});
const argoFrame = new T.Group();
argoFrame.matrixAutoUpdate = false;
argoFrame.add(argo);
viewer.scene.add(argoFrame);
const ascentFrame = new T.Group();
ascentFrame.matrixAutoUpdate = false;
viewer.scene.add(ascentFrame);
let separated = false;

const rocks = new RockField(terrain, moonColour, shadows);
// ?fixture=post: a 4 m tall, 0.3 m wide post at the landing site whose shadow the browser probe measures.
const fixturePost = params.get('fixture') === 'post' ? (() => {
  const {lat, lon} = HADLEY;
  const up = latLonToUnit(lat, lon), r = R_MOON + terrain.height(lat, lon) + 2;
  const anchor = latLonToUnit(terrain.anchorLat, terrain.anchorLon);
  const mesh = new T.Mesh(new T.BoxGeometry(0.3, 4, 0.3), new T.MeshBasicMaterial({color: 0x000000}));
  mesh.position.set(up[0] * r - anchor[0] * R_MOON, up[1] * r - anchor[1] * R_MOON, up[2] * r - anchor[2] * R_MOON);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(...up));
  mesh.layers.enable(shadows.layer);
  const holder = new T.Group();
  holder.matrixAutoUpdate = false;
  holder.add(mesh);
  return holder;
})() : null;
const earth = new EarthGlobe(
  loadMap(loader, assetUrl('textures/earth-day-4k.jpg')),
  loadMap(loader, assetUrl('textures/earth-night-4k.jpg')),
  loadMap(loader, assetUrl('textures/earth-clouds-4k.jpg')),
);
// Sky layers ride with the camera (floating origin), bodies are placed each frame.
const skyGroup = new T.Group();
skyGroup.add(milkyWay.mesh, stars.points, sun.mesh);
viewer.scene.add(skyGroup, moon.mesh, earth.group, rings.group, rocks.group, hardware.group);
if (fixturePost) viewer.scene.add(fixturePost);

const ev = params.get('ev');
if (ev) viewer.exposureSettings.mode = Number(ev);

// ---------------------------------------------------------------------------------------------------------------
// Views. Positions are Moon-centred EQJ metres (float64); the camera is re-based to the origin every frame.

type ViewName = 'rover' | 'earth' | 'orbit' | 'site' | 'globe' | 'nightside' | 'limb' | 'hover' | 'cross' | 'rille' | 'low' | 'nadir' | 'pad' | 'apollo' | 'lander-up' | 'chase' | 'cockpit' | 'docking' | 'argo';
interface Rig {
  /** Camera position, EQJ metres from the Moon's centre. */
  position(): V3;
  /** Camera look direction and up. */
  look(): {forward: V3; up: V3};
  fov: number;
}

const siteFixed = latLonToUnit(HADLEY.lat, HADLEY.lon);
const siteRadius = () => R_MOON + terrain.height(HADLEY.lat, HADLEY.lon);
const upAt = (lat: number, lon: number) => () => unit(apply(moonFixedToEqj(sky, simTime), latLonToUnit(lat, lon)));
const siteUp = upAt(HADLEY.lat, HADLEY.lon);
const localFrame = (up: V3) => {
  const north0 = apply(moonFixedToEqj(sky, simTime), [0, 0, 1]);
  const east = unit(cross(north0, up)), north = cross(up, east);
  return {east, north, up};
};
const fromAzEl = (frame: ReturnType<typeof localFrame>, az: number, el: number): V3 => {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  return add(add(scale(frame.north, Math.cos(e) * Math.cos(a)), scale(frame.east, Math.cos(e) * Math.sin(a))), scale(frame.up, Math.sin(e)));
};
const toAzEl = (frame: ReturnType<typeof localFrame>, d: V3) => ({
  az: (Math.atan2(d[0] * frame.east[0] + d[1] * frame.east[1] + d[2] * frame.east[2], d[0] * frame.north[0] + d[1] * frame.north[1] + d[2] * frame.north[2]) * 180) / Math.PI,
  el: (Math.asin(Math.max(-1, Math.min(1, d[0] * frame.up[0] + d[1] * frame.up[1] + d[2] * frame.up[2]))) * 180) / Math.PI,
});

type LookRig = Rig & {az: number; el: number; walk?: (forward: number, right: number, up: number) => void};

/** Look-around rig standing at a point: drag turns the head, wheel zooms the lens. */
function lookRig(position: () => V3, up: () => V3, az: number, el: number, fov: number): LookRig {
  return {
    az, el, fov, position,
    look() {
      const frame = localFrame(up());
      // Camera up is the look direction pitched 90 degrees up, so looking straight down stays well defined.
      return {forward: fromAzEl(frame, this.az, this.el), up: fromAzEl(frame, this.az, this.el + 90)};
    },
  };
}

/** Walkable rig: terrain-local x/y plus height above the ground. WASD moves, R/F climbs, Shift runs. */
function groundRig(lat: number, lon: number, eye: number, az: number, el: number, fov: number): LookRig {
  const start = terrain.toLocal(lat, lon);
  const state = {x: start.x, y: start.y, eye: params.has('eye') ? Number(params.get('eye')) : eye};
  const here = () => terrain.fromLocal(state.x, state.y);
  const rig: LookRig = lookRig(
    () => {const h = here(); return scale(upAt(h.lat, h.lon)(), R_MOON + terrain.height(h.lat, h.lon) + state.eye);},
    () => {const h = here(); return upAt(h.lat, h.lon)();},
    az, el, fov,
  );
  rig.walk = (forward, right, up) => {
    const a = rig.az * Math.PI / 180;
    state.x += Math.sin(a) * forward + Math.cos(a) * right;
    state.y += Math.cos(a) * forward - Math.sin(a) * right;
    state.eye = Math.max(0.4, state.eye + up);
  };
  return rig;
}

function makeRig(name: ViewName): LookRig {
  const sunSite = topocentric(sky, simTime, siteFixed, siteRadius(), bodiesAt(sky, simTime).sun);
  const earthSite = topocentric(sky, simTime, siteFixed, siteRadius(), bodiesAt(sky, simTime).earth);
  switch (name) {
    case 'chase': {
      // Orbit camera around KESTREL: drag changes azimuth/elevation in the local horizon frame, wheel changes range.
      const craft = () => add(apply(sky.mciToEqj, mission.state.r), scale(unit(apply(sky.mciToEqj, mission.state.r)), 3));
      const up = () => unit(craft());
      const base = lookRig(() => craft(), up, 0, -14, 55);
      const along = unit(apply(sky.mciToEqj, cross(mission.orbit.normal, unit(mission.state.r))));
      base.az = toAzEl(localFrame(up()), along).az;
      const rig: LookRig = {...base, fov: 55,
        position() {const f = localFrame(up()); return sub(craft(), scale(fromAzEl(f, rig.az, rig.el), chaseDistance));},
        look() {const f = localFrame(up()); return {forward: fromAzEl(f, rig.az, rig.el), up: fromAzEl(f, rig.az, rig.el + 90)};},
      };
      return rig;
    }
    case 'cockpit': {
      const body = (v: V3) => apply(sky.mciToEqj, rotate(mission.state.q, v));
      return {az: 90, el: 0, fov: 70,
        position: () => add(apply(sky.mciToEqj, mission.state.r), body([0, 4.6, 1.85])),
        look: () => ({forward: body([0, 0, 1]), up: body([0, 1, 0])})};
    }
    case 'docking': {
      const body = (v: V3) => apply(sky.mciToEqj, rotate(mission.state.q, v));
      return {az: 90, el: 0, fov: 42,
        position: () => add(apply(sky.mciToEqj, mission.state.r), body([0, 3.32, 2.2])),
        look: () => ({forward: body([0, 0, 1]), up: body([0, 1, 0])})};
    }
    case 'rover': {
      // Chase the buggy from behind and above, turning with it and following it into the air. Body-fixed lat/lon has
      // to be rotated into the inertial frame for the current time, or the camera slides off as the Moon turns under it.
      const at = (lat: number, lon: number, height: number) =>
        apply(sky.mciToEqj, bodyToInertial(scale(latLonToUnit(lat, lon), R_MOON + height), simTime));
      const target = () => at(buggy.lat, buggy.lon, terrain.height(buggy.lat, buggy.lon) + buggy.altitude + 1.5);
      const up = () => unit(at(buggy.lat, buggy.lon, 0));
      const rig = lookRig(target, up, 0, -12, 60);
      rig.position = () => {
        // Pull back and lift a little as speed rises, for a sense of rush.
        const back = 9 + Math.min(24, Math.abs(buggy.speed) * 0.32);
        const behind = buggy.offset(-back);
        const lift = 3.4 + Math.min(3, Math.abs(buggy.speed) * 0.03);
        // Airborne: frame it against its own smooth chassis height — sampling terrain under a fast, high buggy makes
        // the height jump frame to frame and shakes the whole view. On the ground, keep clear of a rise behind it.
        const height = buggy.airborne
          ? buggy.chassisHeight(terrain) + lift
          : Math.max(terrain.height(behind.lat, behind.lon), terrain.height(buggy.lat, buggy.lon)) + buggy.altitude + lift;
        return at(behind.lat, behind.lon, height);
      };
      rig.look = () => ({forward: sub(target(), rig.position()), up: up()});
      return rig;
    }
    case 'argo': {
      // Free orbit around ARGO: drag to circle it, wheel to zoom, so you can inspect the mothership from any angle.
      const craft = () => apply(sky.mciToEqj, mission.argo.r);
      const up = () => unit(craft());
      const base = lookRig(() => craft(), up, 90, -18, 55);
      const along = unit(apply(sky.mciToEqj, mission.argo.v));
      base.az = toAzEl(localFrame(up()), along).az + 20;
      const rig: LookRig = {...base, fov: 55,
        position() {const f = localFrame(up()); return sub(craft(), scale(fromAzEl(f, rig.az, rig.el), argoCamDistance));},
        look() {const f = localFrame(up()); return {forward: fromAzEl(f, rig.az, rig.el), up: fromAzEl(f, rig.az, rig.el + 90)};},
      };
      return rig;
    }
    // Stable telephoto fixture centred on Earth for ephemeris and exposure regression checks.
    case 'earth': return groundRig(HADLEY.lat, HADLEY.lon, 4000, earthSite.azimuth, earthSite.elevation, 6);
    // Standing at the landing site, eye height, looking west down-sun toward Hadley Rille: long shadows run away.
    case 'site': return groundRig(HADLEY.lat, HADLEY.lon, 1.7, 262, -4, 70);
    // Beside KESTREL on its pad, sun behind the camera's left shoulder.
    case 'pad': {const at = offset(KESTREL_PAD, 16, -14); return groundRig(at.lat, at.lon, 1.7, 311, 3, 55);}
    // Looking up at the lander from under the porch, Earth overhead in the south.
    case 'lander-up': {const at = offset(KESTREL_PAD, 5, 7); return groundRig(at.lat, at.lon, 1.2, 210, 32, 75);}
    // Apollo 15: descent stage, bleached flag, and the rover parked 90 m east.
    case 'apollo': {const at = offset(APOLLO15_LM, 22, -20); return groundRig(at.lat, at.lon, 1.7, 322, -2, 55);}
    // Cross-sun: shadows fall sideways, the best view of relief.
    case 'cross': return groundRig(HADLEY.lat, HADLEY.lon, 1.7, 185, -8, 60);
    // On Hadley Rille's east rim, 1.7 km west of the site, looking across ~1.5 km to the far wall (300 m deep).
    case 'rille': return groundRig(26.13, 3.574, 1.7, 268, -9, 60);
    case 'hover': return groundRig(HADLEY.lat, HADLEY.lon, 4000, earthSite.azimuth, 36, 80);
    // Straight down from 25 m, north up, east right: for the shadow-direction check.
    case 'nadir': return groundRig(HADLEY.lat, HADLEY.lon, 25, 0, -89.99, 50);
    case 'low': return groundRig(HADLEY.lat, HADLEY.lon, 300, 262, -20, 70);
    case 'orbit': {
      // 100 km above Hadley, looking away from the Sun so the low light rakes the Apennine mountains.
      const above = () => scale(siteUp(), R_MOON + 100_000);
      return lookRig(above, siteUp, sunSite.azimuth + 180, -18, 60);
    }
    case 'limb': {
      const above = () => scale(siteUp(), R_MOON + 60_000);
      return lookRig(above, siteUp, earthSite.azimuth, -2, 50);
    }
    case 'nightside': {
      const antiSun = () => scale(unit(scale(bodiesAt(sky, simTime).sun, -1)), R_MOON + 9_000_000);
      return lookRig(antiSun, () => unit(antiSun()), 0, -89.9, 28);
    }
    case 'globe':
    default: {
      // Between the Moon and the Sun-Earth side: a gibbous Moon with Earth in the background.
      const pos = () => {
        const b = bodiesAt(sky, simTime);
        return scale(unit(add(unit(b.sun), scale(unit(b.earth), -1.3))), 7_500_000);
      };
      return lookRig(pos, () => unit(pos()), 0, -89.9, 34);
    }
  }
}

// The crew's fast buggy: starts parked beside KESTREL and drives on the same terrain function the lander flies against.
const buggyStart = HADLEY_HARDWARE.find(p => p.name === 'buggy')!;
const buggy = new Buggy(buggyStart.lat, buggyStart.lon, buggyStart.heading);
if (params.get('buggy') === 'rollover') Object.assign(buggy, {flipped: true, roll: Math.PI / 2, speed: 0});
if (params.get('buggy') === 'flight') Object.assign(buggy, {airborne: true, altitude: 120, vVert: 12, speed: 18, roll: 0.18});
let wheelSpin = 0, sprayAt = 0, rockImpactAt = -Infinity;
const driveTrail: {lat: number; lon: number}[] = []; // breadcrumb of where the buggy has driven, for the zoomed map
let geoLatLon = {lat: 26.13, lon: 3.63}; // the camera's current sub-point, updated each frame for target bearings
let driving = params.get('scenario') === 'rover' || params.get('scenario') === 'drive';
let chaseDistance = 30;
let argoCamDistance = 80;
let viewName = (params.get('view') as ViewName) ?? 'pad';
if (params.get('scenario') === 'ascent' || params.get('scenario') === 'descent') viewName = 'chase';
if (params.get('scenario') === 'rover' || params.get('scenario') === 'drive') viewName = 'rover';
if (params.get('scenario') === 'terminal' || params.get('scenario') === 'docking') viewName = 'docking';
if (params.get('scenario') === 'crash' || params.get('scenario') === 'collision') viewName = 'chase';
let rig = makeRig(viewName);
// Deep-link overrides for screenshots and tests: ?az=&el=&fov=
for (const key of ['az', 'el', 'fov'] as const) if (params.has(key)) rig[key] = Number(params.get(key));

// Navigation shares the same body-fixed positions as the hardware and terrain.
const equipment: Record<string, [string, string, number]> = {
  'kestrel': ['KESTREL Mk II', 'Crew ascent / descent vehicle · fictional UN expedition', 7.1],
  'apollo15-lm': ['Apollo 15 · Falcon', 'Historic descent stage · crew departed in 1971', 3.6],
  'apollo15-flag': ['Apollo 15 flag', 'Sun-bleached US flag', 3.2],
  'apollo15-lrv': ['Lunar Roving Vehicle', 'Apollo 15 electric rover · parked after the last EVA', 2.7],
  'apollo15-alsep': ['ALSEP science station', 'Apollo Lunar Surface Experiments Package', 2.3],
  'un-flag': ['United States flag', 'Crew expedition marker', 3.2],
  'buggy': ['Crew buggy', 'Fast pressurised rover · drive it with the Drive button', 3.0],
};

// Cache the buggy's wheel nodes once loaded so they can be spun and steered each frame.
const buggyWheels: {node: T.Object3D; front: boolean; side: number; axle: number; restZ: number}[] = [];
const buggyLiftFx: T.Object3D[] = [];
const buggyAttitudeFx: T.Object3D[] = [];
const buggyRearGlows: T.Object3D[] = [];
{
  const holder = hardware.objects.get('buggy');
  if (holder) for (const tag of ['fl', 'fr', 'rl', 'rr']) {
    const node = holder.getObjectByName(`wheel_${tag}`);
    if (node) buggyWheels.push({node, front: tag[0] === 'f', side: tag[1] === 'r' ? 1 : -1,
      axle: tag[0] === 'f' ? 1 : -1, restZ: node.position.z});
  }
  holder?.traverse(node => {
    if (node.name.startsWith('flight_glow_') || node.name.startsWith('flight_plume_')) buggyLiftFx.push(node);
    if (node.name.startsWith('righting_glow_') || node.name.startsWith('righting_plume_')) buggyAttitudeFx.push(node);
    if (node.name.startsWith('turbo_glow_')) buggyRearGlows.push(node);
  });
}

/** Stand the buggy model on the slope (nose-up in the air), lift it while jumping, and spin and steer its wheels. */
function placeBuggy() {
  const holder = hardware.objects.get('buggy');
  if (!holder) return;
  const h = (lat: number, lon: number) => terrain.height(lat, lon);
  const wb = BUGGY.wheelbase, tr = 2.3;
  const f = buggy.offset(wb / 2), b = buggy.offset(-wb / 2);
  const rgt = buggy.offset(tr / 2, buggy.heading + Math.PI / 2), lft = buggy.offset(-tr / 2, buggy.heading + Math.PI / 2);
  let pitch = Math.atan2(h(f.lat, f.lon) - h(b.lat, b.lon), wb);
  // Once all four tyres leave the ground, the terrain passing below cannot rotate the body.
  const terrainRoll = buggy.airborne ? 0 : Math.atan2(h(rgt.lat, rgt.lon) - h(lft.lat, lft.lon), tr);
  let roll = terrainRoll + buggy.roll;
  if (buggy.airborne) pitch = 0.5 * Math.atan2(buggy.vVert, Math.max(4, Math.abs(buggy.speed)));
  // Keep the full hull above the highest terrain within its footprint. This measured GLB envelope plus eight nearby
  // samples prevents a side-resting buggy from being submerged by either its roll or a crater-rim height step.
  const centreH = h(buggy.lat, buggy.lon);
  let terrainRise = 0;
  if (!buggy.airborne) for (const fore of [-BUGGY.hullHalfLength, 0, BUGGY.hullHalfLength]) {
    for (const across of [-BUGGY.hullHalfWidth, 0, BUGGY.hullHalfWidth]) {
      if (fore === 0 && across === 0) continue;
      const sample = buggy.offset(Math.hypot(fore, across), buggy.heading + Math.atan2(across, fore));
      terrainRise = Math.max(terrainRise, h(sample.lat, sample.lon) - centreH);
    }
  }
  // Normal driving (roll ~0) needs no hull lift — the wheels handle contact, so it never floats on a slope. Once a
  // real rollover is underway, lift by the FULL rendered roll (terrain tilt included) plus a margin, so no part of a
  // capsized buggy can sink through sloped or cratered ground.
  const rolledOver = buggy.flipped || Math.abs(buggy.roll) > 0.3;
  const contactLift = buggy.airborne ? 0 : buggyContactLift(rolledOver ? Math.abs(roll) : Math.abs(buggy.roll), terrainRise) + (rolledOver ? 0.12 : 0);
  holder.matrix.copy(hardware.placementMatrix({
    name: 'buggy', url: '', lat: buggy.lat, lon: buggy.lon, heading: buggy.heading * 180 / Math.PI,
    lift: buggy.altitude + contactLift, pitch, roll,
  }));
  holder.updateMatrixWorld(true);
  // Wheels roll at speed and the fronts steer; airborne, they keep spinning but don't steer.
  const steer = buggy.airborne ? 0 : (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0);
  for (const w of buggyWheels) {
    w.node.rotation.x = wheelSpin;
    w.node.rotation.y = w.front ? -steer * 0.5 : 0;
    if (buggy.airborne) w.node.position.z += (w.restZ - 0.12 - w.node.position.z) * 0.15;
    else {
      const fore = w.axle * wb / 2, across = w.side * tr / 2;
      const sample = buggy.offset(Math.hypot(fore, across), buggy.heading + Math.atan2(across, fore));
      const plane = h(buggy.lat, buggy.lon) + fore * Math.tan(pitch) + across * Math.tan(terrainRoll);
      const travel = Math.max(-0.18, Math.min(0.18, h(sample.lat, sample.lon) - plane));
      w.node.position.z += (w.restZ + travel - w.node.position.z) * 0.35;
    }
  }
  const fixtureThrust = params.get('thrust') === '1';
  const liftFiring = fixtureThrust || buggy.airborne && (held.has('r') || held.has('f'));
  const attitudeFiring = fixtureThrust || buggy.flipped && held.has('r')
    || buggy.airborne && (held.has('a') || held.has('d'));
  const forwardFiring = fixtureThrust || buggy.airborne && (held.has('w') || held.has('s'));
  for (const glow of buggyLiftFx) {
    glow.visible = liftFiring;
    glow.scale.setScalar(0.85 + 0.3 * Math.sin(fxClock * 48));
  }
  for (const glow of buggyAttitudeFx) {
    glow.visible = attitudeFiring;
    glow.scale.setScalar(0.78 + 0.25 * Math.sin(fxClock * 55));
  }
  for (const glow of buggyRearGlows) {
    const pulse = forwardFiring ? 1.45 + 0.3 * Math.sin(fxClock * 52) : 1;
    glow.scale.setScalar(pulse);
  }
}

// Things the buggy can crash into (everything placed at Hadley except itself).
const BUGGY_OBSTACLES = HADLEY_HARDWARE.filter(p => p.name !== 'buggy');
const DEG = Math.PI / 180;

/** The buggy's world position in the inertial frame, at a given metres-behind offset (0 = under the buggy). */
function buggyGroundPoint(behind = 0): V3 {
  const p = buggy.offset(-behind);
  return bodyToInertial(scale(latLonToUnit(p.lat, p.lon), R_MOON + terrain.height(p.lat, p.lon)), simTime);
}

/** Tyre tracks, dust off the wheels, a burst and thump on a hard landing, and collisions with the hardware. */
function driveEffects(dt: number) {
  const moving = Math.abs(buggy.speed) + Math.abs(buggy.slip);
  // Tyre tracks: lay them while the wheels are down and rolling; break the trail in the air; skid marks under braking.
  if (buggy.airborne || moving < 0.4) tracks.pause();
  else {
    const braking = held.has('s') && Math.abs(buggy.speed) > 1;
    tracks.drop(buggy.lat, buggy.lon, buggy.heading, braking ? 1 : Math.min(1, Math.abs(buggy.slip) / 5));
  }
  if (!buggy.airborne && moving > 2 && fxClock - sprayAt > 0.09) {
    sprayAt = fxClock;
    const spot = buggyGroundPoint(1.2);
    effects.wheelSpray(spot, surfaceVelocity(spot), fxClock, groundAt);
  }
  if (buggy.landingImpact > 0) {
    const here = buggyGroundPoint(0);
    effects.dust(here, surfaceVelocity(here), fxClock, 700, [4, 45], groundAt, 3);
    audio.thump(Math.min(1, buggy.landingImpact / 14));
  }
  if (buggy.airborne || Math.abs(buggy.speed) < 1) return;
  // The same deterministic boulders the player sees are physical obstacles. Small strikes kick the suspension and
  // scrub speed; large, off-centre hits can start a real rollover through the buggy's angular dynamics.
  const rock = rocks.collidersNear(buggy.lat, buggy.lon, 1.15).sort((a, b) => b.diameter - a.diameter)[0];
  if (rock && fxClock - rockImpactAt > 0.35) {
    rockImpactAt = fxClock;
    const p = terrain.toLocal(buggy.lat, buggy.lon);
    const rightX = Math.cos(buggy.heading), rightY = -Math.sin(buggy.heading);
    const side = Math.sign((rock.x - p.x) * rightX + (rock.y - p.y) * rightY || 1);
    const severity = Math.min(0.8, 0.08 + rock.diameter * 0.2 + Math.abs(buggy.speed) / 500);
    buggy.jolt(severity, -side * severity * Math.min(5, Math.abs(buggy.speed) / 12));
    const back = buggy.offset(-Math.sign(buggy.speed || 1) * (0.3 + rock.diameter * 0.35));
    buggy.lat = back.lat; buggy.lon = back.lon;
    const here = buggyGroundPoint(0);
    effects.dust(here, surfaceVelocity(here), fxClock, 280, [2, 24], groundAt, 2);
    audio.thump(Math.min(1, severity));
  }
  // Collisions: shove the buggy back out of anything it drives into, scrub its speed, kick dust and thump.
  const mPerDeg = R_MOON * DEG;
  for (const o of BUGGY_OBSTACLES) {
    const dN = (buggy.lat - o.lat) * mPerDeg, dE = (buggy.lon - o.lon) * mPerDeg * Math.cos(buggy.lat * DEG);
    const d = Math.hypot(dN, dE), radius = 2.2 + (equipment[o.name]?.[2] ?? 2) * 0.25;
    if (d < radius) {
      const back = buggy.offset(-Math.sign(buggy.speed || 1) * (radius - d + 0.3));
      buggy.lat = back.lat; buggy.lon = back.lon;
      const impact = Math.abs(buggy.speed);
      buggy.speed *= -0.25; buggy.slip = 0;
      const here = buggyGroundPoint(0);
      effects.dust(here, surfaceVelocity(here), fxClock, 400, [3, 30], groundAt, 2.5);
      audio.thump(Math.min(1, impact / 14));
      break;
    }
  }
}

// Drive HUD: a speedometer, turbo reserve bar and drive/reverse/airborne state, shown only while driving.
const driveHud = document.createElement('div');
driveHud.className = 'drive-hud';
driveHud.hidden = true;
driveHud.innerHTML = `<div class="dh-state">DRIVE</div>
  <div class="dh-gauge dh-ground"><small>GROUND</small><div><b>0</b><span>km/h</span></div></div>
  <div class="dh-gauge dh-air"><small>AIR SPEED</small><div><b>0</b><span>km/h</span></div></div>
  <div class="dh-gauge dh-alt"><small>ALT AGL</small><div><b>0</b><span>m</span></div><em>0.0 m/s</em></div>
  <div class="dh-turbo"><i></i><span>TURBO · hold Shift</span></div>
  <div class="dh-help"><strong>DRIVE</strong> W/S motor & brake · A/D steer · Shift turbo</div>`;
app.appendChild(driveHud);
const dhState = driveHud.querySelector<HTMLElement>('.dh-state')!;
const dhSpeed = driveHud.querySelector('.dh-ground b')!;
const dhAirSpeed = driveHud.querySelector('.dh-air b')!;
const dhAltitude = driveHud.querySelector('.dh-alt b')!;
const dhVertical = driveHud.querySelector('.dh-alt em')!;
const dhTurbo = driveHud.querySelector<HTMLElement>('.dh-turbo i')!;
const dhTurboText = driveHud.querySelector<HTMLElement>('.dh-turbo span')!;
const dhHelp = driveHud.querySelector<HTMLElement>('.dh-help')!;
function updateDriveHud() {
  driveHud.hidden = !driving;
  if (!driving) return;
  dhSpeed.textContent = (Math.abs(buggy.speed) * 3.6).toFixed(0);
  const flightSpeed = Math.hypot(buggy.speed, buggy.slip, buggy.vVert);
  dhAirSpeed.textContent = (flightSpeed * 3.6).toFixed(0);
  dhAltitude.textContent = buggy.altitude < 100 ? buggy.altitude.toFixed(1) : buggy.altitude.toFixed(0);
  dhVertical.textContent = `${buggy.vVert >= 0 ? '+' : ''}${buggy.vVert.toFixed(1)} m/s`;
  dhTurbo.style.width = `${Math.round(buggy.turbo * 100)}%`;
  const state = buggy.flipped ? 'ROLLOVER' : buggy.flightThrusting || params.get('thrust') === '1' ? 'POWERED FLIGHT' : buggy.airborne ? 'AIRBORNE' : Math.abs(buggy.speed) < 0.2 ? 'PARKED' : buggy.speed < -0.1 ? 'REVERSE' : 'DRIVE';
  dhState.textContent = state;
  dhState.classList.toggle('air', buggy.airborne || buggy.flipped);
  driveHud.classList.toggle('flight', buggy.airborne);
  driveHud.classList.toggle('rollover', buggy.flipped);
  dhTurboText.textContent = buggy.airborne || buggy.flipped ? 'FLIGHT PROP' : 'TURBO · hold Shift';
  dhHelp.innerHTML = buggy.flipped ? '<strong>RECOVERY</strong> Hold R · fire side jets to roll upright'
    : buggy.airborne ? '<strong>VACUUM FLIGHT</strong> W/S forward/retro · A/D turn + bank · R climb · F descend · Shift boost'
      : '<strong>DRIVE</strong> W/S motor & brake · A/D steer · Shift turbo · <span class="dim">R/F fly only once airborne</span>';
}
const labelRay = new T.Raycaster();
const hardwareOccluded = (name: string, target: V3) => {
  const relative = toThree(sub(target, cameraEqj));
  labelRay.set(new T.Vector3(), relative.clone().normalize());
  labelRay.far = Math.max(0, relative.length() - 0.2);
  return labelRay.intersectObjects([...hardware.objects.entries()].filter(([id]) => id !== name).map(([, object]) => object), true).length > 0;
};
const surfacePosition = (lat: number, lon: number, height = 0): V3 =>
  scale(upAt(lat, lon)(), R_MOON + terrain.height(lat, lon) + height);
const landforms = hadleyLandforms((lat, lon) => terrain.surveyed(lat, lon));
const labelItems: LabelItem[] = HADLEY_HARDWARE.map(p => ({
  id: p.name, text: equipment[p.name][0], note: equipment[p.name][1], icon: '◇', kind: 'hardware', rank: 10,
  hideDistance: p.name === 'kestrel',
  occluded: () => hardwareOccluded(p.name, surfacePosition(p.lat, p.lon, equipment[p.name][2])),
  range: 800, position: () => p.name === 'kestrel' && mission.launched ? add(apply(sky.mciToEqj, mission.state.r), scale(unit(apply(sky.mciToEqj, mission.state.r)), 7)) : surfacePosition(p.lat, p.lon, equipment[p.name][2]),
}));
for (const [i, p] of [...PLACES.filter(p => p.id !== 'apollo15'), ...landforms].entries()) {
  labelItems.push({id: `place-${i}`, text: p.name, note: p.note, icon: '·', kind: p.kind, rank: p.rank,
    range: p.kind === 'rille' || p.kind === 'mountain' ? 80_000 : 300_000,
    position: () => surfacePosition(p.lat, p.lon, 15)});
}
labelItems.push({id: 'argo', text: 'ARGO · orbital mothership', note: 'Crew return vehicle · 100 km circular orbit', icon: '◇', kind: 'hardware', rank: 12,
  range: 5_000_000, occluded: () => viewName === 'docking', position: () => apply(sky.mciToEqj, mission.argo.r)});
const labels = new LabelLayer(app, labelItems);
const probeKindMap: Record<string, string> = {crewed: 'apollo', rover: 'rover', lander: 'lander', impact: 'other', crash: 'other'};
const markers = [
  ...HADLEY_HARDWARE.map(p => ({id: p.name, name: equipment[p.name][0], lat: p.lat, lon: p.lon, kind: p.name === 'kestrel' ? 'base' : 'hardware'})),
  ...PLACES.map(p => ({...p})),
  ...landforms.map((p, i) => ({...p, id: `landform-${i}`})),
  ...PROBES.map(p => ({id: `probe-${p.id}`, name: p.name, lat: p.lat, lon: p.lon, kind: probeKindMap[p.kind]})),
];
const argoMarker = {id: 'argo', name: 'ARGO / orbit', lat: 0, lon: 0, kind: 'base'};
markers.push(argoMarker);
const lunarMap = new LunarMap(app, terrain, markers, assetUrl('textures/moon-lroc-8k.jpg'));
const controls = document.createElement('nav');
controls.className = 'nav-controls';
controls.setAttribute('aria-label', 'Surface navigation');
controls.innerHTML = `<strong>LAST WINDOW <small>HADLEY EXPEDITION / 2031</small></strong>
  <div><select aria-label="Camera view" id="camera-view" title="Switch camera view: cockpit, chase, docking sight, ARGO orbit, rover chase and fixed scenic angles">${['pad','chase','cockpit','docking','argo','rover','apollo','site','rille','lander-up','hover','orbit','globe'].map(v => `<option value="${v}">${v.toUpperCase()}</option>`).join('')}</select>
  <button id="label-mode" title="Cycle on-screen labels: smart (declutters by range) → all → off [L]">Labels: smart [L]</button><button id="map-mode" title="Cycle the map: local hillshade → whole Moon → off [M]">Map: local [M]</button><button id="sound" title="Toggle music and sound effects [P]">Sound: off [P]</button><button id="autopilot" title="Fly the current mission automatically: fast-forwards to the launch window, then flies ascent, rendezvous and docking [Y]">Autopilot: off [Y]</button><button id="mode-ascent" title="Ascent mission: launch from the pad and fly up to a 100 km orbit to dock with ARGO">Ascent ↑</button><button id="mode-descent" title="Descent mission: start in orbit and fly a powered descent to a soft landing">Descent ↓</button><button id="drive" title="Take control of the surface buggy: W accelerate, S brake/reverse, A/D steer, Shift turbo; airborne it becomes a rocket flyer">Drive buggy</button>
  <span class="warp-control" title="Time acceleration for coasting and waits: 1× real time up to 1000×. Keys [ and ] also work. Forced to 1× while flying an engine burn or driving."><button id="warp-dn" aria-label="Slower">−</button><b id="warp-val">1×</b><button id="warp-up" aria-label="Faster">+</button></span></div>
  <div class="nav-row"><select aria-label="Inspect equipment" id="inspect-equipment" title="Jump the camera to a piece of hardware on the surface"><option value="">Inspect equipment…</option>${HADLEY_HARDWARE.map(p => `<option value="${p.name}">${equipment[p.name][0]}</option>`).join('')}</select>
  <select aria-label="Drive-to target" id="target" title="Pick a real lunar mission anywhere on the Moon as a navigation target: the map and an on-screen arrow point to it with the distance left"><option value="">Set target…</option>${PROBES.map(p => `<option value="${p.id}">${p.name} · ${p.agency} ${p.year}</option>`).join('')}</select></div>`;
app.appendChild(controls);
const cameraSelect = controls.querySelector<HTMLSelectElement>('#camera-view')!;
cameraSelect.value = viewName;
const autopilotBtn = controls.querySelector<HTMLButtonElement>('#autopilot')!;
function toggleAutopilot(on = !autopilotOn) {
  autopilotOn = on;
  autopilotBtn.classList.toggle('view-active', on);
  if (on && (viewName === 'pad' || viewName === 'site' || viewName === 'apollo')) {viewName = 'chase'; rig = makeRig(viewName); cameraSelect.value = viewName;}
}
autopilotBtn.onclick = () => toggleAutopilot();
// Switch between the two missions: fly up from the pad to ARGO, or down from orbit to a landing.
const ascentBtn = controls.querySelector<HTMLButtonElement>('#mode-ascent')!;
const descentBtn = controls.querySelector<HTMLButtonElement>('#mode-descent')!;
ascentBtn.classList.toggle('view-active', mission.mode !== 'descent');
descentBtn.classList.toggle('view-active', mission.mode === 'descent');
ascentBtn.onclick = () => {if (mission.mode !== 'descent') return; location.href = location.pathname + '?view=pad&scenario=window-open';};
descentBtn.onclick = () => {if (mission.mode === 'descent') return; location.href = location.pathname + '?scenario=descent';};
const warpVal = controls.querySelector<HTMLElement>('#warp-val')!;
controls.querySelector<HTMLButtonElement>('#warp-dn')!.onclick = () => {warp = Math.max(1, warp / 10);};
controls.querySelector<HTMLButtonElement>('#warp-up')!.onclick = () => {warp = Math.min(1000, warp * 10);};
const driveBtn = controls.querySelector<HTMLButtonElement>('#drive')!;
function setDriving(on: boolean) {
  driving = on;
  driveBtn.classList.toggle('view-active', on);
  driveBtn.textContent = on ? 'Driving buggy' : 'Drive buggy';
  // The lander flight computer is irrelevant while driving; hide it so the surface and drive HUD are clear.
  if (params.get('hud') !== '0') flightHud.panel.hidden = on;
  if (on) {viewName = 'rover'; rig = makeRig(viewName); cameraSelect.value = viewName;}
}
driveBtn.onclick = () => setDriving(!driving);
cameraSelect.onchange = () => {viewName = cameraSelect.value as ViewName; rig = makeRig(viewName);};

// Drive-to target: pick any real mission on the Moon; the map and an on-screen arrow point to it with distance left.
let target: Probe | null = null;
const targetSelect = controls.querySelector<HTMLSelectElement>('#target')!;
const targetHud = document.createElement('div');
targetHud.className = 'target-hud';
targetHud.hidden = true;
targetHud.innerHTML = '<div class="th-arrow">➤</div><div class="th-text"><b></b><span></span></div><button class="th-go" title="Travel there: fast-forward the journey and stand the buggy beside the site to inspect it">GO ▸</button><button class="th-clear" title="Clear target">✕</button>';
app.appendChild(targetHud);
const thArrow = targetHud.querySelector<HTMLElement>('.th-arrow')!;
const thName = targetHud.querySelector<HTMLElement>('.th-text b')!;
const thDist = targetHud.querySelector<HTMLElement>('.th-text span')!;
function setTarget(p: Probe | null) {
  target = p;
  targetSelect.value = p ? p.id : '';
  lunarMap.target = p ? {lat: p.lat, lon: p.lon, name: p.name} : null;
  targetHud.hidden = !p;
}
targetSelect.onchange = () => setTarget(PROBES.find(p => p.id === targetSelect.value) ?? null);
// Flight manual: a button in the top bar and the ? key open the full science/controls reference.
const manual = new Manual(app);
controls.querySelector('div')!.appendChild(manual.button);
targetHud.querySelector<HTMLButtonElement>('.th-clear')!.onclick = () => setTarget(null);
targetHud.querySelector<HTMLButtonElement>('.th-go')!.onclick = () => {if (target) travelTo(target);};

/** Re-anchor the whole terrain/clipmap/hardware system to a new sub-point so the surface renders anywhere on the Moon. */
function reanchorTo(lat: number, lon: number) {
  terrain.reanchor(lat, lon);
  rings.reanchor();
  hardware.reanchor();
  rocks.reanchor();
  trackAnchor = scale(latLonToUnit(lat, lon), R_MOON);
  tracks.clear();
  driveTrail.length = 0;
}

/** Travel to a world mission: re-anchor there, stand its stand-in model on the real terrain, and drop the buggy beside
 * it to drive up and inspect. The arrow already showed the real distance; the trip itself is treated as elapsed. */
/** A sim time at which the Sun rakes the given site at a photogenic elevation, so a visited probe is lit, not in night. */
function sunUpTime(lat: number, lon: number, from: number) {
  const upBody = latLonToUnit(lat, lon), DAY = 86_400;
  let best = from, bestEl = -Infinity;
  for (let k = 0; k <= 30; k++) {
    const t = from + k * DAY, sun = bodiesAt(sky, t).sun;
    const el = Math.asin(Math.max(-1, Math.min(1, dot(unit(apply(moonFixedToEqj(sky, t), upBody)), unit(sun))))) * 180 / Math.PI;
    if (el > 20 && el < 55) return t;
    if (el > bestEl) {bestEl = el; best = t;}
  }
  return best;
}

function travelTo(p: Probe) {
  // Jump to a local morning so the site is sunlit rather than in lunar night.
  const t = sunUpTime(p.lat, p.lon, simTime);
  mission.state.t = t; simTime = t;
  reanchorTo(p.lat, p.lon);
  const pick = p.kind === 'crewed' ? 'site-apollo' : p.kind === 'rover' ? 'site-rover' : 'site-lander';
  for (const name of ['site-lander', 'site-rover', 'site-apollo']) {
    const o = hardware.objects.get(name);
    if (!o) continue;
    o.visible = name === pick;
    if (name === pick) {o.matrix.copy(hardware.placementMatrix({name, url: '', lat: p.lat, lon: p.lon, heading: 40})); o.updateMatrixWorld(true);}
  }
  Object.assign(buggy, {lat: p.lat - 18 / (R_MOON * DEG), lon: p.lon, heading: 0, speed: 0, slip: 0, altitude: 0, vVert: 0, roll: 0, rollRate: 0, flipped: false, airborne: false});
  if (!driving) setDriving(true);
  viewName = 'rover'; rig = makeRig(viewName); cameraSelect.value = viewName;
}
function updateTargetHud() {
  if (!target) {targetHud.hidden = true; return;}
  targetHud.hidden = false;
  const from = driving ? {lat: buggy.lat, lon: buggy.lon, heading: buggy.heading} : {lat: geoLatLon.lat, lon: geoLatLon.lon, heading: rig.az * Math.PI / 180};
  const dist = surfaceDistance(from.lat, from.lon, target.lat, target.lon);
  const rel = greatCircleBearing(from.lat, from.lon, target.lat, target.lon) - from.heading;
  thArrow.style.transform = `rotate(${rel}rad)`;
  thName.textContent = `▸ ${target.name}`;
  thDist.textContent = dist < 1000 ? `${dist.toFixed(0)} m · ${target.agency} ${target.year}` : `${(dist / 1000).toFixed(dist < 100_000 ? 1 : 0)} km left · ${target.agency} ${target.year}`;
}
const changeLabels = () => {labels.mode = labels.mode === 'smart' ? 'all' : labels.mode === 'all' ? 'off' : 'smart';};
controls.querySelector<HTMLButtonElement>('#label-mode')!.onclick = changeLabels;
controls.querySelector<HTMLButtonElement>('#map-mode')!.onclick = () => lunarMap.cycle();
lunarMap.onSelect = p => {
  if (p.id === 'argo') {viewName = 'argo'; rig = makeRig(viewName); cameraSelect.value = viewName; return;}
  const actual = HADLEY_HARDWARE.find(h => h.name === p.id);
  if (p.id === 'kestrel' && mission.launched) {viewName = 'chase'; rig = makeRig(viewName); cameraSelect.value = viewName; return;}
  if (actual) {
    const d = actual.name === 'kestrel' ? 16 : actual.name === 'apollo15-lm' ? 13 : 6;
    const at = offset(actual, d, -d);
    rig = groundRig(at.lat, at.lon, 1.7, 315, actual.name === 'kestrel' ? 6 : 0, 55);
  } else {
    rig = groundRig(p.lat, p.lon, 5000, 0, -70, 65);
  }
  viewName = actual?.name === 'kestrel' ? 'pad' : actual ? 'apollo' : 'hover';
  cameraSelect.value = viewName;
};
controls.querySelector<HTMLSelectElement>('#inspect-equipment')!.onchange = e => {
  const p = markers.find(m => m.id === (e.target as HTMLSelectElement).value);
  if (p) lunarMap.onSelect(p);
};
if (params.get('labels') === 'off' || params.get('hud') === '0') labels.mode = 'off';
if (params.get('map') === 'off' || params.get('hud') === '0') lunarMap.mode = 'off';
if (params.get('hud') === '0') controls.hidden = true;

// ---------------------------------------------------------------------------------------------------------------
// Input

let dragging: {x: number; y: number} | null = null;
viewer.renderer.domElement.addEventListener('pointerdown', e => {dragging = {x: e.clientX, y: e.clientY};});
addEventListener('pointerup', () => {dragging = null;});
addEventListener('pointermove', e => {
  if (!dragging) return;
  const k = rig.fov / innerHeight;
  rig.az -= (e.clientX - dragging.x) * k;
  rig.el = Math.max(-89.9, Math.min(89.9, rig.el + (e.clientY - dragging.y) * k));
  dragging = {x: e.clientX, y: e.clientY};
});
viewer.renderer.domElement.addEventListener('wheel', e => {
  e.preventDefault();
  if (viewName === 'chase') chaseDistance = Math.max(8, Math.min(2000, chaseDistance * Math.exp(e.deltaY * 0.001)));
  if (viewName === 'argo') argoCamDistance = Math.max(25, Math.min(2000, argoCamDistance * Math.exp(e.deltaY * 0.001)));
  else rig.fov = Math.max(0.5, Math.min(100, rig.fov * Math.exp(e.deltaY * 0.001)));
}, {passive: false});
const held = new Set<string>();
addEventListener('keyup', e => held.delete(e.key.toLowerCase()));
addEventListener('blur', () => held.clear());
addEventListener('keydown', e => {
  if ((e.target as HTMLElement).matches('input, select, button, textarea')) return;
  if (e.repeat) return;
  if (e.key.toLowerCase() === 'l' && !mission.launched) changeLabels();
  if (['ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  if (e.key === ' ' && mission.launched) {e.preventDefault(); mission.throttle = 0; mission.assisted = false;}
  const flightView = ({c: 'chase', v: 'cockpit', n: 'docking', b: 'argo'} as Record<string, ViewName>)[e.key.toLowerCase()];
  if (flightView) {viewName = flightView; rig = makeRig(viewName); cameraSelect.value = viewName;}
  if (e.key.toLowerCase() === 'm') lunarMap.cycle();
  if (mission.launched) {
    const aid = ({q: 'stabilize', e: 'dock', g: 'match'} as Record<string, AttitudeMode>)[e.key.toLowerCase()];
    if (aid) mission.attitudeMode = mission.attitudeMode === aid ? 'free' : aid;
  }
  if (e.key === 'Enter' && !flightHud.debrief.hidden) flightHud.onReset();
  if (e.key.toLowerCase() === 'p') {audioChosen = true; audio.toggle();}
  if (e.key.toLowerCase() === 'y') toggleAutopilot();
  held.add(e.key.toLowerCase());
  if (e.key === '[') warp = Math.max(1, warp / 10);
  if (e.key === ']') warp = Math.min(1000, warp * 10);
  if (e.key === 'x') stars.mode = stars.mode === 'real' ? 'bright' : stars.mode === 'bright' ? 'off' : 'real';
  if (e.key === 'h') hud.hidden = !hud.hidden;
  const views: ViewName[] = ['pad', 'apollo', 'site', 'rille', 'lander-up', 'hover', 'orbit', 'globe'];
  const index = Number(e.key) - 1;
  if (index >= 0 && index < views.length) {viewName = views[index]; rig = makeRig(viewName);}
});
function walk(realDt: number) {
  if (!rig.walk || mission.launched) return;
  const speed = (held.has('shift') ? 40 : 3) * realDt * (1 + Math.max(0, rings.altitude) / 20);
  const f = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0), r = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0);
  const u = (held.has('r') ? 1 : 0) - (held.has('f') ? 1 : 0);
  if (f || r || u) rig.walk(f * speed, r * speed, u * speed);
}

const hud = document.createElement('div');
hud.className = 'hud';
app.appendChild(hud);
hud.hidden = params.get('telemetry') !== '1';
const flightHud = new MissionHud(app, mission);
flightHud.onLaunch = () => {viewName = 'chase'; rig = makeRig(viewName); cameraSelect.value = viewName; warp = 1; setSheet(false);};
if (driving) setDriving(true); // apply the initial drive state now that the flight HUD it toggles exists
/**
 * Phone menu. A real bottom sheet inside #app, not a body pseudo-element: the old dimmer painted above the whole app
 * and swallowed every tap, which is why nothing was pressable. Opening it MOVES the desktop panels into the sheet so
 * there is one scrollable column with big touch targets, and closing puts them back.
 */
const sheetBackdrop = document.createElement('div');
sheetBackdrop.className = 'sheet-backdrop';
sheetBackdrop.hidden = true;
const sheet = document.createElement('section');
sheet.className = 'sheet';
sheet.hidden = true;
sheet.innerHTML = `<div class="sheet-grip"></div>
  <header class="sheet-head"><b>FLIGHT MENU</b><button class="sheet-close" aria-label="Close menu">Close</button></header>
  <div class="sheet-body"></div>`;
app.append(sheetBackdrop, sheet);
const sheetBody = sheet.querySelector<HTMLElement>('.sheet-body')!;
let sheetOpen = false;
function setSheet(open: boolean) {
  if (open === sheetOpen) return;
  sheetOpen = open;
  document.body.classList.toggle('sheet-open', open);
  sheetBackdrop.hidden = !open;
  sheet.hidden = !open;
  if (open) sheetBody.append(controls, flightHud.panel);
  else app.append(controls, flightHud.panel);
}
sheetBackdrop.addEventListener('pointerdown', () => setSheet(false));
sheet.querySelector<HTMLButtonElement>('.sheet-close')!.onclick = () => setSheet(false);
// Picking a camera, launching or switching mission drops you straight back into the view.
sheet.addEventListener('click', e => {
  if ((e.target as HTMLElement).closest('#camera-view, [data-action=launch], [data-action=reset], #mode-ascent, #mode-descent, #drive, [data-attitude]')) setSheet(false);
});
flightHud.onMenu = () => setSheet(!sheetOpen);

const touchUI = setupTouch({
  parent: app,
  press: (key, down) => document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {key, bubbles: true})),
  setThrottle: v => {mission.throttle = v; mission.assisted = false;},
  getThrottle: () => mission.throttle,
  isDriving: () => driving,
});
const audio = new GameAudio();
let audioChosen = params.get('sound') === '0';
// Browsers only allow audio after a gesture: the first click or key starts the music unless the player turned it off.
const startAudio = () => {if (!audioChosen) {audioChosen = true; audio.toggle(true);}};
addEventListener('pointerdown', startAudio, {once: true});
addEventListener('keydown', e => {if (e.key.toLowerCase() !== 'p') startAudio();}, {once: true});
// iOS keeps the context suspended until a gesture resumes it, and one tap often isn't enough: nudge it on every tap.
for (const type of ['touchend', 'pointerup', 'click']) addEventListener(type, () => audio.resume(), {passive: true});
controls.querySelector<HTMLButtonElement>('#sound')!.onclick = () => {audioChosen = true; audio.toggle();};
const effects = new Effects();
viewer.scene.add(effects.group);
// Tyre tracks live in the terrain anchor frame (like the hardware): pressed into the ground at body-fixed lat/lon.
let trackAnchor = scale(latLonToUnit(terrain.anchorLat, terrain.anchorLon), R_MOON);
const tracks = new Tracks((lat, lon, lift) =>
  sub(scale(latLonToUnit(lat, lon), R_MOON + terrain.height(lat, lon) + lift), trackAnchor) as [number, number, number]);
viewer.scene.add(tracks.group);
let fxClock = 0, liftoffDust = false, exploded = false;
const plume = makePlume();
const puffs: ReturnType<typeof makeRcsPuff>[] = [];
const groundAt = (r: V3) => terrain.surfaceRadius(unit(inertialToBody(r, simTime)));
flightHud.onReset = () => {location.href = location.pathname + '?view=pad&scenario=window-open';};
if (params.get('hud') === '0') flightHud.panel.hidden = true;
const dockingSight = document.createElement('div');
dockingSight.className = 'docking-sight';
dockingSight.innerHTML = '<i></i><span></span><b></b>';
app.appendChild(dockingSight);

// Cockpit instruments: a heads-up overlay only in the cockpit view, with corner gauges, a fixed nose reticle and a
// prograde (velocity) marker so you can fly the pitch cue by eye without reading the side panel.
const cockpitHud = document.createElement('div');
cockpitHud.className = 'cockpit-hud';
cockpitHud.innerHTML = `<div class="ck-reticle"></div><div class="ck-prograde"></div>
  <div class="ck tl"><small>ALTITUDE</small><b data-ck="alt"></b></div>
  <div class="ck tr"><small>VERTICAL</small><b data-ck="vs"></b></div>
  <div class="ck ml"><small>HORIZONTAL</small><b data-ck="hspd"></b></div>
  <div class="ck mr"><small>PITCH · CUE</small><b data-ck="pitch"></b></div>
  <div class="ck bl"><small>THROTTLE</small><b data-ck="thr"></b><i><u data-ck="thrbar"></u></i></div>
  <div class="ck br"><small>MAIN · RCS · BATT</small><b data-ck="res"></b></div>
  <div class="ck-status" data-ck="status"></div>`;
app.appendChild(cockpitHud);

// ARGO picture-in-picture: a small live camera on the mothership that appears once you are within a few km, so you can
// watch it during the approach without leaving your flight camera.
const argoPip = document.createElement('div');
argoPip.className = 'argo-pip';
argoPip.innerHTML = '<b>◇ ARGO · MOTHERSHIP</b><span></span>';
app.appendChild(argoPip);
const insetCam = new T.PerspectiveCamera(45, 1.6, 0.1, 1e11);
const argoHint = document.createElement('div');
argoHint.className = 'argo-hint';
argoHint.textContent = 'DRAG / ARROWS · orbit ARGO    WHEEL · range';
argoHint.hidden = true;
app.appendChild(argoHint);

// ---------------------------------------------------------------------------------------------------------------
// Frame

let cameraEqj: V3 = [0, 0, 0];
let shadowsPrimed = false;

function place(realDt: number) {
  const {sun: sunPos, earth: earthPos} = bodiesAt(sky, simTime);
  cameraEqj = rig.position();
  const {forward, up} = rig.look();
  viewer.camera.fov = rig.fov;
  // Near plane grows with altitude for depth precision, but never past the spacecraft: at 100 km it would reach 10 m
  // and slice ARGO's docking port off the screen during the last metres of an approach.
  const craftClearance = Math.min(len(sub(apply(sky.mciToEqj, mission.state.r), cameraEqj)), len(sub(apply(sky.mciToEqj, mission.argo.r), cameraEqj)) - 70);
  viewer.camera.near = Math.max(0.05, Math.min(1000, (len(cameraEqj) - R_MOON) * 1e-4, craftClearance * 0.05));
  viewer.camera.updateProjectionMatrix();
  viewer.camera.position.set(0, 0, 0);
  viewer.camera.up.copy(toThree(up));
  viewer.camera.lookAt(toThree(forward));

  const sunDir = toThree(unit(sub(sunPos, cameraEqj)));
  sun.place(sunDir, len(sub(sunPos, cameraEqj)));
  stars.update(viewer.camera, viewer.bufferHeight, viewer.renderer.getPixelRatio());

  const moonSunDir = unit(sunPos);
  moon.uniforms.centre.value.copy(toThree(scale(cameraEqj, -1)));
  moon.uniforms.fixedToWorld.value.copy(matrix3(moonFixedToEqj(sky, simTime)));
  moon.uniforms.sunDir.value.copy(toThree(moonSunDir));
  moon.uniforms.earthDir.value.copy(toThree(unit(earthPos)));
  // Full Earth lights the Moon at ~7.7e-5 of sunlight; scale with Earth's lit fraction.
  moon.uniforms.earthshine.value = 7.7e-5 * earthPhase(sky, simTime) * Math.PI;

  earth.uniforms.centre.value.copy(toThree(sub(earthPos, cameraEqj)));
  earth.uniforms.fixedToWorld.value.copy(matrix3(sky.earthFixedAt(simTime)));
  earth.uniforms.sunDir.value.copy(toThree(unit(sub(sunPos, earthPos))));

  // Close-range terrain, rocks and sun shadows (floating origin; body-fixed float64 in, camera-relative out).
  const fixedToWorld = moonFixedToEqj(sky, simTime);
  const cameraBodyFixed: V3 = [0, 1, 2].map(i => fixedToWorld[i][0] * cameraEqj[0] + fixedToWorld[i][1] * cameraEqj[1] + fixedToWorld[i][2] * cameraEqj[2]) as V3;
  const terrainFrame = {fixedToWorld, cameraBodyFixed, cameraWorld: cameraEqj, sunDir: toThree(moonSunDir), earthDir: toThree(unit(earthPos)), earthshine: moon.uniforms.earthshine.value};
  rings.update(terrainFrame, realDt > 0.05 ? 50 : 6);
  rings.place(terrainFrame);
  const ringMatrix = rings.levels[0].mesh.matrix;
  const local = (() => {const r = len(cameraBodyFixed); return terrain.toLocal(Math.asin(cameraBodyFixed[2] / r) * 180 / Math.PI, Math.atan2(cameraBodyFixed[1], cameraBodyFixed[0]) * 180 / Math.PI);})();
  rocks.update(local.x, local.y, rings.altitude);
  rocks.place(ringMatrix, terrainFrame.sunDir, terrainFrame.earthDir, terrainFrame.earthshine);
  hardware.place(ringMatrix);
  tracks.group.matrix.copy(ringMatrix);
  tracks.group.updateMatrixWorld(true);
  // MCI attitude -> EQJ, then camera-relative translation; never put large floats in mesh positions.
  const toFrame = (position: V3, right: V3, up: V3, front: V3) => new T.Matrix4().makeBasis(
    toThree(apply(sky.mciToEqj, right)), toThree(apply(sky.mciToEqj, up)), toThree(apply(sky.mciToEqj, front)),
  ).setPosition(toThree(sub(apply(sky.mciToEqj, position), cameraEqj)));
  const aUp = unit(mission.argo.r), aFront = scale(unit(mission.argo.v), -1);
  argoFrame.matrix.copy(toFrame(mission.argo.r, cross(aUp, aFront), aUp, aFront));
  argoFrame.updateMatrixWorld(true);
  const argoEqj = apply(sky.mciToEqj, mission.argo.r), sunUnit = unit(sunPos);
  const axial = dot(argoEqj, sunUnit);
  const sunlit = axial >= 0 || len(sub(argoEqj, scale(sunUnit, axial))) > R_MOON;
  argo.traverse(o => {const mesh = o as T.Mesh; if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) (material as T.ShaderMaterial).uniforms.solarVisibility.value = sunlit ? 1 : 0;
  });
  if (mission.launched && !separated) {
    const ascent = hardware.objects.get('kestrel')?.getObjectByName('ascent_stage');
    if (ascent) {
      ascent.removeFromParent(); ascentFrame.add(ascent);
      ascent.getObjectByName('engine_main')?.add(plume.mesh);
      for (const name of ['rcs_front_left', 'rcs_front_right', 'rcs_aft_left', 'rcs_aft_right']) {
        const puff = makeRcsPuff();
        ascent.getObjectByName(name)?.add(puff.mesh);
        puffs.push(puff);
      }
    }
    separated = true;
  }
  ascentFrame.matrix.copy(toFrame(mission.state.r, rotate(mission.state.q, [1, 0, 0]), rotate(mission.state.q, [0, 1, 0]), rotate(mission.state.q, [0, 0, 1])));
  ascentFrame.updateMatrixWorld(true);
  ascentFrame.visible = viewName !== 'cockpit' && !exploded;
  const localUp = toThree(unit(cameraEqj));
  hardwareLight.sunDir.value.copy(terrainFrame.sunDir);
  hardwareLight.earthDir.value.copy(terrainFrame.earthDir);
  hardwareLight.upDir.value.copy(localUp);
  hardwareLight.earthshine.value = terrainFrame.earthshine;
  // Sunlit regolith as seen from above: albedo ~0.11 times the Sun's height, plus a little opposition brightening.
  hardwareLight.groundRadiance.value = viewName === 'argo' ? 0.12
    : 0.11 * Math.max(0, terrainFrame.sunDir.dot(localUp)) * 1.1;
  hardwareLight.inspectionFill.value = viewName === 'argo' ? 0.18 : 0;
  tracks.setLight(Math.max(0, terrainFrame.sunDir.dot(localUp)));
  // Floodlight on while flying within 600 m of ARGO (the docking camera sits just behind it).
  const lampOn = params.get('lamp') !== '0' && separated && !exploded && mission.dockingRange < 600;
  hardwareLight.lampIntensity.value = lampOn ? 110 : 0;
  if (lampOn) {
    hardwareLight.lampPos.value.copy(toThree(sub(add(apply(sky.mciToEqj, mission.state.r), apply(sky.mciToEqj, rotate(mission.state.q, [0, 3.32, 2.6]))), cameraEqj)));
    hardwareLight.lampDir.value.copy(toThree(apply(sky.mciToEqj, rotate(mission.state.q, [0, 0, 1]))));
  }
  // Drive the buggy model to wherever the sim has got to: tilt it onto the slope (or nose-up in the air), lift it off
  // the ground while jumping, and spin and steer the wheels.
  placeBuggy();
  if (fixturePost) {fixturePost.matrix.copy(ringMatrix); fixturePost.updateMatrixWorld(true);}
  moon.setCoverage(rings.coverage);
  const nearGround = rings.altitude < 2500;
  shadows.uniforms.shadowsEnabled.value = nearGround ? 1 : 0;
  // Render the cascades at least once: a depth texture that was never a render target has no shadow-compare
  // setup, and sampling it as sampler2DShadow invalidates every terrain draw call (black ground from altitude).
  if (nearGround || !shadowsPrimed) {
    shadowsPrimed = true;
    const down = toThree(scale(unit(cameraEqj), -Math.max(0, rings.altitude)));
    shadows.render(viewer.renderer, viewer.scene, down, terrainFrame.sunDir);
  }

  // Engine, RCS and particle effects.
  const actuators = mission.bus.read();
  const burning = mission.launched && !mission.result && mission.state.mainPropellant > 0 ? actuators.throttle : 0;
  plume.material.uniforms.throttle.value = burning;
  plume.material.uniforms.time.value = fxClock;
  const rcsLevel = mission.launched && !mission.result && mission.state.rcsPropellant > 0
    ? Math.min(1, Math.max(...actuators.rotate.map(Math.abs), ...actuators.translate.map(Math.abs))) : 0;
  for (const [i, puff] of puffs.entries()) puff.material.uniforms.level.value = rcsLevel * (0.6 + 0.4 * Math.sin(fxClock * 40 + i * 1.7));
  effects.update(fxClock, realDt, sky.mciToEqj, cameraEqj, sunlitAt(mission.state.r, sunPos), viewer.bufferHeight);
  effects.settleDebris(groundAt);
  viewer.exposureCap = brightBodyCap(sunPos, earthPos);
  const sunHeight = terrainFrame.sunDir.dot(localUp);
  // ARGO cam: hold a fixed exposure only when the mothership is sunlit (else it reads as a black silhouette); on the
  // night side let auto-exposure lift the earthshine-lit scene instead of pinning it dark.
  // Pin exposure to the sunlit-surface brightness whenever the lit Moon fills much of the frame (any altitude up to
  // where it shrinks to a disc), so the surrounding black sky can't pull auto-exposure up and blow the surface white.
  viewer.surfaceExposure = viewName === 'argo' ? (sunlitAt(mission.argo.r, sunPos) ? 1.6 : null)
    : len(cameraEqj) < R_MOON * 1.5 && toThree(forward).dot(localUp) < 0.55 && sunHeight > 0.02
      ? (viewName === 'rover' ? 0.26 : 0.18) / (0.12 * sunHeight + 0.015) : null;
  viewer.render(realDt);
  argoHint.hidden = viewName !== 'argo';
  if (viewName === 'argo') {
    const argoAlt = (len(mission.argo.r) - R_MOON) / 1000;
    argoHint.textContent = `ARGO · ALT ${argoAlt.toFixed(1)} km${mission.launched && !mission.result ? ` · RANGE ${(mission.dockingRange / 1000).toFixed(1)} km` : ''}    DRAG / ARROWS · orbit    WHEEL · zoom`;
  }
  dockingSight.hidden = viewName !== 'docking';
  if (!dockingSight.hidden) {
    const p = toThree(sub(apply(sky.mciToEqj, mission.argo.r), cameraEqj)).project(viewer.camera);
    const x = (p.x * 0.5 + 0.5) * innerWidth, y = (-p.y * 0.5 + 0.5) * innerHeight;
    dockingSight.querySelector<HTMLElement>('i')!.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    const approach = mission.approach;
    dockingSight.querySelector('span')!.textContent = `ARGO PORT  ${mission.dockingRange.toFixed(1)} m  ${approach.rangeRate.toFixed(2)} m/s`;
    dockingSight.querySelector('b')!.textContent = mission.captureRemaining > 0 ? `SOFT CAPTURE · LATCH ${mission.captureRemaining.toFixed(1)} s`
      : mission.state.status === 'docked' ? 'HARD DOCK · PRESSURE SEAL' : `BRAKE LIMIT ${mission.brakingLimit.toFixed(2)} m/s · RCS ${rcsKeys(mission.translationCue.keys)}`;
  }
  // ARGO picture-in-picture: draw once you are within 8 km, unless the current camera already frames ARGO.
  const showPip = mission.launched && !mission.result && mission.dockingRange < 8000
    && viewName !== 'argo' && viewName !== 'docking' && innerWidth >= 820;
  argoPip.hidden = !showPip;
  if (showPip) {
    const w = Math.min(300, innerWidth * 0.26), h = w * 0.62, x = innerWidth - w - 16, y = 74;
    const argoEqj = apply(sky.mciToEqj, mission.argo.r), upv = unit(argoEqj), along = unit(apply(sky.mciToEqj, mission.argo.v));
    const camPos = add(add(argoEqj, scale(upv, 34)), scale(along, -78));
    insetCam.position.copy(toThree(sub(camPos, cameraEqj)));
    insetCam.up.copy(toThree(upv));
    insetCam.lookAt(toThree(sub(argoEqj, cameraEqj)));
    viewer.renderInset(insetCam, x, y, w, h);
    argoPip.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    argoPip.querySelector('span')!.textContent = `${mission.dockingRange.toFixed(0)} m`;
  }
  cockpitHud.hidden = viewName !== 'cockpit';
  if (!cockpitHud.hidden) {
    const o = mission.summary, s = mission.state;
    const set = (k: string, v: string) => {cockpitHud.querySelector(`[data-ck=${k}]`)!.textContent = v;};
    set('alt', `${(altitudeAboveGround(s, mission.env) / 1000).toFixed(2)} km`);
    set('vs', `${o.verticalSpeed.toFixed(0)} m/s`);
    set('hspd', `${o.horizontalSpeed.toFixed(0)} m/s`);
    const actualPitch = Math.asin(Math.max(-1, Math.min(1, dot(rotate(s.q, [0, 1, 0]), unit(s.r))))) * 180 / Math.PI;
    const cuePitch = Math.asin(Math.max(-1, Math.min(1, dot(mission.guidance.thrustDirection, unit(s.r))))) * 180 / Math.PI;
    set('pitch', `${actualPitch.toFixed(0)}° → ${cuePitch.toFixed(0)}°`);
    const thr = mission.assisted && mission.launched ? mission.bus.read().throttle : mission.throttle;
    set('thr', `${Math.round(thr * 100)}%`);
    cockpitHud.querySelector<HTMLElement>('[data-ck=thrbar]')!.style.width = `${thr * 100}%`;
    set('res', `${(s.mainPropellant / KESTREL.mainPropellantCapacity * 100).toFixed(0)}% · ${(s.rcsPropellant / KESTREL.rcsPropellantCapacity * 100).toFixed(0)}% · ${s.batteryKWh.toFixed(1)}kWh`);
    set('status', mission.result ? mission.result.replaceAll('-', ' ').toUpperCase() : !mission.launched ? `T−${Math.max(0, mission.countdown).toFixed(0)} s` : mission.phase.toUpperCase());
    // Prograde marker: a point 1 km ahead along the velocity, projected to screen (hidden while essentially parked).
    const prograde = cockpitHud.querySelector<HTMLElement>('.ck-prograde')!;
    if (mission.launched && (Math.abs(o.verticalSpeed) > 1 || o.horizontalSpeed > 1)) {
      const ahead = add(s.r, scale(unit(s.v), 1000));
      const pv = toThree(sub(apply(sky.mciToEqj, ahead), cameraEqj)).project(viewer.camera);
      prograde.hidden = pv.z > 1;
      prograde.style.transform = `translate(${((pv.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((-pv.y * 0.5 + 0.5) * innerHeight).toFixed(1)}px)`;
    } else prograde.hidden = true;
  }
  labels.update(viewer.camera, cameraEqj, rings.altitude);
  const geo = terrain.fromLocal(local.x, local.y);
  geoLatLon = geo;
  if (driving) {
    // Follow the buggy on a zoomed map with a breadcrumb trail, so its movement is actually visible.
    lunarMap.follow = {lat: buggy.lat, lon: buggy.lon};
    const last = driveTrail[driveTrail.length - 1];
    if (!last || Math.hypot(buggy.lat - last.lat, buggy.lon - last.lon) > 0.0006) {
      driveTrail.push({lat: buggy.lat, lon: buggy.lon});
      if (driveTrail.length > 240) driveTrail.shift();
    }
    lunarMap.track = driveTrail;
    lunarMap.draw({lat: buggy.lat, lon: buggy.lon, heading: buggy.heading * 180 / Math.PI});
  } else {
    lunarMap.follow = null;
    lunarMap.draw({lat: geo.lat, lon: geo.lon, heading: rig.az});
  }
  controls.querySelector('#label-mode')!.textContent = `Labels: ${labels.mode} [L]`;
  controls.querySelector('#map-mode')!.textContent = `Map: ${lunarMap.mode} [M]`;
  warpVal.textContent = `${warp}×`;
  warpVal.classList.toggle('fast', warp > 1);
  updateTargetHud();
}

/** 1 when an MCI point is in sunlight, 0 inside the Moon's shadow cylinder. */
function sunlitAt(r: V3, sunPos: V3) {
  const p = apply(sky.mciToEqj, r), s = unit(sunPos), axial = dot(p, s);
  return axial >= 0 || len(sub(p, scale(s, axial))) > R_MOON ? 1 : 0;
}

const frustum = new T.Frustum(), projScreen = new T.Matrix4();
/** Brightest sunlit radiance each body can show (Earth's clouds; the Moon's bright highlands). */
const PEAK_RADIANCE = {earth: 0.78, moon: 0.25};
/** Keep any sunlit body that is in frame at or below display value ~2 (ACES shoulder). */
function brightBodyCap(sunPos: V3, earthPos: V3) {
  viewer.camera.updateMatrixWorld();
  projScreen.multiplyMatrices(viewer.camera.projectionMatrix, viewer.camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreen);
  let cap = Infinity;
  const consider = (centre: V3, radius: number, peak: number) => {
    const rel = sub(centre, cameraEqj);
    if (!frustum.intersectsSphere(new T.Sphere(toThree(rel), radius))) return;
    // Lit fraction of the disc as seen from the camera; a body seen only on its night side does not cap.
    const cosPhase = unit(scale(rel, -1)).reduce((a, x, i) => a + x * unit(sub(sunPos, centre))[i], 0);
    if ((1 + cosPhase) / 2 < 0.005) return;
    cap = Math.min(cap, 2 / peak);
  };
  consider(earthPos, EARTH_RADIUS, PEAK_RADIANCE.earth);
  // White spacecraft paint reflects ~8x more than regolith: when ARGO fills a real part of the frame, expose for it
  // instead of blowing it out against the Moon.
  const argoPos = apply(sky.mciToEqj, mission.argo.r), argoDistance = len(sub(argoPos, cameraEqj));
  if (argoFrame.visible && argoDistance < 3000 && sunlitAt(mission.argo.r, sunPos)) {
    const rel = sub(argoPos, cameraEqj);
    if (frustum.intersectsSphere(new T.Sphere(toThree(rel), 40))) cap = Math.min(cap, 1.6 / 0.8);
  }
  // Standing on or skimming the Moon, the pixel meter already sees the ground; only cap the Moon as a distant disc.
  if (len(cameraEqj) > R_MOON * 1.5) consider([0, 0, 0], R_MOON, PEAK_RADIANCE.moon);
  return cap;
}

let last = performance.now();
let fakeNow = 0;
let lastTrackTime = -Infinity;
function loop(now: number) {
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  tick(realDt, now);
  requestAnimationFrame(loop);
}

/**
 * Full autopilot: launches in the window, flies the guided ascent, coasts to apoapsis (with time-warp), matches ARGO's
 * velocity, then flies the RCS cue to a soft dock. It reuses the exact aids a player has, so it proves the game is
 * winnable and lets someone just watch. Returns the target warp for this frame.
 */
function stepAutopilot(): number {
  const m = mission;
  if (m.result || m.state.status === 'docked') return 1;
  if (!m.launched) {
    // Fast-forward toward the window, easing the warp down so we don't jump past the few-second green band.
    if (m.countdown < -5) {m.waitForWindow(); return 1;} // missed it: line up the next window
    if (m.countdown > 90) return 100;
    if (m.countdown > 12) return 10;
    if (m.windowBand === 'green') {if (m.launch()) flightHud.onLaunch();}
    return 1;
  }
  const o = m.summary;
  if (m.mode === 'descent') {
    // RETRO holds the braking-guidance attitude; the throttle follows the same solution all the way to touchdown.
    m.attitudeMode = 'retrograde';
    m.throttle = m.descentGuidance.throttle;
    return 1;
  }
  if (o.periapsisAltitude < 10_000 && m.guidance.phase !== 'cutoff') {m.assisted = true; return 1;} // guided ascent
  if (m.assisted) {m.assisted = false; m.throttle = 0; m.attitudeMode = 'stabilize';}               // just reached orbit
  if (o.verticalSpeed > 0 && m.range > 4000) return m.timeToApoapsis > 400 ? 100 : 5;                // coast to apoapsis
  if (len(m.relativeVelocity) > 0.35 && m.dockingRange > 300) {                                      // match velocity
    m.attitudeMode = 'match';
    const aligned = dot(rotate(m.state.q, [0, 1, 0]), unit(sub(m.argo.v, m.state.v))) > 0.995;
    m.throttle = aligned ? Math.min(1, len(m.relativeVelocity) / 12) : 0;
    return 1;
  }
  m.throttle = 0; m.attitudeMode = 'dock'; m.translation = m.translationCue.keys;                    // fly the dock cue
  return 1;
}

/** One game frame: input, fixed-step physics, effects, audio, HUD, render. Tests drive it directly. */
function tick(realDt: number, now: number, render = true) {
  // ARGO inspection has both mouse drag and continuous keyboard orbit. Arrow keys belong to the camera in this view,
  // so they do not change KESTREL's throttle at the same time.
  if (viewName === 'argo') {
    rig.az += ((held.has('arrowright') ? 1 : 0) - (held.has('arrowleft') ? 1 : 0)) * 60 * realDt;
    rig.el = Math.max(-89, Math.min(89, rig.el + ((held.has('arrowup') ? 1 : 0) - (held.has('arrowdown') ? 1 : 0)) * 60 * realDt));
  }
  if (driving) {
    // Ground: W/S motor/brake and A/D steer. In flight those become forward/retro rockets and bank+yaw; R/F climb
    // and descend, and Shift opens the high-flow forward valve. The flight HUD changes mode and explains the mapping.
    const drive: BuggyControls = {
      throttle: held.has('w') ? 1 : 0,
      brake: held.has('s') ? 1 : 0,
      steer: (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0),
      turbo: held.has('shift'),
      lift: (held.has('r') ? 1 : 0) - (held.has('f') ? 1 : 0),
    };
    const step = Math.min(realDt, 0.05);
    buggy.step(held.size ? drive : NO_DRIVE, step, terrain);
    wheelSpin += (buggy.speed * step) / 0.52; // roll the wheels (tyre radius 0.52 m)
    driveEffects(step);
  }
  if (driving) warp = 1; // never warp world time while hand-driving the buggy — it would desync from real-time control
  if (autopilotOn) warp = stepAutopilot();
  else if (mission.launched) {
    if (viewName !== 'argo' && held.has('arrowup')) mission.throttle = Math.min(1, mission.throttle + realDt * 0.35);
    if (viewName !== 'argo' && held.has('arrowdown')) mission.throttle = Math.max(0, mission.throttle - realDt * 0.35);
    mission.rotation = [(held.has('i') ? 1 : 0) - (held.has('k') ? 1 : 0), (held.has('j') ? 1 : 0) - (held.has('l') ? 1 : 0), (held.has('u') ? 1 : 0) - (held.has('o') ? 1 : 0)];
    mission.translation = [(held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0), (held.has('r') ? 1 : 0) - (held.has('f') ? 1 : 0), (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0)];
  }
  mission.advance(realDt, warp);
  simTime = mission.state.t;
  fxClock += realDt;
  if (document.body.classList.contains('compact')) touchUI.refresh();
  if (mission.launched && !liftoffDust && mission.bus.read().throttle > 0 && mission.state.status === 'flying' && !mission.result) {
    // Only a real liftoff blasts regolith, from the ground under the nozzle; a scenario that starts mid-climb does not.
    liftoffDust = true;
    const below = scale(unit(mission.state.r), groundAt(mission.state.r));
    if (mission.summary.altitude < 30) effects.dust(below, surfaceVelocity(below), fxClock, 9000, [10, 120], groundAt);
  }
  if ((mission.result === 'surface-impact' || mission.result === 'collision') && !exploded) {
    exploded = true;
    const pieces: T.Material[] = [];
    ascentFrame.traverse(o => {const mesh = o as T.Mesh; if (mesh.isMesh && pieces.length < 6) pieces.push(mesh.material as T.Material);});
    ascentFrame.visible = false;
    const surface = mission.result === 'surface-impact';
    effects.explode(mission.state.r, surface ? surfaceVelocity(mission.state.r) : mission.state.v, fxClock, pieces, surface ? groundAt : null);
    if (!surface) {
      // A hull-to-hull strike at these speeds wrecks the mothership too.
      argoFrame.visible = false;
      effects.explode(mission.argo.r, mission.argo.v, fxClock, pieces, null);
    }
  }
  const approachLimit = mission.brakingLimit, rangeRate = mission.approach.rangeRate;
  const o = mission.summary;
  const warning: Warning = mission.result ? 'none'
    : mission.launched && ((o.periapsisAltitude < 0 && o.verticalSpeed < -30 && o.altitude < 3000) || (mission.dockingRange < 300 && -rangeRate > approachLimit * 2)) ? 'master'
      : mission.launched && ((mission.dockingRange < 300 && -rangeRate > approachLimit) || mission.state.mainPropellant < KESTREL.mainPropellantCapacity * 0.08 || mission.state.batteryKWh < 3) ? 'caution' : 'none';
  const actuatorsNow = mission.bus.read();
  audio.update({phase: mission.phase, throttle: mission.launched && !mission.result ? actuatorsNow.throttle : 0,
    rcsActive: mission.launched && !mission.result && [...actuatorsNow.rotate, ...actuatorsNow.translate].some(x => Math.abs(x) > 0.2), warning,
    drive: driving ? {rev: Math.min(1, Math.abs(buggy.speed) / (BUGGY.topSpeed * 1.5)), turbo: (held.has('shift') || buggy.flightThrusting) && buggy.turbo > 0, airborne: buggy.airborne} : undefined});
  controls.querySelector('#sound')!.textContent = `Sound: ${audio.enabled ? 'on' : 'off'} [P]`;
  autopilotBtn.textContent = `Autopilot: ${autopilotOn ? 'on' : 'off'} [Y]`;
  const geo = (r: V3, t: number) => {const p = unit(inertialToBody(r, t)); return {lat: Math.asin(p[2]) * 180 / Math.PI, lon: Math.atan2(p[1], p[0]) * 180 / Math.PI};};
  Object.assign(argoMarker, geo(mission.argo.r, simTime));
  const kestrelMarker = markers.find(p => p.id === 'kestrel')!;
  Object.assign(kestrelMarker, mission.groundPosition);
  if (Math.abs(simTime - lastTrackTime) > 5) {
    lastTrackTime = simTime;
    lunarMap.track = Array.from({length: 121}, (_, i) => {const t = simTime + i * 60; return geo(circularState(mission.orbit, t).r, t);});
  }
  flightHud.update(now);
  updateDriveHud();
  walk(realDt);
  if (render) place(realDt);
  if (!hud.hidden && Math.floor(now / 250) !== Math.floor((now - realDt * 1000) / 250)) updateHud();
}

function updateHud() {
  const b = bodiesAt(sky, simTime);
  const s = topocentric(sky, simTime, siteFixed, siteRadius(), b.sun), e = topocentric(sky, simTime, siteFixed, siteRadius(), b.earth);
  const date = new Date(sky.epoch.getTime() + simTime * 1000);
  const altitude = (len(cameraEqj) - R_MOON) / 1000;
  hud.innerHTML = `
    <b>LAST WINDOW</b> <span class="dim">surface preview</span><br>
    ${date.toISOString().replace('T', ' ').slice(0, 19)} UTC · warp ${warp}×<br>
    view <b>${viewName}</b> · ${rings.altitude < 5000 ? `${rings.altitude.toFixed(1)} m above ground` : `altitude ${altitude.toFixed(0)} km`} · fov ${rig.fov.toFixed(1)}°<br>
    Hadley: Sun az ${s.azimuth.toFixed(1)}° el ${s.elevation.toFixed(1)}° · Earth az ${e.azimuth.toFixed(1)}° el ${e.elevation.toFixed(1)}°<br>
    Earth ${(earthPhase(sky, simTime) * 100).toFixed(0)}% lit, ${(angularDiameter(EARTH_RADIUS, len(b.earth)) * 180 / Math.PI).toFixed(2)}° wide<br>
    exposure ${Math.log2(exposure.value).toFixed(1)} EV · stars ${stars.mode} · ${viewer.fps.toFixed(0)} fps<br>
    <span class="dim">1-9 views · drag look · wheel zoom · WASD walk, R/F up, Shift run · [ ] warp · x stars · L labels · M map · h telemetry</span>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Test probe (tests/sky-probe.js reads this through the browser tool).

function projectToNdc(eqj: V3) {
  const v = toThree(sub(eqj, cameraEqj)).project(viewer.camera);
  return {x: v.x, y: v.y, visible: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1};
}

Object.assign(window, {
  moonAscent: {
    ready: () => viewer.shaderErrors.length === 0,
    texturesLoaded: () => texturesLoaded,
    debug: {mission, buggy, tracks, audio, effects, argoFrame, ascentFrame, labels, lunarMap, markers, shadows, rings, rocks, viewer, hardware, terrain, fixture: fixturePost},
    /** Render one frame and return the canvas as a PNG data URL (read within the same task, so no preserveDrawingBuffer). */
    capture: () => {place(1 / 30); return viewer.renderer.domElement.toDataURL('image/png');},
    errors: () => viewer.shaderErrors,
    setView: (name: ViewName) => {viewName = name; rig = makeRig(name); place(0.016);},
    look: (az: number, el: number, fov?: number) => {rig.az = az; rig.el = el; if (fov) rig.fov = fov; place(0.016);},
    settle: (frames = 90) => {for (let i = 0; i < frames; i++) place(1 / 30);},
    /** Run whole game frames (physics, effects, HUD) at a fixed real dt, for scripted play tests. */
    run: (frames = 30, dt = 1 / 30, render = true) => {for (let i = 0; i < frames; i++) {fakeNow += dt * 1000; tick(dt, fakeNow, render || i === frames - 1);}},
    key: (key: string, down = true) => document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {key, bubbles: true})),
    exposure: () => exposure.value,
    fps: () => viewer.fps,
    cameraState: () => ({view: viewName, az: rig.az, el: rig.el, fov: rig.fov, argoDistance: argoCamDistance}),
    earthNdc: () => projectToNdc(bodiesAt(sky, simTime).earth),
    sunNdc: () => projectToNdc(bodiesAt(sky, simTime).sun),
    measure: () => {const m = viewer.measure(); return {logAverage: m.logAverage, highlight: m.highlight};},
    /** Brightness-weighted centroid of pixels above a fraction of the brightest, in NDC. */
    brightCentroid: (fraction = 0.2) => {
      const m = viewer.measure();
      let max = 0;
      for (const l of m.luminance) max = Math.max(max, l);
      let sx = 0, sy = 0, sw = 0;
      for (let j = 0; j < m.height; j++) for (let i = 0; i < m.width; i++) {
        const l = m.luminance[j * m.width + i];
        if (l < max * fraction) continue;
        sx += ((i + 0.5) / m.width * 2 - 1) * l; sy += ((j + 0.5) / m.height * 2 - 1) * l; sw += l;
      }
      return {x: sx / sw, y: sy / sw, max, pixelsNdc: 2 / m.width};
    },
    /** Largest NDC distance (aspect-corrected to y units) of pixels brighter than `threshold` from a point. */
    brightExtent: (cx: number, cy: number, threshold: number) => {
      const m = viewer.measure(), aspect = viewer.camera.aspect;
      let extent = 0, count = 0, finite = true;
      for (let j = 0; j < m.height; j++) for (let i = 0; i < m.width; i++) {
        const l = m.luminance[j * m.width + i];
        if (!Number.isFinite(m.pixels[(j * m.width + i) * 4])) finite = false;
        if (l < threshold) continue;
        const x = ((i + 0.5) / m.width * 2 - 1 - cx) * aspect, y = (j + 0.5) / m.height * 2 - 1 - cy;
        extent = Math.max(extent, Math.hypot(x, y)); count++;
      }
      return {extent, count, finite, pixelNdc: 2 / m.height};
    },
    earthRadiusNdc: () => Math.tan(Math.asin(EARTH_RADIUS / len(sub(bodiesAt(sky, simTime).earth, cameraEqj)))) / Math.tan(viewer.camera.fov * Math.PI / 360),
    rowLuminance: (row: number) => {
      const m = viewer.measure();
      let sum = 0;
      for (let i = 0; i < m.width; i++) sum += m.luminance[row * m.width + i];
      return sum / m.width;
    },
    pixelLuminance: (xNdc: number, yNdc: number) => {
      const m = viewer.measure();
      const i = Math.floor((xNdc + 1) / 2 * m.width), j = Math.floor((yNdc + 1) / 2 * m.height);
      return m.luminance[Math.min(m.height - 1, j) * m.width + Math.min(m.width - 1, i)];
    },
    sitePanorama: () => ({sun: topocentric(sky, simTime, siteFixed, siteRadius(), bodiesAt(sky, simTime).sun), earth: topocentric(sky, simTime, siteFixed, siteRadius(), bodiesAt(sky, simTime).earth)}),
    toAzEl: (eqjDirection: V3) => toAzEl(localFrame(siteUp()), eqjDirection),
  },
});

// ?settle=1 (screenshots): once textures are in, run the eye adaptation to steady state before the first frame.
if (params.get('settle')) {
  const settleWhenLoaded = () => {
    if (!texturesLoaded) return setTimeout(settleWhenLoaded, 100);
    for (let i = 0; i < 300; i++) place(1 / 30);
    document.body.dataset.settled = '1';
  };
  settleWhenLoaded();
}
requestAnimationFrame(loop);
