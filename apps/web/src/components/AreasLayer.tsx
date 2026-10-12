import type { Area } from '@cgis/shared';
import * as L from 'leaflet';
import { useEffect, useEffectEvent, useRef } from 'react';
import { areaPathOptions, MAP_CLASS } from '../ui';

export type AreasLayerProps = {
  /** The map to draw on; a different map starts the layer over. */
  map: L.Map;
  /** The areas to show (the viewport query's data). */
  areas: readonly Area[];
  /** The selected area's id: its polygon gets the selected style and comes to the front. */
  selectedId: string | null;
  /** Called with the area whose polygon was clicked. */
  onSelect: (area: Area) => void;
};

/**
 * Saved areas as `L.polygon`s in the areas pane (`areaPathOptions`: pane + `.map-area` class).
 * One Leaflet layer per area id, kept across renders: a data change adds new ids, removes gone
 * ids and moves a polygon only when its geometry changed. Renders nothing itself.
 */
export function AreasLayer(props: AreasLayerProps) {
  // Keyed on the map: a new map remounts the layer, so its polygon index starts empty.
  return <MapAreasLayer key={L.stamp(props.map)} {...props} />;
}

type Entry = { area: Area; polygon: L.Polygon };

/** GeoJSON `[lng, lat]` ring to Leaflet `[lat, lng]`; `L.Polygon` drops the closing vertex itself. */
function latLngs(area: Area): L.LatLng[] {
  return area.geometry.coordinates[0].map(([lng, lat]) => L.latLng(lat, lng));
}

function MapAreasLayer({ map, areas, selectedId, onSelect }: AreasLayerProps) {
  const entries = useRef(new Map<string, Entry>());
  const select = useEffectEvent((area: Area) => onSelect(area));

  // Keyed diff: Leaflet layers follow the area ids, not the render.
  useEffect(() => {
    const index = entries.current;
    const ids = new Set(areas.map((area) => area.id));
    for (const [id, entry] of index) {
      if (ids.has(id)) continue;
      entry.polygon.remove();
      index.delete(id);
    }
    for (const area of areas) {
      const entry = index.get(area.id);
      if (!entry) {
        const polygon = L.polygon(latLngs(area), areaPathOptions()).addTo(map);
        const created: Entry = { area, polygon };
        polygon.on('click', () => select(created.area));
        index.set(area.id, created);
        continue;
      }
      // Query results share unchanged parts by reference, so this is a cheap equality check.
      if (entry.area.geometry !== area.geometry) entry.polygon.setLatLngs(latLngs(area));
      entry.area = area;
    }
  }, [map, areas]);

  // Leaflet sets `className` only when it creates the path, so selection toggles the classes.
  useEffect(() => {
    for (const [id, { polygon }] of entries.current) {
      const selected = id === selectedId;
      const path = polygon.getElement();
      path?.classList.toggle(MAP_CLASS.areaSelected, selected);
      path?.classList.toggle(MAP_CLASS.area, !selected);
      if (selected) polygon.bringToFront();
    }
  }, [areas, selectedId]);

  // Unmount (or StrictMode's simulated one): take every polygon off the map.
  useEffect(() => {
    const index = entries.current;
    return () => {
      for (const { polygon } of index.values()) polygon.remove();
      index.clear();
    };
  }, []);

  return null;
}
