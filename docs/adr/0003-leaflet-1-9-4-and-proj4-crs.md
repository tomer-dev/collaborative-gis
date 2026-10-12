# ADR-0003: Leaflet 1.9.4 and a hand-rolled EPSG:2039 CRS on proj4

Date: 2026-10-12 · Status: accepted

## Context
Leaflet 2.0 is alpha (ESM-only, factory functions removed, pointer events). Proj4Leaflet last shipped in 2017 and has no Leaflet 2 path. govmap aerial tiles are served on an Israeli TM (EPSG:2039) grid; the open-data WMS has no imagery layer.

## Decision
Use Leaflet 1.9.4. Implement the EPSG:2039 CRS directly on `proj4` (projection, transformation, resolutions) and a `TileLayer` subclass overriding `getTileUrl` for govmap's level/row/column scheme. Swap the map CRS when the aerial layer is active and re-add overlays from WGS84 state (decision D3, option A). No tile proxy and no fallback provider.

## Consequences
About 50 lines of CRS code we own; portable to Leaflet 2 later. The spike (ticket 5.4) must prove A end to end; if it is technically impossible the work stops for a new decision.
