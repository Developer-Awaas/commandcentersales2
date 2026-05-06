import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import type { Toast as ToastItem } from '../../contexts/ToastContext';

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; bar: string }> = {
  success: {
    icon: <CheckCircle size={16} className="text-success flex-shrink-0" />,
    bar: 'bg-success',
  },
  error: {
    icon: <AlertCircle size={16} className="text-danger flex-shrink-0" />,
    bar: 'bg-danger',
  },
  info: {
    icon: <Info size={16} className="text-brand flex-shrink-0" />,
    bar: 'bg-brand',
  },
  warning: {
    icon: <AlertCircle size={16} className="text-warning flex-shrink-0" />,
    bar: 'bg-warning',
  },
};

function ToastItemComponent({ toast }: { toast: ToastItem }) {
  const { dismiss } = useToast();
  const config = TYPE_CONFIG[toast.type] ?? TYPE_CONFIG.info;

  return (
    <div
      className="bg-surface-elevated border border-border rounded-lg shadow-modal flex items-stretch overflow-hidden"
      style={{
        animation: 'slideInRight 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        minWidth: 280,
        maxWidth: 360,
      }}
    >
      <div className={`w-1 flex-shrink-0 ${config.bar}`} />
      <div className="flex items-center gap-3 px-3.5 py-3 flex-1 min-w-0">
        {config.icon}
        <p className="text-sm text-text-primary leading-snug flex-1">{toast.message}</p>
        <button
          onClick={() => dismiss(toast.id)}
          className="text-text-tertiary hover:text-text-primary transition-colors flex-shrink-0"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

export function ToastContainer() {
  const { toasts } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-5 right-5 z-[100] flex flex-col gap-2 pointer-events-none">
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(110%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItemComponent toast={t} />
        </div>
      ))}
    </div>
  );
}
