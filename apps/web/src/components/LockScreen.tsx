import { useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { post } from '../lib/api.ts';
import { Button } from './ui.tsx';

/**
 * The PIN lock (spec section F). Appears whenever the server says the app is locked:
 * after a restart, after the auto-lock time without use, or after "Lock now".
 */
export function LockScreen() {
  const qc = useQueryClient();
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = () => setLocked(true);
    window.addEventListener('mt:locked', on);
    return () => window.removeEventListener('mt:locked', on);
  }, []);
  useEffect(() => {
    if (locked) input.current?.focus();
  }, [locked]);
  if (!locked) return null;
  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await post('/api/auth/unlock', { pin });
      setLocked(false);
      setPin('');
      setError(null);
      void qc.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlock.');
      setPin('');
    }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="MonksTracker is locked" className="fixed inset-0 z-50 flex items-center justify-center bg-canvas">
      <form onSubmit={unlock} className="mt-themed flex w-[340px] flex-col items-center gap-4 rounded-frame border border-line bg-surface p-8 text-center">
        <span className="rounded-full bg-accent-soft p-3 text-accent-ink">
          <Lock size={22} aria-hidden="true" />
        </span>
        <h1 className="m-0 font-head text-xl font-extrabold">MonksTracker is locked</h1>
        <p className="m-0 text-sm text-text-2">Your timers keep running while it is locked.</p>
        <label htmlFor="unlock-pin" className="sr-only">
          PIN
        </label>
        <input
          ref={input}
          id="unlock-pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          className="num min-h-12 w-full rounded-field border border-line bg-surface text-center text-2xl tracking-[0.4em] focus:border-accent"
          placeholder="PIN"
        />
        {error && <p className="m-0 text-sm text-danger">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={pin.length < 4}>
          Unlock
        </Button>
      </form>
    </div>
  );
}
