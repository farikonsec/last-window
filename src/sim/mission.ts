import {CommandBus, NO_COMMAND, type ActuatorCommand} from './bus';
import {classifyContact, sweptSpheresHit, type DockingOutcome} from './docking';
import {ascentGuidance, attitudeHold, DEFAULT_ASCENT} from './guidance';
import {circularState, inertialToBody, summarizeOrbit} from './orbit';
import {MU} from './constants';
import {brakingLimit, meanMotion, predictApproach, toLvlh} from './relative';
import {KESTREL, MOTHERSHIP, stepVehicle, type Environment, type VehicleState} from './vehicle';
import {FLIGHT_DT, landedAt, mothershipOrbit, solveLaunchWindow} from './window';
import {add, cross, dot, len, quatFromUpForward, rotate, scale, sub, unit, type V3} from './vec';

export type MissionResult = 'surface-impact' | 'landed-back' | 'collision' | 'power-loss' | 'escape' | null;
/**
 * Pilot aids for attitude only (throttle and translation stay manual):
 * free = raw RCS, stabilize = null body rates when the stick is released, dock = port toward ARGO along V-bar,
 * match = thrust axis against the velocity relative to ARGO, prograde = thrust axis along orbital velocity.
 */
export type AttitudeMode = 'free' | 'stabilize' | 'dock' | 'match' | 'prograde';

export const RESULT_TEXT: Record<Exclude<MissionResult, null>, {title: string; detail: string}> = {
  'surface-impact': {title: 'SURFACE IMPACT', detail: 'KESTREL hit the Moon faster than its legs can absorb.'},
  'landed-back': {title: 'BACK ON THE SURFACE', detail: 'The ascent stage came down intact but never reached orbit.'},
  'collision': {title: 'COLLISION WITH ARGO', detail: 'The two ships met outside the docking corridor.'},
  'power-loss': {title: 'POWER LOSS', detail: 'Batteries ran flat; the flight computer shut down.'},
  'escape': {title: 'LOST TO SPACE', detail: 'KESTREL reached lunar escape velocity. ARGO cannot follow.'},
};
export const HARDWARE_SCALE = 1.25;
const KESTREL_PORT_OFFSET = 2.05 * HARDWARE_SCALE;
const KESTREL_PORT_UP = 2.65 * HARDWARE_SCALE;

/** ARGO's shape for collisions, in metres of the scaled model: a hull capsule from the docking port along +velocity
 * (the ship's nose faces back toward an approaching lander) and a thin bar for the solar wings. */
const ARGO_HULL = {length: 53 * HARDWARE_SCALE, radius: 3.2 * HARDWARE_SCALE, wingAt: 24 * HARDWARE_SCALE, wingSpan: 15.3 * HARDWARE_SCALE, wingHalfThickness: 1.9 * HARDWARE_SCALE};

function segmentDistance(p: V3, a: V3, b: V3) {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return len(sub(p, add(a, scale(ab, t))));
}

/** Does KESTREL (sphere) touch ARGO's hull or wings at either end of the step or halfway through? */
export function argoHullHit(r0: V3, argo0: {r: V3; v: V3}, r1: V3, argo1: {r: V3; v: V3}) {
  const clearance = KESTREL.collisionRadius * HARDWARE_SCALE;
  for (const f of [0, 0.5, 1]) {
    const r = add(scale(r0, 1 - f), scale(r1, f)), ar = add(scale(argo0.r, 1 - f), scale(argo1.r, f));
    const along = unit(argo1.v), side = unit(cross(unit(ar), along));
    // Leave the first 1.5 m in front of the port to the docking contact model.
    const hullStart = add(ar, scale(along, 1.5)), hullEnd = add(ar, scale(along, ARGO_HULL.length));
    if (segmentDistance(r, hullStart, hullEnd) < ARGO_HULL.radius + clearance) return true;
    const wing = add(ar, scale(along, ARGO_HULL.wingAt));
    if (segmentDistance(r, add(wing, scale(side, -ARGO_HULL.wingSpan)), add(wing, scale(side, ARGO_HULL.wingSpan))) < ARGO_HULL.wingHalfThickness + clearance) return true;
  }
  return false;
}

/** Owns the mission clock and every actuator write; the renderer never advances physics itself. */
export class Mission {
  readonly bus = new CommandBus();
  readonly orbit;
  window;
  state: VehicleState;
  throttle = 0;
  rotation: V3 = [0, 0, 0];
  translation: V3 = [0, 0, 0];
  attitudeMode: AttitudeMode = 'stabilize';
  /** Relative speed at the moment of a terminal contact, for the debrief. */
  impactSpeed = 0;
  assisted = false;
  launched = false;
  liftoffTime = 0;
  result: MissionResult = null;
  dockingOutcome: DockingOutcome | null = null;
  captureRemaining = 0;
  /** Contact quality at soft capture, for scoring the run. */
  dockingContact: {closingSpeed: number; lateral: number; misalignment: number} | null = null;
  probeDamaged = false;
  effectiveWarp = 1;
  private accumulator = 0;

