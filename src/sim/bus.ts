import {type V3, clamp} from './vec';

/**
 * Actuator command for one vehicle. Everything the pilot (or an autopilot, or later a hostile implant) does to the
 * lander goes through a CommandBus as one of these; physics never reads raw input.
 */
export interface ActuatorCommand {
  /** Main engine throttle, 0..1. The engine is fixed-thrust in reality; the game allows deep throttling. */
  throttle: number;
  /** RCS translation demand per body axis, -1..1 (x right, y up, z forward). */
  translate: V3;
  /** RCS rotation demand per body axis, -1..1 (pitch about x, yaw about y, roll about z). */
  rotate: V3;
}

export const NO_COMMAND: ActuatorCommand = Object.freeze({throttle: 0, translate: [0, 0, 0], rotate: [0, 0, 0]}) as ActuatorCommand;

const axis = (v: V3): V3 => [clamp(v[0] || 0, -1, 1), clamp(v[1] || 0, -1, 1), clamp(v[2] || 0, -1, 1)];

/** Clamp every field into range and replace NaN with zero. */
export function sanitize(command: Partial<ActuatorCommand>): ActuatorCommand {
  return {
    throttle: clamp(command.throttle || 0, 0, 1),
    translate: axis(command.translate ?? [0, 0, 0]),
    rotate: axis(command.rotate ?? [0, 0, 0]),
  };
}

export interface BusListener {
  (command: ActuatorCommand, source: string): ActuatorCommand;
}

/**
 * The simulated flight computer's command path: input -> validation -> middleware -> actuators.
 * Middleware is the seam for the future security layer (locked controls, spoofed or injected commands).
 */
export class CommandBus {
  private current: ActuatorCommand = sanitize(NO_COMMAND);
  private middleware: BusListener[] = [];

  submit(command: Partial<ActuatorCommand>, source = 'pilot') {
    let next = sanitize(command);
    for (const layer of this.middleware) next = sanitize(layer(next, source));
    this.current = next;
  }

  use(layer: BusListener) {
    this.middleware.push(layer);
    return () => {this.middleware = this.middleware.filter(l => l !== layer);};
  }

  read(): ActuatorCommand {
    return this.current;
  }
}
