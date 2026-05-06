import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyButtonProps {
  text: string;
  className?: string;
}

export function CopyButton({ text, className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent fail
    }
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className={[
        'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all duration-150',
        copied
          ? 'text-success bg-success-subtle'
          : 'text-text-tertiary hover:text-text-primary hover:bg-surface-hover',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
