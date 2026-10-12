# ADR-0005: govmap aerial imagery through a CRS swap to EPSG:2039

Date: 2026-10-12 · Status: accepted · Tickets: TOM-45 (spike, closed by this record), TOM-46

## Context
The product brief asks for govmap aerial imagery as a base layer. Decision D3 chose option A: swap the map's CRS to EPSG:2039 while the aerial layer is on, with no tile proxy and no fallback imagery. D22 builds that CRS with Proj4Leaflet on proj4 instead of the hand-rolled CRS ADR-0003 described. Every fact below was probed from a browser or curl on 2026-10-12 or computed with PROJ 9.5.1 and proj4 2.22.0.

**Legacy tile scheme (verified).**
- URL: `https://cdn.govmap.gov.il/<cache>/L<level, 2 decimal digits>/R<row, 8 hex digits>/C<column, 8 hex digits>.jpg`. The hex must be lowercase: `R000129A8/C0001018F` answers 403, `R000129a8/C0001018f` answers 200.
- Grid: EPSG:2039, top-left origin (−5403700, 7116700), 256 px tiles at 96 dpi, rows counted south and columns east (no TMS flip).
- Levels L00–L11 (1:3,000,000 to 1:500), 793.75 to 0.1323 m/px. Adjacent levels step ×3, ×2.5 or ×2, not a power of two.
- A missing tile (sea, outside coverage, or a level the cache lacks such as L12) answers `403` with a 111-byte XML body, not `404`.
- The CDN checks neither `Referer` nor `Origin`: every combination tried, `localhost` and `workers.dev` included, answered 200. It sends no `Access-Control-Allow-Origin`, and a CORS preflight answers 403.
- Aerial caches that answer: `B0BZ1ORTO23` (newest `Last-Modified` 2024-01-08), `M2023ORT3TS` (2023-03-27, the cache govmap's published config named "OrthoCacheNational"), `020522B0B20R` (2022-05-03).
- In a Leaflet 1.9.4 prototype the Dizengoff fountain in the L11 imagery lay about 1.9 m from its OpenStreetMap position. The H8 build loaded 12 of 12 L08 tiles with status 200 and no `Origin` header, in both the Vite dev server and the production bundle.

**The 2025 endpoint is locked to govmap's own pages.**
- The current govmap site (OpenLayers, app `1.2.0.prod-69c878da`) loads aerial imagery from `https://basemaps.govmap.gov.il/tms/orto2025me_update/{z}/{x}/{y}.jpg`, EPSG:3857 XYZ tiles.
- A CloudFront function answers `401` unless the `Referer` is `https://www.govmap.gov.il/`. Requests from `localhost`, from `workers.dev`, with no `Referer`, or with `referrerpolicy="no-referrer"` all got `401`. A curl user agent gets `403` from the WAF.
- A page cannot set `Referer`, and D3 excludes a proxy. In a real Chromium page on a `workers.dev` origin, 12 of 12 Leaflet tiles answered `401`.
- No other open raster source exists. The open GeoServer `open.govmap.gov.il/geoserver/opendata` publishes vector layers only. The Survey of Israel's data.gov.il release is 79 ZIP sheets of a 2015 2 m orthophoto with no tile service.

**Retirement risk.** The current govmap app bundle contains no reference to `cdn.govmap.gov.il`. No legacy tile found is newer than 2024-01. The 2025 orthophoto exists only on the locked endpoint. govmap can retire the legacy caches without notice.

**Terms.** These notes come from govmap's in-app terms of use; the owner ruled that demo use is acceptable.
- Clause 4 reserves all rights to the Survey of Israel (MAPI). It forbids commercial or non-personal use without MAPI's prior written approval, and its examples include linking to the government maps server.
- Clause 5: personal, non-commercial use also requires contacting MAPI, and an approved user must state that the copyright belongs to the Survey of Israel.
- Fair use under Israeli law is allowed with attribution to the document and the portal.
- Neither endpoint publishes a tile-usage policy.

**Datum shift.**
- WGS 84 and the Israel 1993 datum differ by about 66 m east and 41 m north at the ITM origin.
- The definition used is epsg.io's EPSG:2039 string with EPSG:9676 (accuracy 0.5 m) in `+towgs84`, written with position-vector signs. It matches PROJ to ≤ 0.001 m over seven control points from Eilat to Haifa; the H8 unit tests measure a 0.0006 m maximum.
- Other definitions, measured against PROJ:
  - govmap's own bundle parameters: 0.45 m.
  - An older circulating string: 2.6 m.
  - The 3-parameter EPSG:1073: about 9.8 m.
  - The spatialreference.org string with no `+towgs84`: about 78 m.
  - EPSG coordinate-frame signs pasted into `+towgs84` unchanged: about 155 m.

## Decision
The aerial layer is the legacy EPSG:2039 cache `B0BZ1ORTO23` on `cdn.govmap.gov.il`. The map's CRS is a Proj4Leaflet `L.Proj.CRS('EPSG:2039', …)` with govmap's origin, its 12 published resolutions and a padded projected extent. The tile layer is a `TileLayer` subclass whose `getTileUrl` writes the `L/R/C` path. `tms` and `crossOrigin` stay unset. There is no proxy and no fallback imagery. Overlays stay in WGS 84, and Leaflet reprojects them through the active CRS. The values live in `GOVMAP` (`packages/shared/src/constants/govmap.ts`), and `GOVMAP.CACHES` lists the two other caches as alternatives that are switched by changing the constant. With this record the spike (TOM-45) is closed.

## Consequences
- The aerial layer works from any origin today. If govmap retires the legacy caches, every aerial tile answers 403. Leaflet fires `tileerror` and keeps those tiles hidden, so the base layer goes blank while the overlays keep working. No fallback is planned (D3).
- The imagery is older than govmap's current 2025 orthophoto: the cache was last modified in 2024-01.
- The tiles are cross-origin without CORS. A canvas that draws them is tainted, so screenshot or export features cannot read their pixels.
- Zoom is integer levels L00–L11. Base-layer switching must map zooms between the 3857 and 2039 tables and reset the view (H12). Leaflet has no `setCRS`.
- proj4 and Proj4Leaflet add about 139 kB (47 kB gzip) to the map route's chunk. Proj4Leaflet has no Leaflet 2 path (D22).
- The attribution credits the Survey of Israel and govmap (`GOVMAP.ATTRIBUTION`).