  constructor(readonly site: V3, readonly env: Environment, start = 0) {
    this.orbit = mothershipOrbit(site, 0);
    this.window = solveLaunchWindow(site, this.orbit, start, 1500, KESTREL, env);
    this.state = landedAt(site, start, KESTREL, [0, 0, 1], env);
  }

  get target() {return {...DEFAULT_ASCENT, planeNormal: this.orbit.normal};}
  get argo() {return circularState(this.orbit, this.state.t);}
  get countdown() {return this.window.liftoffTime - this.state.t;}
  get windowBand() {return Math.abs(this.countdown) <= 3 ? 'green' : Math.abs(this.countdown) <= 20 ? 'amber' : 'red';}
  get range() {return len(sub(this.argo.r, this.state.r));}
  get relative() {const a = this.argo; return toLvlh(a.r, a.v, this.state.r, this.state.v);}
  private portRelative(state = this.state, argo = this.argo) {
    const offset = rotate(state.q, [0, KESTREL_PORT_UP, KESTREL_PORT_OFFSET]);
    const portR = add(state.r, offset);
    const portV = add(state.v, cross(rotate(state.q, state.w), offset));
    return toLvlh(argo.r, argo.v, portR, portV);
  }
  get dockingRelative() {return this.portRelative();}
  get dockingRange() {return len(this.dockingRelative.position);}
  get approach() {return predictApproach(this.dockingRelative, meanMotion(this.orbit.radius));}
  get brakingLimit() {return brakingLimit(this.dockingRange);}
  get summary() {return summarizeOrbit(this.state.r, this.state.v);}
  /** Velocity of KESTREL relative to ARGO, inertial m/s. */
  get relativeVelocity() {return sub(this.state.v, this.argo.v);}
  /** Seconds until the next apoapsis on the current orbit (where the launch window puts ARGO 1.5 km ahead). */
  get timeToApoapsis() {
    const o = this.summary;
    if (!o.bound || !this.launched) return Infinity;
    // Kepler: eccentric anomaly from the state, then mean-motion time to E = pi.
    const r = len(this.state.r), a = o.semiMajorAxis, e = Math.max(o.eccentricity, 1e-9);
    const cosE = Math.max(-1, Math.min(1, (1 - r / a) / e));
    let E = Math.acos(cosE);
    if (o.verticalSpeed < 0) E = 2 * Math.PI - E;
    const n = Math.sqrt(MU / a ** 3), M = E - e * Math.sin(E);
    return ((Math.PI - M) / n + 2 * Math.PI / n) % (2 * Math.PI / n);
  }

  /** Where the flight is, for cues and music. */
  get phase(): 'parked' | 'ascent' | 'coast' | 'rendezvous' | 'terminal' | 'capture' | 'docked' | 'ended' {
    if (this.result) return 'ended';
    if (this.state.status === 'docked') return 'docked';
    if (this.captureRemaining > 0) return 'capture';
    if (!this.launched) return 'parked';
    const o = this.summary;
    if (o.periapsisAltitude < 10_000 || this.throttle > 0 && this.range > 20_000) return this.range < 20_000 ? 'rendezvous' : 'ascent';
    if (this.dockingRange < 300) return 'terminal';
    if (this.range < 20_000) return 'rendezvous';
    return 'coast';
  }
  get guidance() {return ascentGuidance(KESTREL, this.state, this.target, this.liftoffTime);}

  launch() {
    if (this.launched || this.result || this.state.batteryKWh <= 0) return false;
    this.launched = true;
    this.liftoffTime = this.state.t;
    this.dockingContact = null;
    this.throttle = 1;
    this.effectiveWarp = 1;
    this.accumulator = 0;
    return true;
  }

  /** Repeatable terminal-approach fixture used by the scenario deep link and browser tests. */
  placeForDocking(range = 25, closing = 0.1, radial = 0, normal = 0) {
    const a = this.argo, up = unit(a.r), along = unit(a.v), out = unit(cross(up, along));
    const dr = add(add(scale(along, -range - KESTREL_PORT_OFFSET), scale(up, radial - KESTREL_PORT_UP)), scale(out, normal));
    const omega = scale(cross(a.r, a.v), 1 / dot(a.r, a.r));
    this.state = {...this.state, r: add(a.r, dr), v: add(add(a.v, cross(omega, dr)), scale(along, closing)),
      q: quatFromUpForward(up, along), w: [0, 0, 0], status: 'flying'};
    this.launched = true;
    this.liftoffTime = this.state.t;
    this.throttle = 0;
    this.assisted = false;
    this.result = null;
    this.dockingOutcome = null;
    this.captureRemaining = 0;
    this.accumulator = 0;
  }

