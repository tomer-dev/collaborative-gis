import { cx } from 'class-variance-authority';
import type { ReactNode } from 'react';

/** Icon components take a className for size (size-4 / size-5 / size-6) and inherit currentColor. */
export type IconComponent = (props: { className?: string }) => ReactNode;

function Svg({ className, children }: { className?: string | undefined; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cx('size-5 shrink-0', className)}
    >
      {children}
    </svg>
  );
}

export const IconCheckCircle: IconComponent = ({ className }) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" />
  </Svg>
);

export const IconWarning: IconComponent = ({ className }) => (
  <Svg className={className}>
    <path d="M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </Svg>
);

export const IconError: IconComponent = ({ className }) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15 9-6 6M9 9l6 6" />
  </Svg>
);

export const IconInfo: IconComponent = ({ className }) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </Svg>
);

export const IconClose: IconComponent = ({ className }) => (
  <Svg className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const IconPencil: IconComponent = ({ className }) => (
  <Svg className={className}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </Svg>
);

export const IconPolygon: IconComponent = ({ className }) => (
  <Svg className={className}>
    <path d="M5 9 12 4l7 5-2.5 10h-9L5 9Z" />
  </Svg>
);

export const IconPointer: IconComponent = ({ className }) => (
  <Svg className={className}>
    <path d="m5 3 14 7-6 2-2 6L5 3Z" />
  </Svg>
);

export const IconLayers: IconComponent = ({ className }) => (
  <Svg className={className}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </Svg>
);

export const IconPlus: IconComponent = ({ className }) => (
  <Svg className={className}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconMinus: IconComponent = ({ className }) => (
  <Svg className={className}>
    <path d="M5 12h14" />
  </Svg>
);
