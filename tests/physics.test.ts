import {describe, expect, test} from 'bun:test';
import {circularSpeed, escapeSpeed, G0, MU, orbitalPeriod, R_MOON, surfaceGravity} from '../src/sim/constants';
import {CommandBus, NO_COMMAND, sanitize, type ActuatorCommand} from '../src/sim/bus';
import {classifyContact, DOCKING_ENVELOPE, sweptSpheresHit, type PortContact} from '../src/sim/docking';
import {ascentGuidance, attitudeHold, DEFAULT_ASCENT} from '../src/sim/guidance';
import {circularState, inertialToBody, latLonToUnit, summarizeOrbit} from '../src/sim/orbit';
import {propagateCW, toLvlh} from '../src/sim/relative';
import {type V3, add, cross, dot, len, quatFromUpForward, rotate, scale, sub, unit} from '../src/sim/vec';
import {KESTREL, stepVehicle, totalMass, type VehicleState} from '../src/sim/vehicle';
import {FLIGHT_DT, landedAt, mothershipOrbit, simulateReferenceAscent, solveLaunchWindow} from '../src/sim/window';

const HADLEY = latLonToUnit(26.13, 3.63);
const IDLE: ActuatorCommand = {throttle: 0, translate: [0, 0, 0], rotate: [0, 0, 0]};

function orbitingState(altitude: number): VehicleState {
  const r: V3 = [R_MOON + altitude, 0, 0];
  return {
    t: 0, r, v: [0, circularSpeed(len(r)), 0], q: [1, 0, 0, 0], w: [0, 0, 0],
    mainPropellant: 0, rcsPropellant: 0, batteryKWh: 1e9, status: 'flying',
  };
}

describe('1. constants match the plan table', () => {
  test('surface gravity, escape and circular speeds, periods', () => {
    expect(surfaceGravity()).toBeCloseTo(1.624, 3);
    expect(escapeSpeed(R_MOON)).toBeCloseTo(2375.7, 0);
    expect(circularSpeed(R_MOON + 15_000)).toBeCloseTo(1672.7, 0);
    expect(circularSpeed(R_MOON + 100_000)).toBeCloseTo(1633.5, 0);
    expect(orbitalPeriod(R_MOON + 100_000) / 60).toBeCloseTo(117.8, 1);
    expect(orbitalPeriod(R_MOON + 110_000) / 60).toBeCloseTo(118.8, 1);
  });
});

describe('vector and attitude helpers', () => {
  test('quatFromUpForward puts body +Y up and +Z forward', () => {
    const up = unit([0.3, -0.5, 0.8]), fwd = unit(cross(up, [1, 0, 0]));
    const q = quatFromUpForward(up, fwd);
    expect(len(sub(rotate(q, [0, 1, 0]), up))).toBeLessThan(1e-12);
    expect(len(sub(rotate(q, [0, 0, 1]), fwd))).toBeLessThan(1e-12);
  });
});

describe('2-3. orbit integration', () => {
  test('energy and angular momentum conserved over 10 orbits at 100 km', () => {
    let s = orbitingState(100_000);
    const e0 = summarizeOrbit(s.r, s.v).energy, h0 = len(cross(s.r, s.v));
    const steps = Math.round(orbitalPeriod(len(s.r)) * 10);
    for (let i = 0; i < steps; i++) s = stepVehicle(KESTREL, s, IDLE, 1);
    expect(Math.abs((summarizeOrbit(s.r, s.v).energy - e0) / e0)).toBeLessThan(1e-7);
    expect(Math.abs((len(cross(s.r, s.v)) - h0) / h0)).toBeLessThan(1e-7);
    expect(s.status).toBe('flying');
  });

  test('integrated period matches Kepler within 0.1 s', () => {
    let s = orbitingState(100_000);
    const analytic = orbitalPeriod(len(s.r));
    let previousY = s.r[1], crossing = 0;
    for (let i = 0; i < analytic + 100; i++) {
      const next = stepVehicle(KESTREL, s, IDLE, 1);
      // Upward crossing of the +X axis (y from negative to positive, x positive) after most of a revolution.
      if (i > analytic / 2 && previousY < 0 && next.r[1] >= 0 && next.r[0] > 0) {
        crossing = s.t + (-previousY / (next.r[1] - previousY));
        break;
      }
      previousY = next.r[1];
      s = next;
    }
    expect(Math.abs(crossing - analytic)).toBeLessThan(0.1);
  });

  test('circularState matches numerical propagation', () => {
    const orbit = mothershipOrbit(HADLEY, 0);
    const start = circularState(orbit, 0);
    let s: VehicleState = {...orbitingState(100_000), r: start.r, v: start.v};
    for (let i = 0; i < 3000; i++) s = stepVehicle(KESTREL, s, IDLE, 1);
    expect(len(sub(s.r, circularState(orbit, 3000).r))).toBeLessThan(0.05);
  });
});

