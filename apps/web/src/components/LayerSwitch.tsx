import { COPY } from '@cgis/shared';
import * as L from 'leaflet';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { currentBaseLayer, switchBaseLayer, type BaseLayerId } from '../lib/geo/layer-switch';
import { IconMap, IconSatellite, MapControl, MapControlButton, type IconComponent } from '../ui';

export type LayerSwitchProps = {
  /** The map whose base layer it switches. A different map starts the control over. */
  map: L.Map;
};

const TOGGLES: readonly { id: BaseLayerId; label: string; icon: IconComponent }[] = [
  { id: 'osm', label: COPY.MAP.OSM_LABEL, icon: IconMap },
  { id: 'aerial', label: COPY.MAP.AERIAL_LABEL, icon: IconSatellite },
];

/**
 * Base-layer switch: OSM / aerial toggle buttons in a Leaflet control in the top-left corner,
 * under the zoom buttons (rendered through a portal into the control's container). The pressed
 * button is the layer asked for; `switchBaseLayer` brings the map to it.
 */
export function LayerSwitch({ map }: LayerSwitchProps) {
  // Keyed on the map: a new map starts on OSM, with a control of its own.
  return <MapLayerSwitch key={L.stamp(map)} map={map} />;
}

function MapLayerSwitch({ map }: LayerSwitchProps) {
  const [container] = useState(() => L.DomUtil.create('div'));
  const [base, setBase] = useState<BaseLayerId>(() => currentBaseLayer(map));

  useEffect(() => {
    const control = new L.Control({ position: 'topleft' });
    control.onAdd = () => container;
    // As Leaflet's own controls: a click here is not a map click (no stray draw vertex), and the
    // wheel does not zoom the map.
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, container]);

  // A newer choice aborts the switch still waiting for the aerial modules.
  useEffect(() => {
    const abort = new AbortController();
    switchBaseLayer(map, base, abort.signal).catch((error: unknown) => {
      // The aerial modules failed to load: press the button of the layer the map still shows.
      if (!abort.signal.aborted) setBase(currentBaseLayer(map));
      reportError(error);
    });
    return () => abort.abort();
  }, [map, base]);

  return createPortal(
    <MapControl label={COPY.MAP.BASE_LAYER_LABEL} orientation="horizontal">
      {TOGGLES.map(({ id, label, icon }) => (
        <MapControlButton
          key={id}
          label={label}
          icon={icon}
          pressed={base === id}
          onClick={() => setBase(id)}
        />
      ))}
    </MapControl>,
    container,
  );
}
