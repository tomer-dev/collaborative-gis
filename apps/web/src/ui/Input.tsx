import { cva, cx, type VariantProps } from 'class-variance-authority';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { useFieldControl } from './Field';
import { focusRing } from './focus';

export const inputVariants = cva(
  [
    'block w-full min-w-0 rounded-md border border-line-control bg-bg-sunken text-fg placeholder:text-fg-subtle',
    'transition-colors duration-fast ease-standard',
    'disabled:cursor-not-allowed disabled:opacity-disabled',
    'aria-invalid:border-danger-strong',
    focusRing,
  ],
  {
    variants: {
      size: {
        sm: 'h-8 px-2 text-sm',
        md: 'h-10 px-3 text-md',
        lg: 'h-12 px-4 text-md',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>, VariantProps<typeof inputVariants> {
  /** Marks the value invalid (aria-invalid). Inside a `<Field error>` this is automatic. */
  invalid?: boolean;
}

/** Single-line text input: sm 32 / md 40 / lg 48; md and lg use 16 px text (no iOS zoom on focus). */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size, invalid, className, id, required, type = 'text', ...rest },
  ref,
) {
  const field = useFieldControl();
  const describedBy =
    [rest['aria-describedby'], field?.describedBy].filter(Boolean).join(' ') || undefined;
  const isInvalid = invalid ?? field?.invalid ?? false;
  return (
    <input
      ref={ref}
      type={type}
      {...rest}
      id={id ?? field?.id}
      required={required ?? field?.required}
      aria-describedby={describedBy}
      aria-invalid={isInvalid || undefined}
      className={cx(inputVariants({ size }), className)}
    />
  );
});
