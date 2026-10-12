import { describe, expect, it } from 'vitest';
import type { LngLat } from './geodesic';
import { hasSelfIntersection } from './self-intersection';

const square: LngLat[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const bowtie: LngLat[] = [
  [0, 0],
  [1, 1],
  [1, 0],
  [0, 1],
];

describe('hasSelfIntersection', () => {
  it('is false for a square, open or closed', () => {
    expect(hasSelfIntersection(square)).toBe(false);
    expect(hasSelfIntersection([...square, square[0]!])).toBe(false);
  });

  it('is false for a triangle (every pair of edges is adjacent)', () => {
    expect(
      hasSelfIntersection([
        [0, 0],
        [1, 0],
        [0, 1],
        [0, 0],
      ]),
    ).toBe(false);
  });

  it('is true for a bowtie, open or closed', () => {
    expect(hasSelfIntersection(bowtie)).toBe(true);
    expect(hasSelfIntersection([...bowtie, bowtie[0]!])).toBe(true);
  });

  it('is true when a vertex touches a non-adjacent edge', () => {
    // (0.5, 0) lies on the edge (0,0)-(1,0).
    expect(
      hasSelfIntersection([
        [0, 0],
        [1, 0],
        [1, 1],
        [0.5, 0],
        [0, 1],
      ]),
    ).toBe(true);
  });

  it('is true when adjacent edges fold back over each other (a spike)', () => {
    expect(
      hasSelfIntersection([
        [0, 0],
        [2, 0],
        [1, 0],
        [1, 1],
      ]),
    ).toBe(true);
  });

  it('is true for a collinear (zero-area) triangle', () => {
    expect(
      hasSelfIntersection([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ).toBe(true);
  });

  it('ignores consecutive duplicate vertices (PostGIS accepts repeated points)', () => {
    expect(
      hasSelfIntersection([
        [0, 0],
        [1, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]),
    ).toBe(false);
  });

  it('is false for fewer than 3 vertices', () => {
    expect(hasSelfIntersection([])).toBe(false);
    expect(
      hasSelfIntersection([
        [0, 0],
        [1, 1],
      ]),
    ).toBe(false);
  });
});
