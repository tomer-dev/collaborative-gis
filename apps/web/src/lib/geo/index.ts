// The aerial modules (govmap-crs, govmap-layer, projection) are left out: layer-switch.ts loads
// them on the first switch to aerial, so the map route does not carry proj4 until then.
export {
  closeRing,
  invalidReason,
  onDraw,
  toLngLat,
  type DrawEvent,
  type DrawEventType,
} from './draw-events';
export { createPolygonDraw, type PolygonDraw, type PolygonDrawOptions } from './draw-tool';
export { ringAreaKm2, ringAreaM2, type LngLat } from './geodesic';
export { hasSelfIntersection } from './self-intersection';