describe('4. rocket equation', () => {
  test('burning every kilogram of main propellant gives Isp g0 ln(m0/mf)', () => {
    let s: VehicleState = {
      t: 0, r: [1e13, 0, 0], v: [0, 0, 0], q: [1, 0, 0, 0], w: [0, 0, 0],
      mainPropellant: KESTREL.mainPropellantCapacity, rcsPropellant: KESTREL.rcsPropellantCapacity, batteryKWh: 100, status: 'flying',
    };
    const m0 = totalMass(KESTREL, s);
    while (s.mainPropellant > 0) s = stepVehicle(KESTREL, s, {...IDLE, throttle: 1}, FLIGHT_DT);
    const expected = KESTREL.mainIsp * G0 * Math.log(m0 / totalMass(KESTREL, s));
    expect(Math.abs(len(s.v) - expected) / expected).toBeLessThan(0.005);
    expect(expected).toBeGreaterThan(2950);
    expect(expected).toBeLessThan(3050);
  });
});

describe('5. ascent outcomes', () => {
  const orbit = mothershipOrbit(HADLEY, 0);
  const target = {...DEFAULT_ASCENT, planeNormal: orbit.normal};

  test('nominal reference ascent reaches a bound orbit with safe periapsis and ~100 km apoapsis', () => {
    const profile = simulateReferenceAscent(landedAt(HADLEY, 0), target);
    const o = summarizeOrbit(profile.arrival.r, profile.arrival.v);
    expect(o.bound).toBe(true);
    expect(o.periapsisAltitude).toBeGreaterThan(10_000);
    expect(Math.abs(o.apoapsisAltitude - 100_000)).toBeLessThan(1500);
    expect(profile.cutoffTime - profile.liftoffTime).toBeGreaterThan(300);
    expect(profile.cutoffTime - profile.liftoffTime).toBeLessThan(480);
    expect(profile.propellantUsed).toBeLessThan(KESTREL.mainPropellantCapacity * 0.85);
    // Arrives in the mothership's plane.
    expect(Math.abs(dot(unit(profile.arrival.r), orbit.normal))).toBeLessThan(2e-4);
  });

  test('cutting the engine early is too slow: the lander falls back and crashes', () => {
    let s = landedAt(HADLEY, 0);
    for (let t = 0; t < 180; t += FLIGHT_DT) s = stepVehicle(KESTREL, s, ascentGuidance(KESTREL, s, target, 0).command, FLIGHT_DT);
    expect(summarizeOrbit(s.r, s.v).periapsisAltitude).toBeLessThan(0);
    for (let i = 0; i < 4000 && s.status === 'flying'; i++) s = stepVehicle(KESTREL, s, IDLE, 1);
    expect(s.status).toBe('crashed');
  });

  test('burning all 3 km/s low and fast reaches lunar escape', () => {
    let s = landedAt(HADLEY, 0);
    const along = unit(cross(orbit.normal, unit(s.r)));
    while (s.mainPropellant > 0 && s.status !== 'crashed') {
      // About 19 degrees above the horizon, downrange: gains speed fast while climbing clear of the ground.
      const up = unit(s.r), dir = unit(add(scale(up, 0.35), unit(cross(orbit.normal, up))));
      const command = {throttle: 1, translate: [0, 0, 0] as V3, rotate: attitudeHold(s, s.t < 8 ? up : dir, along)};
      s = stepVehicle(KESTREL, s, command, FLIGHT_DT);
    }
    expect(s.status).toBe('flying');
    expect(summarizeOrbit(s.r, s.v).energy).toBeGreaterThanOrEqual(0);
  });
});

