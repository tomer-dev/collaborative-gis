import { MAP, type Draft, type PresenceUser } from '@cgis/shared';
import * as L from 'leaflet';
import { useEffect, useRef } from 'react';
import { ghostPathOptions } from '../ui';

export type GhostPolygonsProps = {
  map: L.Map;
  /** Other users' drafts (`useRoom().drafts`). */
  drafts: Draft[];
  /** Presence, for each author's colour. A draft whose author is not in it is not drawn. */
  users: PresenceUser[];
};

/** `[lng, lat]` → Leaflet's `[lat, lng]`. */
const toLatLngs = (draft: Draft) => draft.vertices.map(([lng, lat]) => L.latLng(lat, lng));

/** The draft look (`MAP.DRAFT_STYLE`, drafts pane) in the author's server-assigned colour. */
const ghostStyle = (color: string): L.PolylineOptions => ({
  ...MAP.DRAFT_STYLE,
  ...ghostPathOptions(color),
  interactive: false,
});

/**
 * Other users' in-progress polygons, one `L.polygon` per author in `MAP.DRAFTS_PANE`, dashed like
 * your own sketch but in the author's presence colour (data from the Room, written inline).
 * Renders nothing in React; the polygons live on the map.
 */
export function GhostPolygons({ map, drafts, users }: GhostPolygonsProps) {
  const layers = useRef(new Map<string, L.Polygon>());

  useEffect(() => {
    const colors = new Map(users.map((user) => [user.userId, user.color]));
    const drawn = new Set<string>();
    for (const draft of drafts) {
      const color = colors.get(draft.userId);
      if (!color || draft.vertices.length === 0) continue;
      drawn.add(draft.userId);
      const layer = layers.current.get(draft.userId);
      if (layer) {
        layer.setLatLngs(toLatLngs(draft)).setStyle(ghostStyle(color));
      } else {
        layers.current.set(draft.userId, L.polygon(toLatLngs(draft), ghostStyle(color)).addTo(map));
      }
    }
    for (const [userId, layer] of layers.current) {
      if (drawn.has(userId)) continue;
      layer.remove();
      layers.current.delete(userId);
    }
  }, [map, drafts, users]);

  // A new map (or unmount): its polygons go. React runs cleanups before the new effects, so the
  // sync effect above then draws every ghost again on the new map.
  useEffect(() => {
    const current = layers.current;
    return () => {
      for (const layer of current.values()) layer.remove();
      current.clear();
    };
  }, [map]);

  return null;
}
