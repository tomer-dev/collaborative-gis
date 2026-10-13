/** Leaflet map defaults; DEFAULT_CENTER is Leaflet's [lat, lng] order. */
export const MAP = {
  /** Israel, the demo region. */
  DEFAULT_CENTER: [31.5, 34.9],
  /** Whole country visible. */
  DEFAULT_ZOOM: 8,
  /** OSM standard tiles. */
  OSM_TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  /** Required by the OSM tile usage policy. */
  OSM_ATTRIBUTION:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  /** Highest zoom OSM serves. */
  OSM_MAX_ZOOM: 19,
  /**
   * Web Mercator metres per pixel at zoom 0 on the equator: 2π × 6,378,137 m / 256 px. Times
   * cos(latitude) / 2^zoom it is OSM's ground resolution, which the layer switch matches to the
   * nearest `GOVMAP.RESOLUTIONS` level.
   */
  OSM_Z0_METRES_PER_PIXEL: 156543.03392804097,
  /**
   * Base-layer switch: the new base layer fades in over a still copy of the old one for this long,
   * with no fade under prefers-reduced-motion. tokens.css `--transition-duration-slow` mirrors it
   * (drift-tested).
   */
  CROSSFADE_MS: 300,
  /** Saved areas' pane: above the tiles and Leaflet's overlay pane (400). */
  AREAS_PANE: 'areas',
  /** `AREAS_PANE`'s z-index; tokens.css `--z-index-map-areas` mirrors it (drift-tested). */
  AREAS_PANE_Z: 450,
  /** Live drafts' pane: above the saved areas. */
  DRAFTS_PANE: 'drafts',
  /** `DRAFTS_PANE`'s z-index; tokens.css `--z-index-map-drafts` mirrors it (drift-tested). */
  DRAFTS_PANE_Z: 460,
  /** One fetch per pan gesture. */
  MOVEEND_DEBOUNCE_MS: 250,
  /** An area picked in the panel's list: the map fits its bounds with this much room on each side (px). */
  FIT_PADDING_PX: 48,
  /** The 8-hue CVD-checked presence palette from the design-system brief (Grid 4). */
  PRESENCE_COLORS: [
    '#2a78d6',
    '#eb6834',
    '#1baf7a',
    '#eda100',
    '#e87ba4',
    '#008300',
    '#6250d6',
    '#e34948',
  ],
  /**
   * Vertex handle hit box (Leaflet icon size): the WCAG 2.5.8 target size (≥ 24 CSS px) for
   * dragging a vertex. The dot's radius, ring and colours are CSS (`.cgis-draw-handle` in map.css).
   */
  HANDLE_HIT_PX: 24,
  /**
   * Leaflet path options for a sketch in progress (the own draft and other users' ghosts): dashed
   * and faint, so it reads as unsaved next to solid saved areas. Design brief §4: 2 px, dashed
   * 8/4, fill 12 %. Stroke and fill colours are CSS on `.cgis-draw-sketch`.
   */
  DRAFT_STYLE: { weight: 2, dashArray: '8 4', fillOpacity: 0.12 },
  /**
   * Area readouts switch from m² to km² at this many km²: below it whole m² (`12,345 m²`), from it
   * km² to 3 decimals (`1.234 km²`). Numbers use `Stat`'s user-locale formatter.
   */
  AREA_KM2_THRESHOLD: 1,
  /**
   * After a save, a note shows the server's area and the client estimate when they differ by more
   * than this share (0.5 %). The client's sphere (`@turf/area`, WGS 84 mean radius) and PostGIS's
   * spheroid differ by about 0.03 % at Israel's latitude and 0.45–0.56 % at the equator or 60°N.
   */
  AREA_DIFF_WARN_RATIO: 0.005,
} as const;

/** Polygon draw tool: the client-side `draw:invalid` reasons and the draw control's copy. */
export const DRAW = {
  /** Client mirror of the server's `ST_IsValid` rejection. */
  SELF_INTERSECTION_REASON: 'Polygon edges must not cross or touch each other',
  /** The cap counts the closing vertex, so the UI should not promise a number here. */
  MAX_VERTICES_REASON: 'Vertex limit reached',
  /** Names the toolbar landmark around the start button. */
  TOOLBAR_LABEL: 'Drawing tools',
  /** The one action while idle. */
  START_LABEL: 'Draw polygon',
  /** The sketch becomes an area when saved. */
  PANEL_TITLE: 'New area',
  /** Visible labels; also the readouts' accessible names. */
  AREA_LABEL: 'Area',
  VERTICES_LABEL: 'Vertices',
  /**
   * Escape cancels (DrawControl); Finish and Undo have no shortcut, so these buttons are the
   * keyboard path as well as the pointer one.
   */
  FINISH_LABEL: 'Finish',
  UNDO_LABEL: 'Undo',
  CANCEL_LABEL: 'Cancel',
  /** Area unit suffixes (Intl.NumberFormat has no area units). */
  M2_UNIT: 'm²',
  KM2_UNIT: 'km²',
} as const;
