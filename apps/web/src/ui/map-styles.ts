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

/**
 * Another user's draft in their presence colour (`PresenceUser.color`, assigned by the server).
 * Leaflet writes the colour as the path's stroke and fill; `.map-ghost` adds the token width and
 * fill alpha.
 */
export function ghostPathOptions(color: string): PathOptions {
  return { pane: MAP.DRAFTS_PANE, className: MAP_CLASS.ghost, color, fillColor: color };
}
