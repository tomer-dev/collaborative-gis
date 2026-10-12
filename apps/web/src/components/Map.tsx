import type { Bbox } from '@cgis/shared';
import { MAP } from '@cgis/shared/constants';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { boundsToBbox } from '../lib/map';

export type MapViewProps = {
  /**
   * Called once per Leaflet map, right after it is created with its tile layer and panes.
   * StrictMode (dev) mounts twice, so keep only the latest map; the previous one is removed.
   */
  onReady?: (map: L.Map) => void;
  /**
   * Called with the initial view on mount, then once per burst of `moveend` (debounced): the bbox
   * and the map's integer zoom.
   */
  onBoundsChange?: (bbox: Bbox, zoom: number) => void;
};

/** Leaflet map with the OSM base layer and the `areas`/`drafts` overlay panes; fills its parent. */
export function MapView({ onReady, onBoundsChange }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The map is created once per mount; callbacks are read through refs so new props never recreate it.
  const onReadyRef = useRef(onReady);
  const onBoundsChangeRef = useRef(onBoundsChange);
  useEffect(() => {
    onReadyRef.current = onReady;
    onBoundsChangeRef.current = onBoundsChange;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = L.map(container, { center: [...MAP.DEFAULT_CENTER], zoom: MAP.DEFAULT_ZOOM });
    L.tileLayer(MAP.OSM_TILE_URL, {
      attribution: MAP.OSM_ATTRIBUTION,
      maxZoom: MAP.OSM_MAX_ZOOM,
    }).addTo(map);
    // Created up front so overlays can always be added by pane name, whatever the base layer.
    map.createPane(MAP.AREAS_PANE).style.zIndex = String(MAP.AREAS_PANE_Z);
    map.createPane(MAP.DRAFTS_PANE).style.zIndex = String(MAP.DRAFTS_PANE_Z);

    const reportBounds = () =>
      onBoundsChangeRef.current?.(boundsToBbox(map), Math.round(map.getZoom()));
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const onMoveEnd = () => {
      clearTimeout(debounce);
      debounce = setTimeout(reportBounds, MAP.MOVEEND_DEBOUNCE_MS);
    };
    map.on('moveend', onMoveEnd);

    // Leaflet caches the container size; re-measure whenever the layout resizes the element.
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(container);

    onReadyRef.current?.(map);
    reportBounds();

    return () => {
      // Detach first: remove() stops a running pan animation, which fires a final moveend.
      map.off('moveend', onMoveEnd);
      clearTimeout(debounce);
      resizeObserver.disconnect();
      map.remove();
    };
  }, []);

  return <div ref={containerRef} role="region" aria-label="Map" className="h-full w-full" />;
}
