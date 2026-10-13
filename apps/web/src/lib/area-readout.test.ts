import { DRAW, MAP } from '@cgis/shared';
import { expect, it } from 'vitest';
import { formatStatValue } from '../ui';
import { areaDiffers, areaReadout, formatArea } from './area-readout';

it('reads whole m² below the km² threshold and km² to 3 decimals from it', () => {
  expect(areaReadout(0.26)).toEqual({ value: 260_000, unit: DRAW.M2_UNIT, decimals: 0 });
  expect(areaReadout(MAP.AREA_KM2_THRESHOLD)).toEqual({
    value: MAP.AREA_KM2_THRESHOLD,
    unit: DRAW.KM2_UNIT,
    decimals: 3,
  });
  expect(formatArea(1.2345)).toBe(`${formatStatValue(1.2345, { decimals: 3 })} ${DRAW.KM2_UNIT}`);
});

it('flags a server area more than AREA_DIFF_WARN_RATIO away from the estimate', () => {
  const server = 100;
  const within = server * (1 - MAP.AREA_DIFF_WARN_RATIO / 2);
  const beyond = server * (1 - MAP.AREA_DIFF_WARN_RATIO * 2);
  expect(areaDiffers(server, server)).toBe(false);
  expect(areaDiffers(server, within)).toBe(false);
  expect(areaDiffers(server, beyond)).toBe(true);
});
