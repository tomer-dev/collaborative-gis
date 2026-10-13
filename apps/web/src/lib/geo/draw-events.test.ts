import { DRAW } from '@cgis/shared';
import * as L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { invalidReason, onDraw, toLngLat, type DrawEvent } from './draw-events';
import { closeRing, type LngLat } from './geodesic';

describe('onDraw', () => {
  let map: L.Map;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    map = L.map(container);
  });

  afterEach(() => {
    map.remove();
    container.remove();
  });

  it('parses the payload: a malformed draw:change throws a ZodError from map.fire', () => {
    // Our own events: a bad payload is a bug, so the subscriber throws rather than skipping it.
    const changes: DrawEvent<'draw:change'>[] = [];
    onDraw(map, 'draw:change', (e) => changes.push(e));
    expect(() => map.fire('draw:change', { vertices: [[200, 0]] })).toThrow(ZodError);
    expect(() => map.fire('draw:change', {})).toThrow(ZodError);
    expect(changes).toHaveLength(0);
    map.fire('draw:change', { vertices: [[35, 32]] });
    expect(changes[0]!.vertices).toEqual([[35, 32]]);
    expect(changes[0]!.type).toBe('draw:change');
  });

  it('returns the unsubscribe', () => {
    const cancels: unknown[] = [];
    const off = onDraw(map, 'draw:cancel', (e) => cancels.push(e));
    off();
    map.fire('draw:cancel');
    expect(cancels).toHaveLength(0);
  });
});

describe('toLngLat', () => {
  it('swaps to [lng, lat] and leaves in-range longitudes untouched', () => {
    expect(toLngLat(L.latLng(32, 35.05))).toEqual([35.05, 32]);
  });

  it('wraps a longitude from a panned world copy', () => {
    expect(toLngLat(L.latLng(32, 395))).toEqual([35, 32]);
  });
});

describe('closeRing / invalidReason', () => {
  const triangle: LngLat[] = [
    [35, 32],
    [35.05, 32],
    [35.05, 32.05],
  ];

  it('closeRing repeats the first vertex once', () => {
    expect(closeRing(triangle)).toEqual([...triangle, triangle[0]]);
    expect(closeRing(closeRing(triangle))).toEqual(closeRing(triangle));
    expect(closeRing([])).toEqual([]);
  });

  it('a triangle is valid; two vertices get the PolygonSchema reason; a bowtie the crossing reason', () => {
    expect(invalidReason(triangle)).toBeNull();
    expect(invalidReason(triangle.slice(0, 2))).toMatch(/at least 3 unique vertices/);
    const bowtie: LngLat[] = [
      [35, 32],
      [35.05, 32.05],
      [35.05, 32],
      [35, 32.05],
    ];
    expect(invalidReason(bowtie)).toBe(DRAW.SELF_INTERSECTION_REASON);
  });
});
