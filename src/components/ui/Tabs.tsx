import { ReactNode } from 'react';

interface TabOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface TabsProps {
  options: TabOption[];
  value: string;
  onChange: (value: string) => void;
  variant?: 'pills' | 'underline';
}

export function Tabs({ options, value, onChange, variant = 'pills' }: TabsProps) {
  if (variant === 'underline') {
    return (
      <div className="flex border-b border-border">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={[
              'px-4 py-3 text-sm font-medium transition-all duration-150 inline-flex items-center gap-2 border-b-2 -mb-px',
              value === opt.value
                ? 'border-brand text-brand'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            ].join(' ')}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="inline-flex bg-surface-sunken rounded-lg p-1 gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={[
            'px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-150 inline-flex items-center gap-2',
            value === opt.value
              ? 'bg-surface-elevated text-text-primary shadow-card'
              : 'text-text-secondary hover:text-text-primary',
          ].join(' ')}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
