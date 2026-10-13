import { MAP, type Draft, type PresenceUser } from '@cgis/shared';
import * as L from 'leaflet';
import { useEffect } from 'react';
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
 * your own sketch but in the author's presence colour (data from the Room, written inline), redrawn
 * on every change. Renders nothing in React; the polygons live on the map.
 */
export function GhostPolygons({ map, drafts, users }: GhostPolygonsProps) {
  useEffect(() => {
    const colors = new Map(users.map((user) => [user.userId, user.color]));
    const layers = drafts.flatMap((draft) => {
      const color = colors.get(draft.userId);
      if (!color || draft.vertices.length === 0) return [];
      return [L.polygon(toLatLngs(draft), ghostStyle(color)).addTo(map)];
    });
    return () => {
      for (const layer of layers) layer.remove();
    };
  }, [map, drafts, users]);

  return null;
}
