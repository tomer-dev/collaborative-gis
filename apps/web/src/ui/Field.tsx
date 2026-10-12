import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from './cx';
import { IconError } from './icons';

interface FieldControl {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldControl | null>(null);

/** The id, description ids and validity a control inside a `<Field>` should carry (null outside one). */
export function useFieldControl(): FieldControl | null {
  return useContext(FieldContext);
}

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: ReactNode;
  /** Helper text under the control, linked with aria-describedby. */
  hint?: ReactNode;
  /** Error text; marks the control aria-invalid and is linked with aria-describedby. */
  error?: ReactNode;
  required?: boolean;
  /** Id for the control; generated when omitted. */
  controlId?: string;
  /** One form control (e.g. `<Input />`); it picks up id, aria-describedby, aria-invalid and required. */
  children: ReactNode;
}

/** Label + control + hint + error, wired for assistive tech (WAI: label/for, aria-describedby). */
export const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(
  { label, hint, error, required = false, controlId, children, className, ...rest },
  ref,
) {
  const autoId = useId();
  const id = controlId ?? `${autoId}control`;
  const hintId = `${autoId}hint`;
  const errorId = `${autoId}error`;
  const hasHint = hint !== undefined && hint !== null && hint !== false;
  const hasError = error !== undefined && error !== null && error !== false;
  const describedBy = [hasHint ? hintId : null, hasError ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <FieldContext.Provider
      value={{ id, describedBy: describedBy || undefined, invalid: hasError, required }}
    >
      <div ref={ref} className={cx('flex flex-col gap-2', className)} {...rest}>
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
          {required ? (
            <span aria-hidden="true" className="text-danger-strong">
              {' *'}
            </span>
          ) : null}
        </label>
        {children}
        {hasHint ? (
          <p id={hintId} className="text-xs text-fg-muted">
            {hint}
          </p>
        ) : null}
        {hasError ? (
          <p id={errorId} className="flex items-center gap-1 text-xs text-danger-strong">
            <IconError className="size-4 shrink-0" />
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
});
