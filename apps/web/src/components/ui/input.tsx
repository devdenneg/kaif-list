import * as React from 'react';
import { cn } from '@/lib/utils';

interface FormFieldContextValue {
  controlId: string;
  labelId?: string;
  descriptionId?: string;
  required?: boolean;
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

/** Связывает составные контролы (Radix Select, picker, TipTap) с FormField. */
export function useFormFieldA11y(): FormFieldContextValue | null {
  return React.useContext(FormFieldContext);
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Иконка слева — поиск, календарь и т. п. */
  icon?: React.ReactNode;
  /** Не наследовать подпись и идентификатор внешнего FormField. */
  inheritFormFieldA11y?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, icon, inheritFormFieldA11y = true, type = 'text', ...props }, ref) => {
    const formFieldContext = useFormFieldA11y();
    const formField = inheritFormFieldA11y ? formFieldContext : null;
    const field = (
      <input
        {...props}
        ref={ref}
        id={props.id ?? formField?.controlId}
        type={type}
        className={cn(
          'flex h-10 w-full rounded-lg border border-input bg-surface px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow,background-color]',
          'placeholder:text-muted-foreground',
          'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 focus-visible:ring-offset-0',
          'disabled:cursor-not-allowed disabled:opacity-50',
          invalid && 'border-destructive focus-visible:ring-destructive',
          icon && 'pl-10',
          className,
        )}
        aria-labelledby={props['aria-labelledby'] ?? formField?.labelId}
        aria-describedby={props['aria-describedby'] ?? formField?.descriptionId}
        aria-invalid={invalid || props['aria-invalid'] || undefined}
        aria-required={(props['aria-required'] ?? formField?.required) || undefined}
      />
    );

    if (!icon) return field;

    return (
      <div className="relative w-full">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:size-[18px]">
          {icon}
        </span>
        {field}
      </div>
    );
  },
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => {
  const formField = useFormFieldA11y();
  return (
    <textarea
      {...props}
      ref={ref}
      id={props.id ?? formField?.controlId}
      className={cn(
        'block min-h-[96px] w-full rounded-lg border border-input bg-surface px-3 py-2.5 text-sm shadow-sm transition-[border-color,box-shadow,background-color]',
        'placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 focus-visible:ring-offset-0',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid && 'border-destructive focus-visible:ring-destructive',
        className,
      )}
      aria-labelledby={props['aria-labelledby'] ?? formField?.labelId}
      aria-describedby={props['aria-describedby'] ?? formField?.descriptionId}
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      aria-required={(props['aria-required'] ?? formField?.required) || undefined}
    />
  );
});
Textarea.displayName = 'Textarea';

export function FormField({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const generatedId = React.useId();
  const controlId = `${generatedId}-control`;
  const labelId = label ? `${generatedId}-label` : undefined;
  const descriptionId = error ? `${generatedId}-error` : hint ? `${generatedId}-hint` : undefined;

  return (
    <FormFieldContext.Provider value={{ controlId, labelId, descriptionId, required }}>
      <div className={cn('space-y-1.5', className)}>
        {label && (
          <label
            id={labelId}
            htmlFor={controlId}
            className="flex w-fit items-center gap-1 text-sm font-medium text-foreground"
          >
            {label}
            {required && (
              <span className="text-destructive" aria-hidden>
                *
              </span>
            )}
          </label>
        )}
        <div role={label ? 'group' : undefined} aria-labelledby={labelId}>
          {children}
        </div>
        {error ? (
          <p id={descriptionId} className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : hint ? (
          <p id={descriptionId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </FormFieldContext.Provider>
  );
}
