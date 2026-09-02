import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } catch {
      setError('Sign in failed. Please try again.');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4 font-[system-ui,sans-serif]">
      <div className="w-full max-w-sm">
        {/* First frame of the app-review recording. The full lockup carries the
            company name itself, so the heading below names the product only —
            repeating "AWAAS Services Pvt. Ltd." underneath the wordmark that
            already says it reads as a template with the variable left in. */}
        <div className="flex flex-col items-center mb-8">
          <img
            src="/awaas-logo.png"
            alt="AWAAS Services Pvt. Ltd."
            width={176}
            height={167}
            className="w-44 h-auto mb-5"
          />
          <h1 className="text-xl font-semibold text-text-primary">Command Center</h1>
          <p className="text-sm text-text-tertiary mt-1">Marketing intelligence for real estate</p>
        </div>

        <div className="bg-surface-elevated border border-border rounded-xl p-6">
          <h2 className="text-base font-medium text-text-primary mb-5">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />

            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full mt-1">
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="text-center text-[11px] text-text-tertiary mt-6">
          Contact admin for login credentials
        </p>
      </div>
    </div>
  );
}