  /** Waiting uses the same power drain and lunar rotation as ordinary landed flight. */
  waitForWindow() {
    if (this.launched || this.result) return;
    if (this.countdown < 0) this.window = solveLaunchWindow(this.site, this.orbit, this.state.t, 1500, KESTREL, this.env);
    const dt = Math.max(0, this.countdown - 30);
    this.advanceParked(dt);
    this.accumulator = 0;
  }

  private advanceParked(dt: number) {
    this.bus.submit(NO_COMMAND, 'parked');
    this.state = stepVehicle(KESTREL, this.state, this.bus.read(), dt, this.env);
    // Refresh orientation as well as position while riding the rotating Moon.
    const pose = landedAt(this.site, this.state.t, KESTREL, [0, 0, 1], this.env);
    this.state.q = pose.q;
    if (this.state.batteryKWh <= 0) this.result = 'power-loss';
  }

  advance(realDt: number, requestedWarp: number) {
    if (this.result) return;
    if (this.captureRemaining > 0) {
      const dt = Math.min(realDt, this.captureRemaining);
      this.state.t += dt;
      this.captureRemaining -= dt;
      const a = this.argo, along = unit(a.v);
      this.state.r = add(add(a.r, scale(along, -KESTREL_PORT_OFFSET)), scale(unit(a.r), -KESTREL_PORT_UP));
      this.state.v = a.v;
      this.state.batteryKWh = Math.max(0, this.state.batteryKWh - KESTREL.baseLoadKW * dt / 3600);
      if (this.captureRemaining <= 0) this.state.status = 'docked';
      return;
    }
    if (this.state.status === 'docked') return;
    const firing = this.launched && (this.assisted ? this.guidance.command.throttle > 0 || this.guidance.command.rotate.some(x => Math.abs(x) > 0.001) : this.throttle > 0 || this.rotation.some(x => x !== 0) || this.translation.some(x => x !== 0));
    this.effectiveWarp = firing || (this.launched && this.range < 5000) ? 1 : Math.min(100, Math.max(1, requestedWarp));
    if (!this.launched) {
      this.advanceParked(Math.max(0, realDt) * this.effectiveWarp);
      return;
    }
    // Budget work, never skip physics time. Excess time slows the simulation rather than enlarging dt.
    this.accumulator = Math.min(5, this.accumulator + Math.max(0, realDt) * this.effectiveWarp);
    while (this.accumulator + 1e-10 >= FLIGHT_DT) {
      const previous = this.state;
      const command: ActuatorCommand = this.assisted ? this.guidance.command : {
        throttle: this.throttle, rotate: this.pilotRotation(), translate: this.translation,
      };
      this.bus.submit(this.state.batteryKWh > 0 ? command : NO_COMMAND, this.assisted ? 'reference-guidance' : 'pilot');
      this.state = stepVehicle(KESTREL, this.state, this.bus.read(), FLIGHT_DT, this.env);
      this.accumulator = Math.max(0, this.accumulator - FLIGHT_DT);
      if (this.state.status === 'crashed') {this.result = 'surface-impact'; this.impactSpeed = this.state.contact?.speed ?? 0;}
      else if (previous.status === 'flying' && this.state.status === 'landed') {this.result = 'landed-back'; this.impactSpeed = this.state.contact?.speed ?? 0;}
      const before = circularState(this.orbit, previous.t), after = this.argo;
      const previousRel = this.portRelative(previous, before);
      const rel = this.dockingRelative;
      const crossedPort = previousRel.position[1] < 0 && rel.position[1] >= 0;
      const lateral = Math.hypot(rel.position[0], rel.position[2]);
      if (crossedPort && lateral < 3.2) {
        const along = unit(after.v), argoUp = unit(after.r);
        const craftForward = rotate(this.state.q, [0, 0, 1]), craftUp = rotate(this.state.q, [0, 1, 0]);
        const outcome = classifyContact({
          closingSpeed: rel.velocity[1], lateralOffset: lateral,
          lateralSpeed: Math.hypot(rel.velocity[0], rel.velocity[2]),
          misalignment: Math.acos(Math.max(-1, Math.min(1, dot(craftForward, along)))) * 180 / Math.PI,
          rollError: Math.acos(Math.max(-1, Math.min(1, dot(craftUp, argoUp)))) * 180 / Math.PI,
          angularRate: len(this.state.w) * 180 / Math.PI,
        });
        this.dockingOutcome = outcome;
        if (outcome === 'capture') {
          this.captureRemaining = 5;
          this.throttle = 0;
          this.translation = [0, 0, 0];
          this.dockingContact = {closingSpeed: Math.abs(rel.velocity[1]), lateral,
            misalignment: Math.acos(Math.max(-1, Math.min(1, dot(craftForward, along)))) * 180 / Math.PI};
        } else if (outcome === 'destroyed') {
          this.result = 'collision';
          this.impactSpeed = len(rel.velocity);
        } else {
          this.probeDamaged ||= outcome === 'damage';
          this.state.r = add(add(after.r, scale(along, -KESTREL_PORT_OFFSET - 0.05)), scale(argoUp, -KESTREL_PORT_UP));
          this.state.v = add(after.v, scale(along, outcome === 'bounce' ? -0.025 : -0.08));
        }
        // Contact consumes the rest of this render frame. Continuing substeps here would
        // numerically drive a captured probe through the target before latch handling runs.
        this.accumulator = 0;
        if (this.result) this.bus.submit(NO_COMMAND, 'failure');
        break;
      } else {
        const inDockingCorridor = previousRel.position[1] < 0 && Math.hypot(previousRel.position[0], previousRel.position[2]) < 3.2;
        if (!inDockingCorridor && argoHullHit(previous.r, before, this.state.r, after)) {
          this.result = 'collision';
          this.impactSpeed = len(sub(this.state.v, after.v));
        }
      }
      if (this.state.status === 'flying' && !summarizeOrbit(this.state.r, this.state.v).bound) this.result = 'escape';
      if (this.state.batteryKWh <= 0) this.result = 'power-loss';
      if (this.result) {this.throttle = 0; this.bus.submit(NO_COMMAND, 'failure'); break;}
    }
  }

