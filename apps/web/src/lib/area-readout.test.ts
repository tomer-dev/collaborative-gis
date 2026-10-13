import { DRAW, MAP } from '@cgis/shared';
import { expect, it } from 'vitest';
import { areaDiffers, areaReadout, formatArea } from './area-readout';

it('reads whole m² below the km² threshold and km² to 3 decimals from it', () => {
  const m2 = areaReadout(0.26);
  expect(m2).toMatchObject({ value: 260_000, unit: DRAW.M2_UNIT });
  expect(m2.format(262131.85)).toBe((262132).toLocaleString());
  expect(areaReadout(MAP.AREA_KM2_THRESHOLD)).toMatchObject({
    value: MAP.AREA_KM2_THRESHOLD,
    unit: DRAW.KM2_UNIT,
  });
  const fixed3 = (value: number) =>
    value.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  expect(formatArea(1.2345)).toBe(`${fixed3(1.2345)} ${DRAW.KM2_UNIT}`);
  expect(formatArea(12.5)).toBe(`${fixed3(12.5)} ${DRAW.KM2_UNIT}`);
});

it('flags a server area more than AREA_DIFF_WARN_RATIO away from the estimate', () => {
  const server = 100;
  const within = server * (1 - MAP.AREA_DIFF_WARN_RATIO / 2);
  const beyond = server * (1 - MAP.AREA_DIFF_WARN_RATIO * 2);
  expect(areaDiffers(server, server)).toBe(false);
  expect(areaDiffers(server, within)).toBe(false);
  expect(areaDiffers(server, beyond)).toBe(true);
});
