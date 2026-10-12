import L from 'leaflet';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bboxToKey, boundsToBbox, quantizeBbox, type Bbox } from './map';

// Slippy-map tile edges (OSM tile scheme), computed independently of the code under test.
const tileLng = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

describe('boundsToBbox', () => {
  let map: L.Map | undefined;
  afterEach(() => {
    map?.remove();
    map = undefined;
  });

  function mapShowing(bounds: L.LatLngExpression[]) {
    map = L.map(document.createElement('div'), { center: [0, 0], zoom: 0 });
    vi.spyOn(map, 'getBounds').mockReturnValue(L.latLngBounds(bounds));
    return map;
  }

  it('returns the visible bounds as [west, south, east, north]', () => {
    const m = mapShowing([
      [31.9, 34.7],
      [32.2, 35.0],
    ]);
    expect(boundsToBbox(m)).toEqual([34.7, 31.9, 35.0, 32.2]);
  });

  it('brings a view on a wrapped world copy back into [-180, 180]', () => {
    const [w, s, e, n] = boundsToBbox(
      mapShowing([
        [31.9, 394.7],
        [32.2, 395.0],
      ]),
    );
    expect(w).toBeCloseTo(34.7, 9);
    expect(e).toBeCloseTo(35.0, 9);
    expect([s, n]).toEqual([31.9, 32.2]);
  });

  it('clamps a view wider than the world to the API longitude range', () => {
    const m = mapShowing([
      [-60, -200],
      [70, 200],
    ]);
    expect(boundsToBbox(m)).toEqual([-180, -60, 180, 70]);
  });
});

describe('bboxToKey', () => {
  const israel: Bbox = [34.7, 31.9, 35.0, 32.2];

  it('names the zoom and the covering tile ranges', () => {
    // At z8, lng 34.7..35.0 lies in tile column 152 and lat 31.9..32.2 spans rows 103..104.
    expect(bboxToKey(israel, 8)).toBe('8/152-152/103-104');
  });

  it('is stable for nearby bboxes at the same zoom', () => {
    expect(bboxToKey([34.72, 31.93, 35.03, 32.21], 8)).toBe(bboxToKey(israel, 8));
  });

  it('changes when the view crosses a tile edge or the zoom changes', () => {
    expect(bboxToKey([33.7, 31.9, 35.0, 32.2], 8)).not.toBe(bboxToKey(israel, 8));
    expect(bboxToKey(israel, 9)).not.toBe(bboxToKey(israel, 8));
  });

  it('floors a fractional zoom and clamps the poles and the antimeridian to the tile grid', () => {
    expect(bboxToKey(israel, 8.7)).toBe(bboxToKey(israel, 8));
    expect(bboxToKey([-180, -90, 180, 90], 0)).toBe('0/0-0/0-0');
    expect(bboxToKey([-180, -90, 180, 90], 1)).toBe('1/0-1/0-1');
  });
});

describe('quantizeBbox', () => {
  it('snaps the bbox outward to the edges of its covering tiles', () => {
    const [w, s, e, n] = quantizeBbox([34.7, 31.9, 35.0, 32.2], 8);
    expect(w).toBeCloseTo(tileLng(152, 8), 9);
    expect(e).toBeCloseTo(tileLng(153, 8), 9);
    expect(n).toBeCloseTo(tileLat(103, 8), 9);
    expect(s).toBeCloseTo(tileLat(105, 8), 9);
  });

  it('gives every bbox with the same key the same quantized bbox', () => {
    expect(quantizeBbox([34.72, 31.93, 35.03, 32.21], 8)).toEqual(
      quantizeBbox([34.7, 31.9, 35.0, 32.2], 8),
    );
  });
});
