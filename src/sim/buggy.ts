/**
 * The crew buggy: a fast, high-tech surface vehicle you drive across the same terrain the lander flies against.
 *
 * The vertical, braking and rollover behaviour are all real low-gravity physics, not tuned feel:
 *  - It goes airborne when the ground curves away faster than gravity can hold the wheels down: over a rise of radius
 *    R the wheels leave the ground at v = sqrt(g*R) (the standard "crest" condition, centripetal demand v^2/R > g).
 *    So a sharp 15 m crater rim throws it at ~5 m/s, a 200 m hill at ~18 m/s, and a true edge at any speed.
 *  - Braking is friction-limited on the Moon: max deceleration is roughly the tyre grip times the (small) lunar g, so
 *    stops are long and slidey the way they would be up there.
 *  - It rolls over when a hard turn's lateral load passes the tip limit g*(track/2)/CoG-height. Lunar g is small, so
 *    that limit is low and fast cornering flips it, exactly as it would on the Moon.
 *
 * It also carries a longitudinal speed, a lateral slip that grip bleeds off (drift), and a vertical velocity. Pure, so
 * the tests fly it headless; integrated in the local tangent plane each step and re-projected onto the sphere, so a
 * full lap of the Moon wraps in longitude and comes back.
 */
export interface BuggyControls {
  /** Forward motor demand, 0..1. */
  throttle: number;
  /** Brake demand, 0..1; held at a standstill it backs up. */
  brake: number;
  /** Steering, -1 (left) .. 1 (right). */
  steer: number;
  /** Boost: while the reserve lasts it keeps adding thrust with no speed cap. */
  turbo: boolean;
  /** Vertical flight-thruster demand while airborne, -1 (down) .. 1 (up); positive also rights an overturned buggy. */
  lift?: number;
}

export const NO_DRIVE: BuggyControls = {throttle: 0, brake: 0, steer: 0, turbo: false, lift: 0};

/** Terrain the buggy rolls on: metres of elevation at a latitude/longitude in degrees. */
export interface BuggyGround {
  height(lat: number, lon: number): number;
}

export const BUGGY = {
  /** Flat-ground top speed under motor alone, m/s (200 km/h — a purpose-built machine, not the Apollo LRV). */
  topSpeed: 55.6,
  /** Motor acceleration at full throttle, m/s^2. */
  power: 13,
  /** Extra acceleration turbo adds while the reserve lasts (no upper speed cap — it goes as fast as the reserve). */
  turboPower: 22,
  /** Tyre-regolith friction coefficient; braking deceleration is this times the lunar gravity (so ~4 m/s^2, weak). */
  brakeGrip: 2.5,
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
  /** Vacuum-flight thrusters: forward/retro acceleration, vertical acceleration and attitude authority. */
  flightForward: 16,
  flightBoost: 2.2,
  flightLift: 8,
  flightTurnRate: 0.9,
  flightRollPower: 6.5,
  flightStabilize: 10,
  flightDamping: 6,
  rightingPower: 5,
  /** Render collision envelope measured from buggy.glb, excluding the hidden exhaust plumes. */
  hullHalfWidth: 2.35,
  hullRoofHeight: 2.65,
  hullHalfLength: 2.7,
  /** Half the track width and the centre-of-gravity height, m: their ratio times g is the rollover-tip acceleration. */
  trackHalf: 1.15,
  cgHeight: 0.85,
  /** Landing vertical speed, m/s, above which the touchdown is hard: it scrubs speed and jolts. */
  hardLanding: 8,
  /** Lunar surface gravity, m/s^2. */
  gravity: 1.622,
  /** Mean lunar radius, m. */
  radius: 1_737_400,
  /** Baseline over which slope and curvature are sampled, m — the wheels bridge anything finer, filtering ripples. */
  wheelbase: 3,
};