describe('6. launch window', () => {
  const orbit = mothershipOrbit(HADLEY, 3600);
  const window = solveLaunchWindow(HADLEY, orbit, 0, 1500);
  const relativeAt = (liftoff: number) => {
    const profile = simulateReferenceAscent(landedAt(HADLEY, liftoff), {...DEFAULT_ASCENT, planeNormal: orbit.normal});
    const ms = circularState(orbit, profile.arrivalTime);
    return toLvlh(ms.r, ms.v, profile.arrival.r, profile.arrival.v).position;
  };

  test('solved liftoff puts the lander ~1.5 km behind the mothership at apoapsis', () => {
    expect(window.liftoffTime).toBeGreaterThanOrEqual(0);
    expect(window.liftoffTime).toBeLessThan(orbitalPeriod(orbit.radius) + 60);
    expect(Math.abs(window.arrivalLead - 1500)).toBeLessThan(50);
    const rel = relativeAt(window.liftoffTime);
    expect(len(rel)).toBeGreaterThan(1000);
    expect(len(rel)).toBeLessThan(6000);
    expect(rel[1]).toBeLessThan(0); // behind: negative along-track
  });

  test('launching 5 minutes early or late misses by hundreds of kilometres', () => {
    expect(len(relativeAt(window.liftoffTime - 300))).toBeGreaterThan(200_000);
    expect(len(relativeAt(window.liftoffTime + 300))).toBeGreaterThan(200_000);
  });
});

describe('7. Clohessy-Wiltshire predictor', () => {
  test('matches full two-body integration within 1% over 10 minutes at 5 km', () => {
    const orbit = mothershipOrbit(HADLEY, 0);
    const chief0 = circularState(orbit, 0);
    const lv = toLvlh(chief0.r, chief0.v, chief0.r, chief0.v);
    expect(len(lv.position)).toBe(0);
    // Deputy 5 km behind and 400 m below, drifting.
    const x = unit(chief0.r), z = orbit.normal, y = cross(z, x);
    const offset = [-400, -5000, 150] as V3;
    const dr = [0, 1, 2].map(i => x[i] * offset[0] + y[i] * offset[1] + z[i] * offset[2]) as V3;
    const relVel = [0.4, 1.2, -0.1] as V3;
    const n = Math.sqrt(MU / orbit.radius ** 3);
    const omega = scale(orbit.normal, n);
    const dvLvlh = [0, 1, 2].map(i => x[i] * relVel[0] + y[i] * relVel[1] + z[i] * relVel[2]) as V3;
    let deputy: VehicleState = {...orbitingState(0), r: [0, 1, 2].map(i => chief0.r[i] + dr[i]) as V3,
      v: [0, 1, 2].map(i => chief0.v[i] + dvLvlh[i] + cross(omega, dr)[i]) as V3};
    const initial = toLvlh(chief0.r, chief0.v, deputy.r, deputy.v);
    for (let i = 0; i < 600; i++) deputy = stepVehicle(KESTREL, deputy, IDLE, 1);
    const chief = circularState(orbit, 600);
    const actual = toLvlh(chief.r, chief.v, deputy.r, deputy.v).position;
    const predicted = propagateCW(initial, n, 600).position;
    expect(len(sub(actual, predicted)) / len(initial.position)).toBeLessThan(0.01);
  });
});

describe('8. docking classifier', () => {
  const good: PortContact = {closingSpeed: 0.08, lateralOffset: 0.04, lateralSpeed: 0.01, misalignment: 1, rollError: 1, angularRate: 0.1};
  const cases: [string, Partial<PortContact>, string][] = [
    ['nominal', {}, 'capture'],
    ['too gentle', {closingSpeed: 0.02}, 'bounce'],
    ['at minimum closing', {closingSpeed: DOCKING_ENVELOPE.minClosing}, 'capture'],
    ['at maximum closing', {closingSpeed: DOCKING_ENVELOPE.maxClosing}, 'capture'],
    ['slightly fast', {closingSpeed: 0.16}, 'damage'],
    ['off centre', {lateralOffset: 0.2}, 'damage'],
    ['sliding sideways', {lateralSpeed: 0.06}, 'damage'],
    ['crooked', {misalignment: 4.5}, 'damage'],
    ['rolled', {rollError: 6}, 'damage'],
    ['spinning', {angularRate: 0.6}, 'damage'],
    ['ramming', {closingSpeed: 0.51}, 'destroyed'],
    ['hull strike', {lateralOffset: 0.6}, 'destroyed'],
  ];
  for (const [name, change, expected] of cases) test(name, () => expect(classifyContact({...good, ...change})).toBe(expected as never));
});

