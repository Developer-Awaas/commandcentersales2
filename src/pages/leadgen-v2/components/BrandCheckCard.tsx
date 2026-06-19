import { ShieldCheck, ShieldAlert } from 'lucide-react';
import type { BrandVerdict } from '../contracts';

interface BrandCheckCardProps {
  verdict: BrandVerdict;
}

// Renders Diya's brand-confirm step (which kit applies, or that none does).
// Per-creative verdicts render separately, on each CreativeGrid tile.
export function BrandCheckCard({ verdict }: BrandCheckCardProps) {
  const passed = verdict.status === 'pass';

  return (
    <div
      className={[
        'rounded-xl border p-4 flex items-center gap-2.5',
        passed ? 'bg-success-subtle border-success-border' : 'bg-warning-subtle border-warning-border',
      ].join(' ')}
    >
      {passed ? (
        <ShieldCheck size={18} className="text-success flex-shrink-0" />
      ) : (
        <ShieldAlert size={18} className="text-warning flex-shrink-0" />
      )}
      <div>
        <p className={['text-[13px] font-semibold leading-tight', passed ? 'text-success-text' : 'text-warning-text'].join(' ')}>
          Brand Check — {passed ? 'Kit confirmed' : 'Needs attention'}
        </p>
        <p className="text-[11px] text-text-tertiary mt-0.5">{verdict.notes}</p>
      </div>
    </div>
  );
}
