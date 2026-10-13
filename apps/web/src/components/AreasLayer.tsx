import type { Area } from '@cgis/shared';
import * as L from 'leaflet';
import { useEffect, useEffectEvent } from 'react';
import { areaPathOptions } from '../ui';

export type AreasLayerProps = {
  /** The map to draw on; a different map starts the layer over. */
  map: L.Map;
  /** The areas to show (the viewport query's data). */
  areas: readonly Area[];
  /** The selected area's id: its polygon gets the selected style and comes to the front. */
  selectedId: string | null;
  /** Called with the area whose polygon was clicked. */
  onSelect: (area: Area) => void;
  /** Optimistic areas still being created (`usePendingAreaIds`): drawn, but a click ignores them. */
  pendingIds?: ReadonlySet<string>;
};

const NO_PENDING: ReadonlySet<string> = new Set();

/**
 * Saved areas as one `L.geoJSON` layer in the areas pane (`areaPathOptions`: pane + `.map-area`
 * class); the selected area's polygon gets the selected class and comes to the front. Rebuilt on
 * every data or selection change. Renders nothing itself.
 */
export function AreasLayer({
  map,
  areas,
  selectedId,
  onSelect,
  pendingIds = NO_PENDING,
}: AreasLayerProps) {
  const select = useEffectEvent((area: Area) => {
    if (!pendingIds.has(area.id)) onSelect(area);
  });

  useEffect(() => {
    let selected: L.Layer | undefined;
    const features = areas.map((area) => ({
      type: 'Feature' as const,
      geometry: area.geometry,
      properties: area,
    }));
    const layer = L.geoJSON<Area>(features, {
      // Leaflet sets `className` (and the pane) only when it creates the path.
      style: (feature) => areaPathOptions(feature?.properties.id === selectedId),
      onEachFeature: (feature, path) => {
        path.on('click', () => select(feature.properties));
        if (feature.properties.id === selectedId) selected = path;
      },
    }).addTo(map);
    if (selected instanceof L.Path) selected.bringToFront();
    return () => {
      layer.remove();
    };
  }, [map, areas, selectedId]);

  return null;
}
