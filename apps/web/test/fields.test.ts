import { describe, expect, it } from 'vitest';
import { minutesText, parseClock, parseMinutes } from '../src/components/fields.tsx';

describe('parseClock (24-hour time fields)', () => {
  it.each([
    ['9', '09:00'],
    ['930', '09:30'],
    ['0930', '09:30'],
    ['9:5', '09:05'],
    ['13:30', '13:30'],
    ['0', '00:00'],
    ['2359', '23:59'],
  ])('%s → %s', (input, out) => expect(parseClock(input)).toBe(out));

  it.each(['24:00', '12:60', '9am', '', '12345', 'ab'])('rejects %s', (input) => expect(parseClock(input)).toBeNull());
});

describe('parseMinutes (estimates)', () => {
  it.each([
    ['1h 30m', 90],
    ['90', 90],
    ['1:30', 90],
    ['45m', 45],
    ['2h', 120],
    ['1.5h', 90],
  ])('%s → %d', (input, out) => expect(parseMinutes(input)).toBe(out));

  it('empty means no estimate and nonsense is invalid', () => {
    expect(parseMinutes('')).toBeNull();
    expect(parseMinutes('soon')).toBeUndefined();
  });

  it('formats minutes back', () => {
    expect(minutesText(90)).toBe('1h 30m');
    expect(minutesText(120)).toBe('2h');
    expect(minutesText(45)).toBe('45m');
  });
});
