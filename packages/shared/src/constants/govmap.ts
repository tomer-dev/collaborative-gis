/**
 * govmap aerial imagery: the Survey of Israel orthophoto from govmap's legacy ArcGIS tile cache on
 * the EPSG:2039 grid (D3 option A, D22, ADR-0005). Values verified against the live CDN on
 * 2026-10-12; the resolutions are govmap's published table, kept verbatim.
 */
export const GOVMAP = {
  /** The Israeli TM Grid's EPSG code: the Leaflet CRS `code` and the proj4 definition's name. */
  EPSG: 'EPSG:2039',
  /**
   * epsg.io's EPSG:2039 definition with the EPSG:9676 datum shift (0.5 m accuracy) in `+towgs84`
   * (position-vector signs). Without `+towgs84` positions move by about 78 m; with the registry's
   * coordinate-frame signs pasted unchanged, by about 155 m.
   */
  ITM_PROJ4:
    '+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=23.772,17.49,17.859,-0.3132,-1.85274,1.67299,-5.4262 +units=m +no_defs +type=crs',
  /** Top-left corner of the tile grid in EPSG:2039 metres [x, y], as govmap's own client sets it. */
  ORIGIN: [-5403700, 7116700],
  /**
   * Metres per pixel for levels L00–L11 (1:3,000,000 to 1:500 at 96 dpi). Adjacent levels step
   * ×3, ×2.5 or ×2, not a power of two.
   */
  RESOLUTIONS: [
    793.751587503175, 264.583862501058, 132.291931250529, 66.1459656252646, 26.4583862501058,
    13.2291931250529, 6.61459656252646, 2.64583862501058, 1.32291931250529, 0.661459656252646,
    0.330729828126323, 0.13229193125052918,
  ],
  /**
   * Projected extent [[minX, minY], [maxX, maxY]] in EPSG:2039 metres: epsg.io's area of use
   * padded to take in Mt Hermon. Leaflet clips the tile range to it.
   */
  ITM_BOUNDS: [
    [100000, 350000],
    [300000, 820000],
  ],
  /** Legacy tile CDN: no Referer or Origin check, no CORS headers, missing tiles answer 403. */
  TILE_HOST: 'https://cdn.govmap.gov.il',
  /**
   * Aerial caches on `TILE_HOST`, newest first by tile `Last-Modified`: 2024-01 (the newest that
   * answers), 2023-03 (govmap's published national orthophoto config), 2022-05 (the 2021 national
   * orthophoto). The layer uses the first; the others are documented alternatives, not a runtime
   * fallback.
   */
  CACHES: ['B0BZ1ORTO23', 'M2023ORT3TS', '020522B0B20R'],
  /** Tile path level `L08`: decimal, zero-padded to this many digits. */
  TILE_LEVEL_DIGITS: 2,
  /** Tile path row `R…` and column `C…`: lowercase hex (uppercase answers 403), zero-padded. */
  TILE_INDEX_HEX_DIGITS: 8,
  /** The terms require crediting the Survey of Israel; fair use credits the portal too. */
  ATTRIBUTION:
    'Aerial imagery &copy; Survey of Israel, via <a href="https://www.govmap.gov.il/">govmap</a>',
} as const;
