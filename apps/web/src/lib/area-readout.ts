import { DRAW, MAP } from '@cgis/shared';
import { formatStatValue } from '../ui';

const M2_PER_KM2 = 1e6;

/** An area as `Stat` props, `DrawControl`'s rule: whole m² below `MAP.AREA_KM2_THRESHOLD`, else km² to 3 decimals. */
export type AreaReadout = { value: number; unit: string; decimals: number };

export function areaReadout(km2: number): AreaReadout {
  if (km2 >= MAP.AREA_KM2_THRESHOLD) return { value: km2, unit: DRAW.KM2_UNIT, decimals: 3 };
  return { value: km2 * M2_PER_KM2, unit: DRAW.M2_UNIT, decimals: 0 };
}

/** The same readout as one string in the user's locale, e.g. `1.234 km²` or `12,345 m²`. */
export function formatArea(km2: number): string {
  const { value, unit, decimals } = areaReadout(km2);
  return `${formatStatValue(value, { decimals })} ${unit}`;
}

/** True when the server's area and the client estimate differ by more than `MAP.AREA_DIFF_WARN_RATIO` of the server's. */
export function areaDiffers(serverKm2: number, estimateKm2: number): boolean {
  return Math.abs(serverKm2 - estimateKm2) > serverKm2 * MAP.AREA_DIFF_WARN_RATIO;
}
