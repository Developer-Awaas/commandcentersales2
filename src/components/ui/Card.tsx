import { ReactNode, HTMLAttributes, forwardRef } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  selected?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children: ReactNode;
}

const paddings = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-6',
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ interactive, selected, padding = 'none', children, className = '', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={[
          'bg-surface-elevated border rounded-xl shadow-card transition-all duration-200',
          selected ? 'border-brand ring-2 ring-brand/15' : 'border-border',
          interactive && !selected ? 'cursor-pointer hover:shadow-card-hover hover:border-border-strong' : '',
          paddings[padding],
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Card.displayName = 'Card';

export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mb-4 pb-4 border-b border-border ${className}`}>{children}</div>;
}

export function CardTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h3 className={`text-base font-semibold text-text-primary ${className}`}>{children}</h3>;
}

export function CardDescription({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-sm text-text-tertiary mt-1 ${className}`}>{children}</p>;
}