  /**
   * Proximity cue for the RCS keys, in the DOCK attitude (body x = H-bar, y = R-bar, z = V-bar).
   * Waypoints in ARGO's LVLH frame: if KESTREL is not yet behind the port, climb 60 m above V-bar and drift back to a
   * staging point 25 m behind; then fly the final approach down V-bar at the docking closing speed. Each axis says
   * which way to thrust (+1 / 0 / -1) so the pilot's velocity tracks a brake-limited target velocity.
   */
  get translationCue(): {keys: V3; leg: 'hop' | 'stage' | 'final'} {
    const rel = this.dockingRelative, [x, y, z] = rel.position, [vx, vy, vz] = rel.velocity;
    const lateral = Math.hypot(x, z);
    const leg = (y > -20 && lateral > 2) || y > 0.5 ? 'hop' : y < -30 || lateral > 1.5 ? 'stage' : 'final';
    // Hop: first climb to 60 m above V-bar while holding along-track position, only then drift back past the port.
    const climbing = leg === 'hop' && x < 50;
    const target: V3 = leg === 'hop' ? [60, climbing ? y : -25, 0] : leg === 'stage' ? [0, -25, 0] : [0, 0, 0];
    const limit = (d: number) => Math.min(brakingLimit(Math.abs(d)) * 0.7, 0.05 + Math.abs(d) * 0.003, 4);
    // Inside a small position band the wanted velocity is zero, so the cue does not flicker around the axis.
    const band = leg === 'final' ? 0.08 : 1.5;
    const desired = (error: number) => Math.abs(error) < band ? 0 : Math.sign(-error) * limit(error);
    const want: V3 = [desired(x - target[0]), desired(y - target[1]), desired(z - target[2])];
    if (leg === 'final') want[1] = 0.08; // steady closing speed inside the capture envelope
    // Generous deadband: RCS is thirsty, and chattering on small errors empties the tank in minutes.
    const key = (w: number, v: number) => Math.abs(w - v) < Math.max(0.05, 0.3 * Math.abs(w)) ? 0 : Math.sign(w - v);
    return {keys: [key(want[2], vz), key(want[0], vx), key(want[1], vy)], leg};
  }

  /** Stick input wins; with the stick released the selected attitude aid flies the RCS. */
  private pilotRotation(): V3 {
    if (this.rotation.some(x => x !== 0) || this.attitudeMode === 'free') return this.rotation;
    const s = this.state;
    if (this.attitudeMode === 'stabilize') return s.w.map(w => Math.max(-1, Math.min(1, -w * 12))) as V3;
    const a = this.argo, radial = unit(a.r), along = unit(a.v);
    if (this.attitudeMode === 'dock') return attitudeHold(s, radial, along);
    if (this.attitudeMode === 'prograde') return attitudeHold(s, unit(s.v), radial);
    const rel = sub(a.v, s.v);
    // Thrust along the velocity change still needed; fall back to rate damping once matched.
    return len(rel) < 0.05 ? s.w.map(w => Math.max(-1, Math.min(1, -w * 12))) as V3 : attitudeHold(s, unit(rel), along);
  }

  get groundPosition() {
    const p = unit(inertialToBody(this.state.r, this.state.t));
    return {lat: Math.asin(p[2]) * 180 / Math.PI, lon: Math.atan2(p[1], p[0]) * 180 / Math.PI};
  }
}