/** Height needed to keep the buggy's rotated hull above its contact plane. */
export function buggyContactLift(roll: number, terrainRise = 0) {
  const hull = Math.abs(Math.sin(roll)) * BUGGY.hullHalfWidth
    + Math.max(0, -Math.cos(roll)) * BUGGY.hullRoofHeight;
  return hull + Math.max(0, terrainRise);
}

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
  /** Body roll about the forward axis, radians (0 = upright); grows and flips it in a hard turn. */
  roll = 0;
  rollRate = 0;
  /** True while it is over on its side or roof and out of control, until the crew rights it. */
  flipped = false;
  private rightTimer = 0;
  /** Turbo reserve, 0..1. */
  turbo = 1;
  /** True while any airborne or righting rocket is firing; used by the HUD and sound. */
  flightThrusting = false;
  /** Heading in radians clockwise from north. */
  heading: number;
  /** Set for one step after a hard landing or flip, m/s of the impact, so the caller can jolt and thump. */
  landingImpact = 0;

  constructor(public lat: number, public lon: number, headingDeg = 0) {
    this.heading = headingDeg * DEG;
  }

  /** Ground elevation under the wheels, metres. */
  groundHeight(ground: BuggyGround) {return ground.height(this.lat, this.lon);}

  /** Absolute elevation of the chassis (ground + air gap), metres — what the render rig sits the model at. */
  chassisHeight(ground: BuggyGround) {return ground.height(this.lat, this.lon) + this.altitude;}

  /** Local downhill slope along the current heading, as a sine (positive means the nose points uphill). */
  slopeAlong(ground: BuggyGround) {
    const half = BUGGY.wheelbase / 2;
    const ahead = this.offset(half), behind = this.offset(-half);
    return clamp((ground.height(ahead.lat, ahead.lon) - ground.height(behind.lat, behind.lon)) / BUGGY.wheelbase, -1, 1);
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
    const controllable = !this.flipped && !this.airborne;
    const lift = clamp(controls.lift ?? 0, -1, 1);

    // One finite power/propellant reserve feeds both wheel boost and the compact vacuum-flight thrusters.
    const boosting = controls.turbo && controls.throttle > 0 && this.turbo > 0 && controllable;
    const airControl = this.airborne && !this.flipped && this.turbo > 0;
    const righting = this.flipped && lift > 0 && this.turbo > 0;
    const flightFiring = airControl && (controls.throttle > 0 || controls.brake > 0 || Math.abs(lift) > 0.01 || Math.abs(controls.steer) > 0.01);
    this.flightThrusting = flightFiring || righting;
    // Firing any thruster (ground boost or flight) burns the reserve; otherwise it recharges, in the air too, so
    // gliding refills for the next burn. Only an out-of-control flip pauses the recharge.
    const reserveRate = boosting || this.flightThrusting ? -BUGGY.turboDrain : this.flipped ? 0 : BUGGY.turboCharge;
    this.turbo = clamp(this.turbo + reserveRate * dt, 0, 1);

    let turn = 0;
    if (controllable) {
      const braking = BUGGY.brakeGrip * BUGGY.gravity; // friction-limited on the Moon: weak, long stops
      // The normal motor stops adding torque at its rated speed. Turbo remains thrust-limited only by its finite
      // reserve, and an already-fast buggy coasts down naturally when boost ends instead of snapping to topSpeed.
      const motorPower = controls.throttle > 0 && this.speed < BUGGY.topSpeed ? BUGGY.power * controls.throttle : 0;
      const boostPower = boosting ? BUGGY.turboPower * controls.throttle : 0;
      const gravityAlong = -this.slopeAlong(ground) * BUGGY.gravity; // uphill pulls back, downhill pays out
      if (controls.throttle > 0) {
        const resist = (this.speed > 0 ? BUGGY.rolling : 0) + controls.brake * braking;
        const wasBelowMotorLimit = this.speed <= BUGGY.topSpeed;
        this.speed += (motorPower + boostPower + gravityAlong - Math.sign(this.speed || 1) * resist) * dt;
        if (!boosting && wasBelowMotorLimit) this.speed = Math.min(BUGGY.topSpeed, this.speed);
        this.speed = Math.max(-BUGGY.reverseSpeed, this.speed);
      } else if (controls.brake > 0) {
        if (this.speed > 0.05) this.speed = Math.max(0, this.speed - braking * dt);
        else this.speed = Math.max(-BUGGY.reverseSpeed, this.speed - braking * 0.4 * dt);
        this.speed += gravityAlong * dt;
      } else {
        const roll = Math.sign(this.speed) * Math.min(Math.abs(this.speed), BUGGY.rolling * dt);
        this.speed = Math.max(-BUGGY.reverseSpeed, this.speed - roll + gravityAlong * dt);
      }
      const speedFrac = Math.min(1, Math.abs(this.speed) / BUGGY.topSpeed);
      turn = controls.steer * BUGGY.steerRate * dt * (0.35 + 0.65 * (1 - speedFrac)) * Math.sign(this.speed || 1);
      this.heading += turn;
      this.slip += controls.steer * BUGGY.slipGain * Math.abs(this.speed) * dt;
    } else if (airControl) {
      // These are rockets in vacuum, despite the short "air engine" HUD label: W/S thrust fore/aft, R/F lift or
      // descend, and A/D command a bank plus a small yaw. With Shift held the aft motor opens its high-flow valve.
      const forwardPower = BUGGY.flightForward * (controls.turbo ? BUGGY.flightBoost : 1);
      this.speed += (controls.throttle - controls.brake) * forwardPower * dt;
      this.vVert += lift * BUGGY.flightLift * dt;
      turn = controls.steer * BUGGY.flightTurnRate * dt;
      this.heading += turn;
    }
    // Grip is a damping rate, not a fixed acceleration. This preserves a visible tail-out while steering and then
    // settles it smoothly once the driver straightens the wheels.
    this.slip *= Math.exp(-BUGGY.grip * dt);
    if (!Number.isFinite(this.speed)) this.speed = 0;
    this.heading = (this.heading + Math.PI * 2) % (Math.PI * 2);

    this.rollDynamics(dt, turn, controls);

    // Advance across the surface: forward along the heading, slip sideways (heading + 90°).
    const forward = this.offset(this.speed * dt), side = this.offset(this.slip * dt, this.heading + Math.PI / 2);
    this.lat = clamp(forward.lat + (side.lat - this.lat), -89, 89);
    this.lon = (((forward.lon + (side.lon - this.lon)) + 540) % 360) - 180;
    const groundAfter = ground.height(this.lat, this.lon);

    if (this.airborne) {
      // Ballistic: gravity is the only force. Snap to the ground when it catches up.
      this.vVert -= BUGGY.gravity * dt;
      const worldH = groundBefore + this.altitude + this.vVert * dt;
      if (worldH <= groundAfter) {
        const impact = -this.vVert;
        if (impact > BUGGY.hardLanding) {this.landingImpact = impact; this.speed *= 0.4; this.slip = 0;}
        this.altitude = 0; this.vVert = 0; this.airborne = false;
      } else {
        this.altitude = worldH - groundAfter;
      }
    } else {
      // Real launch test: sample the surface curvature over the wheelbase. The wheels can hold the ground only while
      // the centripetal demand v^2 * curvature stays under gravity; past that the crest throws it (v = sqrt(g*R)).
      const half = BUGGY.wheelbase / 2;
      const hAhead = ground.height(this.offset(half).lat, this.offset(half).lon);
      const hBehind = ground.height(this.offset(-half).lat, this.offset(-half).lon);
      const convexity = (hAhead + hBehind - 2 * groundAfter) / (half * half); // <0 over a crest
      const demand = this.speed * this.speed * -convexity; // downward accel the surface asks for at a crest
      if (demand > BUGGY.gravity && Math.abs(this.speed) > 1) {
        this.airborne = true;
        this.vVert = this.speed * ((hAhead - hBehind) / BUGGY.wheelbase); // leave with the current vertical velocity
        this.altitude = 0.001;
      } else {
        this.altitude = 0; this.vVert = 0;
      }
    }
    return this;
  }

  /**
   * Rollover. A turn's lateral acceleration (speed times yaw rate) presses the buggy over; below the tip acceleration
   * g*(track/2)/CoG-height gravity rights it, past it the buggy passes its balance point and goes over. On the Moon g
   * is small, so the tip limit is low and hard cornering at speed flips it. Once over, the crew right it after a beat.
   */
  private rollDynamics(dt: number, turn: number, controls: BuggyControls) {
    if (this.flipped) {
      // Solid contact holds it on its side. It stays there until R fires the roof/side righting jets; those apply
      // angular acceleration rather than the old buoyant-looking interpolation through the lunar surface.
      if ((controls.lift ?? 0) > 0 && this.turbo > 0) {
        const before = Math.sign(this.roll);
        this.rollRate += -before * BUGGY.rightingPower * dt;
        this.rollRate *= Math.max(0, 1 - 1.2 * dt);
        this.roll += this.rollRate * dt;
        if (Math.sign(this.roll) !== before || Math.abs(this.roll) < 0.06) {
          this.roll = 0; this.rollRate = 0; this.flipped = false; this.rightTimer = 0; this.speed = 0;
        }
      } else {
        this.roll = Math.sign(this.roll || 1) * Math.PI / 2;
        this.rollRate = 0;
      }
      return;
    }
    // In free fall gravity acts through the centre of mass. Attitude jets actively damp an accidental launch spin;
    // A/D overrides the stabiliser to bank and yaw, so the player remains in control instead of flipping at random.
    if (this.airborne) {
      this.rollRate += (-controls.steer * BUGGY.flightRollPower - this.roll * BUGGY.flightStabilize
        - this.rollRate * BUGGY.flightDamping) * dt;
      this.roll += this.rollRate * dt;
      return;
    }
    const aTip = BUGGY.gravity * BUGGY.trackHalf / BUGGY.cgHeight;
    const tipAngle = Math.atan2(BUGGY.trackHalf, BUGGY.cgHeight); // CoG passes over the wheel here
    const latAcc = this.airborne ? 0 : this.speed * (dt > 0 ? turn / dt : 0);
    const excess = Math.max(0, Math.abs(latAcc) - aTip);
    // Lateral load tips it outward past the limit; gravity restores it below the balance angle and assists over it.
    this.rollRate += (-Math.sign(latAcc || 1) * excess / BUGGY.cgHeight) * dt;
    // Below the balance angle gravity rights it (and damping settles it); past it gravity commits the roll all the way
    // over with no damping, so it never stalls balanced on two wheels — it flips fully, then the crew right it.
    const overTip = Math.abs(this.roll) >= tipAngle;
    this.rollRate += (overTip ? Math.sign(this.roll) : -this.roll) * (BUGGY.gravity / BUGGY.cgHeight) * dt;
    if (!overTip) this.rollRate *= Math.max(0, 1 - 2.4 * dt);
    this.roll += this.rollRate * dt;
    if (Math.abs(this.roll) > Math.PI / 2) {
      // The side hits the ground and stops dead instead of continuing through it.
      this.flipped = true; this.rightTimer = 0; this.roll = Math.sign(this.roll) * Math.PI / 2; this.rollRate = 0;
      this.landingImpact = Math.max(this.landingImpact, Math.abs(this.speed) * 0.5);
      this.speed *= 0.15; this.slip = 0;
    }
  }

  /** An external jolt (hitting a rock) that shoves the buggy and can tip it. */
  jolt(deceleration: number, rollKick: number) {
    this.speed *= Math.max(0, 1 - deceleration);
    this.slip = 0;
    this.rollRate += rollKick;
    this.landingImpact = Math.max(this.landingImpact, deceleration * 12);
  }
}
