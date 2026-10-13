import { MAP } from '@cgis/shared';
import L from 'leaflet';
import { describe, expect, it } from 'vitest';
import { createOsmLayer } from './osm-layer';

describe('createOsmLayer', () => {
  it('is the OpenStreetMap tile layer: MAP’s URL template, attribution and deepest zoom', () => {
    const layer = createOsmLayer();
    expect(layer).toBeInstanceOf(L.TileLayer);
    expect(layer).toMatchObject({ _url: MAP.OSM_TILE_URL });
    expect(layer.getAttribution?.()).toBe(MAP.OSM_ATTRIBUTION);
    expect(layer.options.maxZoom).toBe(MAP.OSM_MAX_ZOOM);
  });
});
