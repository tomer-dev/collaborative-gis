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
   * than this share (0.5 %). The client's sphere and PostGIS's spheroid differ by about 0.03 % at
   * Israel's latitude and 0.45–0.56 % at the equator or 60°N (`GEO.EARTH_RADIUS_M`).
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
   * The handler has no keyboard shortcuts, so these buttons are the keyboard path as well as the
   * pointer one.
   */
  FINISH_LABEL: 'Finish',
  UNDO_LABEL: 'Undo',
  CANCEL_LABEL: 'Cancel',
  /** Area unit suffixes (Intl.NumberFormat has no area units). */
  M2_UNIT: 'm²',
  KM2_UNIT: 'km²',
} as const;
