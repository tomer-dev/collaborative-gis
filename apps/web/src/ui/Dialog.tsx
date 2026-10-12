import { cva, cx, type VariantProps } from 'class-variance-authority';
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  type DialogHTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';

export const dialogVariants = cva(
  [
    'inset-4 m-auto w-auto rounded-lg border border-line bg-bg-raised p-0 text-fg shadow-overlay',
    'transition-opacity duration-base ease-standard starting:open:opacity-0',
    'backdrop:bg-scrim',
  ],
  {
    variants: {
      size: {
        sm: 'max-w-sm',
        md: 'max-w-md',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface DialogProps
  extends
    Omit<DialogHTMLAttributes<HTMLDialogElement>, 'open' | 'title' | 'role' | 'onClose'>,
    VariantProps<typeof dialogVariants> {
  /** Controlled: true shows the dialog modally (native `showModal`, so the page behind is inert). */
  open: boolean;
  /** Called on Escape and on any other close request; the parent sets `open` to false. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Action buttons, right-aligned; put the least destructive one first in a conflict dialog. */
  footer?: ReactNode;
  /** `alertdialog` for interruptions that need a decision (e.g. a save conflict). */
  role?: 'dialog' | 'alertdialog';
  /** Element to focus on open; defaults to the first focusable element (native behaviour). */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Modal dialog on the native `<dialog>` element (WAI-APG dialog pattern): focus moves in on open and
 * returns to the opener on close, Tab stays inside (the rest of the page is inert), Escape closes,
 * the title labels it and the description describes it.
 */
export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(function Dialog(
  {
    open,
    onClose,
    title,
    description,
    footer,
    role = 'dialog',
    initialFocusRef,
    size,
    className,
    children,
    ...rest
  },
  forwardedRef,
) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useImperativeHandle(forwardedRef, () => ref.current as HTMLDialogElement);
  const titleId = useId();
  const descriptionId = useId();
  const hasDescription = description !== undefined && description !== null && description !== false;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      initialFocusRef?.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      const opener = returnFocusRef.current;
      returnFocusRef.current = null;
      if (opener?.isConnected) opener.focus();
    }
  }, [open, initialFocusRef]);

  return (
    <dialog
      ref={ref}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      aria-describedby={hasDescription ? descriptionId : undefined}
      className={cx(dialogVariants({ size }), className)}
      onCancel={(event) => {
        // Escape: stay controlled; the parent closes us by flipping `open`.
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        // A close we did not start (form method="dialog", browser close request).
        if (open) onClose();
      }}
      {...rest}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-lg font-medium text-fg">
            {title}
          </h2>
          {hasDescription ? (
            <p id={descriptionId} className="text-sm text-fg-muted">
              {description}
            </p>
          ) : null}
        </div>
        {children}
        {footer ? <div className="flex flex-wrap justify-end gap-2 pt-2">{footer}</div> : null}
      </div>
    </dialog>
  );
});
