/**
 * The crew buggy: a fast, high-tech surface vehicle you drive across the same terrain the lander flies against.
 *
 * This is NOT the toy scalar-speed rover it replaces. It carries a real 2.5D state — a longitudinal speed, a lateral
 * slip velocity that grip bleeds off (so hard turns at speed drift), and a vertical velocity with an altitude above
 * the ground — so the sixth of a g behaves the way it should: crest a ridge fast and the buggy leaves the ground and
 * hangs, drive off a rille edge and it sails. Slopes feed straight back into speed (up costs, down pays), and a heavy
 * landing scrubs speed. The model is deliberately arcade — grip and a launch heuristic tuned to feel like the good
 * rally games, not a tyre solver — but every term is a real force, and it is pure so the tests can fly it headless.
 *
 * Everything is integrated in the local tangent plane each step and re-projected onto the sphere, exactly as the old
 * rover did, so a full lap of the Moon wraps in longitude and comes back.
 */
export interface BuggyControls {
  /** Forward motor demand, 0..1. */
  throttle: number;
  /** Brake demand, 0..1; held at a standstill it backs up. */
  brake: number;
  /** Steering, -1 (left) .. 1 (right). */
  steer: number;
  /** Boost: more power and a higher top speed while the reserve lasts. */
  turbo: boolean;
}

export const NO_DRIVE: BuggyControls = {throttle: 0, brake: 0, steer: 0, turbo: false};

/** Terrain the buggy rolls on: metres of elevation at a latitude/longitude in degrees. */
export interface BuggyGround {
  height(lat: number, lon: number): number;
}

export const BUGGY = {
  /** Flat-ground top speed under motor alone, m/s (~65 km/h — this is a purpose-built machine, not the Apollo LRV). */
  topSpeed: 18,
  /** Top speed with turbo lit, m/s (~110 km/h). */
  turboSpeed: 30,
  /** Motor acceleration at full throttle, m/s^2. */
  power: 7,
  /** Extra acceleration turbo adds, m/s^2. */
  turboPower: 9,
  /** Braking deceleration, m/s^2. */
  braking: 11,
  /** Reverse top speed, m/s. */
  reverseSpeed: 5,
  /** Rolling resistance on regolith, m/s^2. */
  rolling: 0.5,
  /** Steering rate at a standstill, rad/s; it eases off as speed rises so fast turns go wide. */
  steerRate: 1.4,
  /** How fast grip bleeds sideways slip away, per second. Lower = slides longer (more drift). */
  grip: 3.2,
  /** Slip fed in per unit of steering-times-speed; the source of the tail-out on a hard turn. */
  slipGain: 0.35,
  /** Turbo reserve drain per second while lit, and recharge per second while off (reserve is 0..1, ~8 s of boost). */
  turboDrain: 0.12,
  turboCharge: 0.05,
  /** Suspension travel, m: the wheels can reach this far below the chassis before it counts as airborne. */
  suspension: 0.45,
  /** Landing vertical speed, m/s, above which the touchdown is hard: it scrubs speed and jolts. */
  hardLanding: 8,
  /** Lunar surface gravity, m/s^2. */
  gravity: 1.622,
  /** Mean lunar radius, m. */
  radius: 1_737_400,
  /** Wheelbase used to sample slope ahead/behind, m. */
  wheelbase: 3,
};

