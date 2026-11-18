import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { ApiError, post } from './api.ts';
import { keys } from './queries.ts';

/** Starts a timer; if no workday is running, asks "Start workday now?" (spec decision 19) and retries. */
export function useStartTimer() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const start = useCallback(
    async (target: { projectId: string | null; taskId: string | null; kind?: 'work' | 'revision' | 'meeting'; revisionRoundId?: string | null }) => {
      setPending(true);
      setError(null);
      try {
        try {
          await post('/api/timer/start', target);
        } catch (e) {
          if (e instanceof ApiError && e.code === 'no_workday') {
            if (!window.confirm('Your workday has not started. Start your workday now?')) return;
            await post('/api/timer/start', { ...target, startWorkday: true });
          } else throw e;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not start the timer.');
      } finally {
        setPending(false);
        void qc.invalidateQueries({ queryKey: keys.timer });
        void qc.invalidateQueries({ queryKey: keys.workday });
      }
    },
    [qc],
  );
  return { start, error, pending };
}
