import { MAP } from '@cgis/shared';
import type { PathOptions } from 'leaflet';

/** Classes in src/styles/map.css; their colours and widths are the --map-* tokens. */
export const MAP_CLASS = {
  area: 'map-area',
  areaSelected: 'map-area-selected',
  draft: 'cgis-draw-sketch',
  ghost: 'map-ghost',
} as const;

/** Saved polygon, in the areas pane. */
export function areaPathOptions(selected = false): PathOptions {
  return {
    pane: MAP.AREAS_PANE,
    className: selected ? MAP_CLASS.areaSelected : MAP_CLASS.area,
  };
}

/** The polygon you are drawing, in the drafts pane: accent colour from map.css, shape from MAP.DRAFT_STYLE. */
export function draftPathOptions(): PathOptions {
  return { pane: MAP.DRAFTS_PANE, className: MAP_CLASS.draft, ...MAP.DRAFT_STYLE };
}

/** Another user's draft in their presence hue; slots past MAP.PRESENCE_COLORS are neutral. */
export function ghostPathOptions(slot: number | null): PathOptions {
  const hasHue = slot !== null && slot >= 0 && slot < MAP.PRESENCE_COLORS.length;
  return {
    pane: MAP.DRAFTS_PANE,
    className: hasHue ? `${MAP_CLASS.ghost} ${MAP_CLASS.ghost}-${slot + 1}` : MAP_CLASS.ghost,
  };
}
