import { SelectHTMLAttributes, forwardRef } from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
  hint?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, options, hint, error, className = '', id, ...props }, ref) => {
    const selectId = id ?? props.name ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="label">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={[
            'w-full bg-surface-elevated text-text-primary border rounded-lg px-3 py-2 text-sm transition-all duration-150 focus:outline-none appearance-none cursor-pointer',
            error
              ? 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(220,38,38,0.15)]'
              : 'border-border hover:border-border-strong focus:border-brand focus:shadow-focus',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {hint && !error && <p className="text-xs text-text-tertiary">{hint}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    );
  }
);
Select.displayName = 'Select';

export default Select;
