import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center min-h-[40vh] p-8 gap-4">
          <div className="w-12 h-12 rounded-xl bg-danger-subtle border border-danger-border flex items-center justify-center">
            <AlertTriangle size={22} className="text-danger-text" />
          </div>
          <div className="text-center max-w-md">
            <p className="text-sm font-semibold text-text-primary mb-1">Something went wrong</p>
            <p className="text-xs text-text-tertiary font-mono bg-surface-sunken border border-border rounded px-3 py-2 mt-2 text-left break-all">
              {this.state.error.message}
            </p>
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors"
          >
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
