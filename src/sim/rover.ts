/**
 * The lunar rover: a simple ground vehicle driven over the same terrain function the lander flies against.
 *
 * Deliberately not a full tyre model. It carries speed, heading and position on the sphere, and integrates:
 * motor thrust, rolling resistance, braking, a gravity term from the local slope, and a steering rate that falls off
 * with speed (you cannot spin the wheel at full tilt). Numbers are sized on the Apollo LRV: about 13 km/h flat out.
 */
export interface RoverControls {
  /** Motor demand, 0..1. */
  throttle: number;
  /** Brake demand, 0..1. */
  brake: number;
  /** Steering, -1 (left) .. 1 (right). */
  steer: number;
}

export const NO_DRIVE: RoverControls = {throttle: 0, brake: 0, steer: 0};

/** Terrain the rover rolls on: metres of elevation at a latitude/longitude in degrees. */
export interface RoverGround {
  height(lat: number, lon: number): number;
}

export const ROVER = {
  /** Flat-ground top speed, m/s (Apollo's LRV managed about 13 km/h). */
  topSpeed: 3.6,
  /** Motor acceleration at full throttle, m/s^2. */
  power: 0.9,
  /** Braking deceleration, m/s^2. */
  braking: 1.8,
  /** Rolling resistance on regolith, m/s^2. */
  rolling: 0.22,
  /** Steering rate at a standstill, rad/s; it eases off as speed rises. */
  steerRate: 0.85,
  /** Lunar surface gravity, m/s^2. */
  gravity: 1.622,
  /** Mean lunar radius, m. */
  radius: 1_737_400,
};

const DEG = Math.PI / 180;

export class Rover {
  speed = 0;
  /** Heading in radians clockwise from north. */
  heading: number;

  constructor(public lat: number, public lon: number, headingDeg = 0) {
    this.heading = headingDeg * DEG;
  }

  /** Elevation under the wheels, metres. */
  height(ground: RoverGround) {return ground.height(this.lat, this.lon);}

  /**
   * Local downhill slope along the current heading, as a sine (positive means the nose points uphill). Sampled from
   * the shared terrain function a few metres ahead and behind, so the rover feels the same hills the lander sees.
   */
  slope(ground: RoverGround, sample = 6) {
    const ahead = this.offset(sample), behind = this.offset(-sample);
    const rise = ground.height(ahead.lat, ahead.lon) - ground.height(behind.lat, behind.lon);
    return Math.max(-1, Math.min(1, rise / (2 * sample)));
  }

  /** The latitude/longitude `distance` metres along the current heading. */
  offset(distance: number) {
    const dLat = (Math.cos(this.heading) * distance) / ROVER.radius / DEG;
    const dLon = (Math.sin(this.heading) * distance) / (ROVER.radius * Math.max(0.02, Math.cos(this.lat * DEG))) / DEG;
    return {lat: this.lat + dLat, lon: this.lon + dLon};
  }

  step(controls: RoverControls, dt: number, ground: RoverGround) {
    const slope = this.slope(ground);
    // Motor, minus rolling resistance, minus the component of gravity pulling it back down a climb.
    const drive = controls.throttle * ROVER.power;
    const resist = (this.speed > 0 ? ROVER.rolling : 0) + controls.brake * ROVER.braking;
    const gravityAlong = -slope * ROVER.gravity;
    this.speed = Math.max(0, Math.min(ROVER.topSpeed, this.speed + (drive + gravityAlong - resist) * dt));
    // Steering authority drops with speed, so hard turns need you to slow down.
    this.heading += controls.steer * ROVER.steerRate * dt * (1 - 0.6 * (this.speed / ROVER.topSpeed));
    this.heading = (this.heading + Math.PI * 2) % (Math.PI * 2);
    const moved = this.offset(this.speed * dt);
    this.lat = Math.max(-89, Math.min(89, moved.lat));
    this.lon = ((moved.lon + 540) % 360) - 180;
    return this;
  }
}
