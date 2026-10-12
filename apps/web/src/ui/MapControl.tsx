import { cva, cx, type VariantProps } from 'class-variance-authority';
import { Control, DomEvent, DomUtil, type ControlPosition, type Map as LeafletMap } from 'leaflet';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import type { IconComponent } from './icons';
import { Tooltip, type TooltipProps } from './Tooltip';

/**
 * Mounts an empty Leaflet control at `position` and returns its container for a portal. Clicks and
 * wheel events inside it do not reach the map.
 */
export function useLeafletControlContainer(
  map: LeafletMap | null | undefined,
  position: ControlPosition,
): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!map) return;
    const control = new Control({ position });
    control.onAdd = () => {
      const element = DomUtil.create('div');
      DomEvent.disableClickPropagation(element);
      DomEvent.disableScrollPropagation(element);
      return element;
    };
    control.addTo(map);
    setContainer(control.getContainer() ?? null);
    return () => {
      control.remove();
      setContainer(null);
    };
  }, [map, position]);
  return container;
}

export const mapControlVariants = cva(
  'inline-flex gap-1 rounded-md border border-line bg-bg-raised p-1 text-fg shadow-raised',
  {
    variants: {
      orientation: {
        vertical: 'flex-col',
        horizontal: 'flex-row',
      },
    },
    defaultVariants: { orientation: 'vertical' },
  },
);

export interface MapControlProps
  extends
    Omit<HTMLAttributes<HTMLDivElement>, 'children'>,
    VariantProps<typeof mapControlVariants> {
  /** Accessible name of the toolbar ("Drawing tools"). */
  label: string;
  /** MapControlButtons. */
  children: ReactNode;
  /** With a map, the toolbar mounts inside a Leaflet control at `position`; without, it renders inline. */
  map?: LeafletMap | null;
  position?: ControlPosition;
}

const ITEM_SELECTOR = 'button:not(:disabled)';

/**
 * Map toolbar (WAI-APG toolbar pattern): one Tab stop; arrow keys along the orientation move
 * between buttons, Home and End jump to the ends. Optionally wraps itself in a Leaflet control.
 */
export const MapControl = forwardRef<HTMLDivElement, MapControlProps>(function MapControl(
  {
    label,
    children,
    map,
    position = 'topleft',
    orientation,
    className,
    onKeyDown,
    onFocus,
    ...rest
  },
  forwardedRef,
) {
  const ref = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => ref.current as HTMLDivElement);
  const [active, setActive] = useState(0);
  const container = useLeafletControlContainer(map, position);
  const vertical = (orientation ?? 'vertical') === 'vertical';

  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);

  // Roving tabindex: only the active button is in the Tab order.
  useLayoutEffect(() => {
    const all = items();
    const current = Math.min(active, all.length - 1);
    all.forEach((item, index) => {
      item.tabIndex = index === current ? 0 : -1;
    });
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    const all = items();
    const index = all.indexOf(event.target as HTMLElement);
    if (index < 0 || all.length === 0) return;
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    const previous = vertical ? 'ArrowUp' : 'ArrowLeft';
    let target: number;
    if (event.key === next) target = (index + 1) % all.length;
    else if (event.key === previous) target = (index - 1 + all.length) % all.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = all.length - 1;
    else return;
    event.preventDefault();
    setActive(target);
    all[target]?.focus();
  };

  const toolbar = (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={cx(mapControlVariants({ orientation }), className)}
      onKeyDown={handleKeyDown}
      onFocus={(event) => {
        onFocus?.(event);
        const index = items().indexOf(event.target as HTMLElement);
        if (index >= 0) setActive(index);
      }}
      {...rest}
    >
      {children}
    </div>
  );

  if (map === undefined) return toolbar;
  return container ? createPortal(toolbar, container) : null;
});

export interface MapControlButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  /** Name of the action; shown as the tooltip and used as the button's accessible name. */
  label: string;
  icon: IconComponent;
  /** Toggle state for mode buttons (e.g. "Draw polygon"); omit for one-shot actions. */
  pressed?: boolean;
  tooltipSide?: TooltipProps['side'];
}

/** Icon-only 40 x 40 toolbar button whose name comes from its tooltip. */
export const MapControlButton = forwardRef<HTMLButtonElement, MapControlButtonProps>(
  function MapControlButton(
    { label, icon, pressed, tooltipSide = 'right', className, ...rest },
    ref,
  ) {
    return (
      <Tooltip content={label} side={tooltipSide} relation="label">
        <Button
          ref={ref}
          variant="ghost"
          icon={icon}
          aria-pressed={pressed}
          className={cx(
            'aria-pressed:bg-primary aria-pressed:text-primary-fg aria-pressed:enabled:hover:bg-primary-hover aria-pressed:enabled:active:bg-primary-active',
            className,
          )}
          {...rest}
        />
      </Tooltip>
    );
  },
);
