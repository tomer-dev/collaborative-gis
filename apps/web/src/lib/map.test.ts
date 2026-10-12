import L from 'leaflet';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundsToBbox } from './map';

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
    // wrapLatLngBounds re-centres even in-range bounds, adding float noise to the longitudes.
    expect(boundsToBbox(m)).toEqual([expect.closeTo(34.7, 9), 31.9, expect.closeTo(35.0, 9), 32.2]);
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
