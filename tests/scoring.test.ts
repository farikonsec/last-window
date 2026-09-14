import {expect, test} from 'bun:test';
import {scoreDock, medalFor} from '../src/sim/scoring';
import {KESTREL} from '../src/sim/vehicle';

const perfect = {closingSpeed: 0.05, lateral: 0.05, misalignment: 1, rcsLeft: KESTREL.rcsPropellantCapacity * 0.98, seconds: 500};

test('a textbook dock earns gold', () => {
  const {total, medal} = scoreDock(perfect);
  expect(total).toBeGreaterThanOrEqual(90);
  expect(medal).toBe('gold');
});

test('a rough but valid dock still scores, below gold', () => {
  const {total, medal} = scoreDock({closingSpeed: 0.3, lateral: 1.0, misalignment: 12, rcsLeft: KESTREL.rcsPropellantCapacity * 0.4, seconds: 2200});
  expect(total).toBeGreaterThan(30);
  expect(total).toBeLessThan(90);
  expect(medal).not.toBe('gold');
});

test('every component is scored and gentler contact never scores worse', () => {
  const {parts} = scoreDock(perfect);
  expect(parts.map(p => p.label)).toEqual(['Contact', 'Alignment', 'RCS used', 'Time']);
  const gentle = scoreDock({...perfect, closingSpeed: 0.1}).total;
  const hard = scoreDock({...perfect, closingSpeed: 0.34}).total;
  expect(gentle).toBeGreaterThanOrEqual(hard);
});

test('medal thresholds', () => {
  expect(medalFor(95)).toBe('gold');
  expect(medalFor(75)).toBe('silver');
  expect(medalFor(50)).toBe('bronze');
});
