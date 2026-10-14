import type { ComponentType } from 'react';

/**
 * Icons are lucide-react, re-exported under the names the components use. Size them with a
 * className (size-4 / size-5 / size-6); they draw in currentColor and are aria-hidden unless given
 * an accessible name.
 */
export type IconComponent = ComponentType<{ className?: string }>;

export {
  CircleCheck as IconCheckCircle,
  ChevronDown as IconChevronDown,
  ChevronUp as IconChevronUp,
  X as IconClose,
  CircleX as IconError,
  Info as IconInfo,
  Layers as IconLayers,
  Map as IconMap,
  Menu as IconMenu,
  Minus as IconMinus,
  Pencil as IconPencil,
  Plus as IconPlus,
  MousePointer2 as IconPointer,
  Pentagon as IconPolygon,
  Satellite as IconSatellite,
  TriangleAlert as IconWarning,
} from 'lucide-react';
