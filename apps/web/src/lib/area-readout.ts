import { DRAW, MAP } from '@cgis/shared';

const M2_PER_KM2 = 1e6;

/** `value` with exactly `digits` fraction digits, in the user's locale. */
const fixed = (digits: number) => (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** An area as `Stat` props, the one readout rule (DrawControl, SaveDialog, AreaPanel): whole m² below `MAP.AREA_KM2_THRESHOLD`, else km² to 3 decimals. */
export type AreaReadout = { value: number; unit: string; format: (value: number) => string };

export function areaReadout(km2: number): AreaReadout {
  if (km2 >= MAP.AREA_KM2_THRESHOLD) return { value: km2, unit: DRAW.KM2_UNIT, format: fixed(3) };
  return { value: km2 * M2_PER_KM2, unit: DRAW.M2_UNIT, format: fixed(0) };
}

/** The same readout as one string in the user's locale, e.g. `1.234 km²` or `12,345 m²`. */
export function formatArea(km2: number): string {
  const { value, unit, format } = areaReadout(km2);
  return `${format(value)} ${unit}`;
}

/** True when the server's area and the client estimate differ by more than `MAP.AREA_DIFF_WARN_RATIO` of the server's. */
export function areaDiffers(serverKm2: number, estimateKm2: number): boolean {
  return Math.abs(serverKm2 - estimateKm2) > serverKm2 * MAP.AREA_DIFF_WARN_RATIO;
}
