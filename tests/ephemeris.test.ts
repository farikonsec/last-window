import {describe, expect, test} from 'bun:test';
import fixture from './fixtures/horizons-hadley-2031-03-02.json';
import {angularDiameter, apply, bodiesAt, EARTH_RADIUS, earthPhase, moonFixedToEqj, skyAt, SUN_RADIUS, topocentric} from '../src/sim/ephemeris';
import {bodyToInertial, latLonToUnit} from '../src/sim/orbit';
import {R_MOON} from '../src/sim/constants';
import {dot, len, sub} from '../src/sim/vec';

const sky = skyAt(new Date(fixture.epoch));
const site = latLonToUnit(fixture.site.lat, fixture.site.lon);
const toRad = Math.PI / 180;
const separation = (a: {azimuth: number; elevation: number}, b: {azimuth: number; elevation: number}) =>
  Math.acos(Math.sin(a.elevation * toRad) * Math.sin(b.elevation * toRad)
    + Math.cos(a.elevation * toRad) * Math.cos(b.elevation * toRad) * Math.cos((a.azimuth - b.azimuth) * toRad)) / toRad;

describe('10. ephemeris against JPL Horizons', () => {
  test('Sun direction from Hadley within 0.1 degree', () => {
    expect(separation(topocentric(sky, 0, site, R_MOON, sky.sun), fixture.sun)).toBeLessThan(0.1);
  });
  test('Earth direction from Hadley within 0.1 degree', () => {
    expect(separation(topocentric(sky, 0, site, R_MOON, sky.earth), fixture.earth)).toBeLessThan(0.1);
  });
});

describe('sky geometry', () => {
  test('MCI frame is orthonormal and right-handed', () => {
    const [x, y, z] = sky.mciToEqj;
    for (const [a, b] of [[x, y], [y, z], [z, x]]) expect(Math.abs(dot(a, b))).toBeLessThan(1e-12);
    expect(len(sub([x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]], z))).toBeLessThan(1e-12);
  });
  test('sim MCI and the renderer agree on where the site is', () => {
    const t = 5400;
    const viaSim = apply(sky.mciToEqj, bodyToInertial(site, t));
    const viaRender = apply(moonFixedToEqj(sky, t), site);
    expect(len(sub(viaSim, viaRender))).toBeLessThan(1e-12);
  });
  test('Earth and Sun look the right size from the Moon', () => {
    const earthDeg = angularDiameter(EARTH_RADIUS, len(sky.earth)) / toRad;
    expect(earthDeg).toBeGreaterThan(1.8);
    expect(earthDeg).toBeLessThan(2.05);
    expect(angularDiameter(SUN_RADIUS, len(sky.sun)) / toRad).toBeCloseTo(0.53, 1);
  });
  test('Earth barely moves in the Hadley sky over a day but the Sun does', () => {
    const later = bodiesAt(sky, 86400);
    const earthMove = separation(topocentric(sky, 0, site, R_MOON, sky.earth), topocentric(sky, 86400, site, R_MOON, later.earth));
    const sunMove = separation(topocentric(sky, 0, site, R_MOON, sky.sun), topocentric(sky, 86400, site, R_MOON, later.sun));
    // Libration: Horizons gives 1.8 degrees for this day (188.09/66.59 -> 192.02/67.51).
    expect(earthMove).toBeGreaterThan(1.2);
    expect(earthMove).toBeLessThan(2.5);
    expect(sunMove).toBeGreaterThan(10);
  });
  test('mean-rate lunar rotation stays within 0.05 degree of the IAU model over a 3 h mission', () => {
    const t = 3 * 3600, truth = skyAt(new Date(sky.epoch.getTime() + t * 1000));
    const a = topocentric(sky, t, site, R_MOON, bodiesAt(sky, t).earth), b = topocentric(truth, 0, site, R_MOON, truth.earth);
    expect(separation(a, b)).toBeLessThan(0.05);
  });
  test('Earth phase is the complement of the lunar phase (morning at Hadley near first quarter)', () => {
    const phase = earthPhase(sky);
    expect(phase).toBeGreaterThan(0.2);
    expect(phase).toBeLessThan(0.5);
  });
});