const DEG = Math.PI / 180;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export class Buggy {
  /** Longitudinal speed along the heading, m/s (negative = reversing). */
  speed = 0;
  /** Sideways slip velocity in the body frame, m/s (the drift). */
  slip = 0;
  /** Height above the terrain directly below, m; 0 while the wheels are down. */
  altitude = 0;
  /** Vertical velocity, m/s; positive is up. Only meaningful while airborne. */
  vVert = 0;
  /** True while all wheels are off the ground. */
  airborne = false;
  /** Turbo reserve, 0..1. */
  turbo = 1;
  /** Heading in radians clockwise from north. */
  heading: number;
  /** Set for one step after a hard landing, m/s of the impact, so the caller can jolt the camera and thump audio. */
  landingImpact = 0;

  constructor(public lat: number, public lon: number, headingDeg = 0) {
    this.heading = headingDeg * DEG;
  }

  /** Ground elevation under the wheels, metres. */
  groundHeight(ground: BuggyGround) {return ground.height(this.lat, this.lon);}

  /** Absolute elevation of the chassis (ground + air gap), metres — what the render rig sits the model at. */
  chassisHeight(ground: BuggyGround) {return ground.height(this.lat, this.lon) + this.altitude;}

  /**
   * Local downhill slope along the current heading, as a sine (positive means the nose points uphill), sampled a
   * wheelbase apart from the shared terrain function so the buggy feels the same hills the lander sees.
   */
  slopeAlong(ground: BuggyGround) {
    const half = BUGGY.wheelbase / 2;
    const ahead = this.offset(half), behind = this.offset(-half);
    const rise = ground.height(ahead.lat, ahead.lon) - ground.height(behind.lat, behind.lon);
    return clamp(rise / BUGGY.wheelbase, -1, 1);
  }

  /** The latitude/longitude `distance` metres along a bearing (default: the current heading). */
  offset(distance: number, bearing = this.heading) {
    const dLat = (Math.cos(bearing) * distance) / BUGGY.radius / DEG;
    const dLon = (Math.sin(bearing) * distance) / (BUGGY.radius * Math.max(0.02, Math.cos(this.lat * DEG))) / DEG;
    return {lat: this.lat + dLat, lon: this.lon + dLon};
  }

  step(controls: BuggyControls, dt: number, ground: BuggyGround) {
    this.landingImpact = 0;
    const groundBefore = ground.height(this.lat, this.lon);

    // Turbo reserve: drains while lit and actually driving, recharges otherwise.
    const boosting = controls.turbo && this.turbo > 0 && !this.airborne;
    this.turbo = clamp(this.turbo + (boosting ? -BUGGY.turboDrain : BUGGY.turboCharge) * dt, 0, 1);

    if (!this.airborne) {
      // Wheels down: motor, resistance, slope and steering all act.
      const topSpeed = boosting ? BUGGY.turboSpeed : BUGGY.topSpeed;
      const power = BUGGY.power + (boosting ? BUGGY.turboPower : 0);
      const gravityAlong = -this.slopeAlong(ground) * BUGGY.gravity; // uphill pulls back, downhill pays out
      if (controls.throttle > 0) {
        const resist = (this.speed > 0 ? BUGGY.rolling : 0) + controls.brake * BUGGY.braking;
        this.speed = clamp(this.speed + (controls.throttle * power + gravityAlong - Math.sign(this.speed || 1) * resist) * dt, -BUGGY.reverseSpeed, topSpeed);
      } else if (controls.brake > 0) {
        // Brake to a stop, then creep backwards.
        if (this.speed > 0.05) this.speed = Math.max(0, this.speed - BUGGY.braking * dt);
        else this.speed = Math.max(-BUGGY.reverseSpeed, this.speed - BUGGY.braking * 0.4 * dt);
        this.speed += gravityAlong * dt;
      } else {
        // Coasting: rolling resistance eases it toward a stop; the slope can still run it away downhill.
        const roll = Math.sign(this.speed) * Math.min(Math.abs(this.speed), BUGGY.rolling * dt);
        this.speed = clamp(this.speed - roll + gravityAlong * dt, -BUGGY.reverseSpeed, topSpeed);
      }
      // Steering authority falls off with speed; a stationary buggy still turns on the spot slowly.
      const speedFrac = Math.min(1, Math.abs(this.speed) / BUGGY.topSpeed);
      this.heading += controls.steer * BUGGY.steerRate * dt * (0.35 + 0.65 * (1 - speedFrac)) * Math.sign(this.speed || 1);
      // Hard turns at speed throw the tail out; grip drags the slip back to zero.
      this.slip += controls.steer * BUGGY.slipGain * Math.abs(this.speed) * dt;
      this.slip -= Math.sign(this.slip) * Math.min(Math.abs(this.slip), BUGGY.grip * dt);
    } else {
      this.slip -= Math.sign(this.slip) * Math.min(Math.abs(this.slip), BUGGY.grip * dt);
    }
    this.heading = (this.heading + Math.PI * 2) % (Math.PI * 2);

    // Advance across the surface: forward along the heading, slip sideways (heading + 90°).
    const forward = this.offset(this.speed * dt), side = this.offset(this.slip * dt, this.heading + Math.PI / 2);
    this.lat = clamp(forward.lat + (side.lat - this.lat), -89, 89);
    this.lon = (((forward.lon + (side.lon - this.lon)) + 540) % 360) - 180;
    const groundAfter = ground.height(this.lat, this.lon);

    // Vertical: integrate the chassis ballistically from where it was, then let the ground catch it. One rule gives
    // both a ramp launch (climbing carries vVert up, the far side falls away) and a drive-off-the-edge drop.
    const wasAirborne = this.airborne;
    this.vVert -= BUGGY.gravity * dt;
    const worldH = groundBefore + this.altitude + this.vVert * dt;
    // Suspension travel keeps the wheels on rough or steeply-sloped ground; only a gap past it is real air, so the
    // buggy soaks up crater relief at speed instead of skipping like a stone.
    if (worldH <= groundAfter + BUGGY.suspension) {
      // On the ground. A heavy arrival off a fall scrubs speed and is reported; the wheels then track the surface's
      // own vertical velocity (signed), so a sustained slope neither floats the chassis nor snags it.
      if (wasAirborne && -this.vVert > BUGGY.hardLanding) {this.landingImpact = -this.vVert; this.speed *= 0.4; this.slip = 0;}
      this.altitude = 0;
      this.airborne = false;
      this.vVert = dt > 0 ? (groundAfter - groundBefore) / dt : 0;
    } else {
      this.altitude = worldH - groundAfter;
      this.airborne = true;
    }
    return this;
  }
}