describe('9. swept collision', () => {
  test('catches a 2 km/s crossing between integration steps', () => {
    // Lander moves 2000 m in one step, passing straight through a stationary 30 m mothership.
    expect(sweptSpheresHit([-1000, 5, 0], [1000, 5, 0], [0, 0, 0], [0, 0, 0], 34.5)).toBe(true);
    expect(sweptSpheresHit([-1000, 40, 0], [1000, 40, 0], [0, 0, 0], [0, 0, 0], 34.5)).toBe(false);
  });
});

describe('landing and surface behaviour', () => {
  test('a parked lander stays landed and turns with the Moon', () => {
    let s = landedAt(HADLEY, 0);
    for (let i = 0; i < 3600; i++) s = stepVehicle(KESTREL, s, IDLE, 1);
    expect(s.status).toBe('landed');
    expect(len(sub(unit(inertialToBody(s.r, s.t)), HADLEY))).toBeLessThan(1e-9);
    expect(s.batteryKWh).toBeCloseTo(KESTREL.batteryCapacityKWh - KESTREL.baseLoadKW, 6);
  });

  test('a hard touchdown crashes, a gentle one lands', () => {
    const drop = (speed: number) => {
      let s = landedAt(HADLEY, 0);
      const up = unit(s.r);
      s = {...s, status: 'flying', r: scale(up, R_MOON + 2), v: [0, 1, 2].map(i => s.v[i] - up[i] * speed) as V3};
      for (let i = 0; i < 240 && s.status === 'flying'; i++) s = stepVehicle(KESTREL, s, IDLE, FLIGHT_DT);
      return s.status;
    };
    expect(drop(1.5)).toBe('landed');
    expect(drop(8)).toBe('crashed');
  });
});

describe('12. determinism', () => {
  test('same inputs give a bit-identical state', () => {
    const orbit = mothershipOrbit(HADLEY, 0), target = {...DEFAULT_ASCENT, planeNormal: orbit.normal};
    const run = () => {
      let s = landedAt(HADLEY, 0);
      for (let i = 0; i < 120 * 120; i++) s = stepVehicle(KESTREL, s, ascentGuidance(KESTREL, s, target, 0).command, FLIGHT_DT);
      return s;
    };
    expect(run()).toEqual(run());
  });
});

describe('13. command bus is the only path to the actuators', () => {
  test('sanitises out-of-range and NaN input', () => {
    const c = sanitize({throttle: 3, translate: [NaN, -9, 0.5], rotate: [2, 0, -2]});
    expect(c).toEqual({throttle: 1, translate: [0, -1, 0.5], rotate: [1, 0, -1]});
    expect(sanitize(NO_COMMAND).throttle).toBe(0);
  });

  test('middleware sees every command and can override it (the future hack seam)', () => {
    const bus = new CommandBus(), seen: string[] = [];
    const remove = bus.use((command, source) => {seen.push(source); return {...command, throttle: 0};});
    bus.submit({throttle: 1}, 'pilot');
    bus.submit({throttle: 1}, 'autopilot');
    expect(seen).toEqual(['pilot', 'autopilot']);
    expect(bus.read().throttle).toBe(0);
    // A locked bus keeps the lander on the pad even with the pilot at full throttle.
    let s = landedAt(HADLEY, 0);
    for (let i = 0; i < 600; i++) {bus.submit({throttle: 1}); s = stepVehicle(KESTREL, s, bus.read(), FLIGHT_DT);}
    expect(s.status).toBe('landed');
    remove();
    bus.submit({throttle: 1});
    for (let i = 0; i < 600; i++) s = stepVehicle(KESTREL, s, bus.read(), FLIGHT_DT);
    expect(s.status).toBe('flying');
  });
});
