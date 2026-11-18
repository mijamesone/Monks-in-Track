import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, post, type ApiError } from './api.ts';
import type { Catalog, Entry, ProjectSummary, Task, TimerState, WorkdaySummary } from './types.ts';

export const keys = {
  catalog: ['catalog'] as const,
  timer: ['timer'] as const,
  workday: ['workday'] as const,
  today: ['plan', 'today'] as const,
  projects: (companyId?: string) => ['projects', companyId ?? 'all'] as const,
};

export const useCatalog = () => useQuery({ queryKey: keys.catalog, queryFn: () => api<Catalog>('/api/catalog'), staleTime: 60_000 });

/** Polls every 15 s as a safety net; the display ticks locally every second (see useNow). */
export const useTimer = () => useQuery({ queryKey: keys.timer, queryFn: () => api<TimerState>('/api/timer'), refetchInterval: 15_000 });

export const useWorkday = () =>
  useQuery({
    queryKey: keys.workday,
    queryFn: () => api<{ workday: WorkdaySummary | null; carryOver: Task[] }>('/api/workday'),
    refetchInterval: 60_000,
  });

export const useToday = () => useQuery({ queryKey: keys.today, queryFn: () => api<Task[]>('/api/plan/today') });

export const useProjects = (companyId?: string) =>
  useQuery({
    queryKey: keys.projects(companyId),
    queryFn: () => api<ProjectSummary[]>(`/api/projects${companyId ? `?companyId=${companyId}` : ''}`),
  });

/** A clock that ticks every second, corrected by the server's clock so a wrong PC clock can't skew timers. */
export function useNow(serverNow?: number): number {
  const offset = useRef(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (serverNow !== undefined) offset.current = serverNow - Date.now();
  }, [serverNow]);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return Date.now() + offset.current;
}

/** Every write refreshes what it can affect: timer, workday, plan and projects. */
export function useAction<TBody, TResult>(path: string | ((b: TBody) => string), opts: { onError?: (e: ApiError) => void } = {}) {
  const qc = useQueryClient();
  return useMutation<TResult, ApiError, TBody>({
    mutationFn: (body: TBody) => post<TResult>(typeof path === 'function' ? path(body) : path, body ?? {}),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.timer });
      void qc.invalidateQueries({ queryKey: keys.workday });
      void qc.invalidateQueries({ queryKey: ['plan'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: opts.onError,
  });
}

/** Tells the server the app is open (every 30 s) and whether you interacted, for the forgotten-timer check. */
export function useHeartbeat() {
  const qc = useQueryClient();
  const touched = useRef(false);
  useEffect(() => {
    const mark = () => (touched.current = true);
    window.addEventListener('pointerdown', mark);
    window.addEventListener('keydown', mark);
    const beat = async () => {
      try {
        const res = await post<{ review: unknown }>('/api/heartbeat', { interaction: touched.current });
        touched.current = false;
        if (res.review) void qc.invalidateQueries({ queryKey: keys.timer });
      } catch {
        /* the offline banner covers this */
      }
    };
    void beat();
    const id = setInterval(beat, 30_000);
    return () => {
      clearInterval(id);
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark);
    };
  }, [qc]);
}

export interface ProjectDetail extends ProjectSummary {
  typeId: string | null;
  reportGroupId: string | null;
  priority: number;
  startDate: string | null;
  deadline: string | null;
  estimateMinutes: number | null;
  assignedBy: string | null;
  clientName: string | null;
  description: string | null;
  notes: string | null;
  archivedAt: number | null;
  totals: { total: number; direct: number; revision: number; meeting: number };
  estimate: { estimate: number | null; actual: number; remaining: number | null; overBudget: number | null };
  taskEstimateMinutes: number;
}

export interface TaskWithTime extends Task {
  sortOrder: number;
  description: string | null;
  dueDate: string | null;
  archivedAt: number | null;
  time: { own: number; total: number };
}

export interface Revision {
  id: string;
  number: number;
  title: string;
  status: 'requested' | 'in_progress' | 'done';
  requestedBy: string | null;
  requestedAt: number;
  taskId: string | null;
  timeMs: number;
}

export const useProject = (id: string) => useQuery({ queryKey: ['projects', 'detail', id], queryFn: () => api<ProjectDetail>(`/api/projects/${id}`) });
export const useProjectTasks = (id: string) =>
  useQuery({ queryKey: ['projects', 'tasks', id], queryFn: () => api<TaskWithTime[]>(`/api/projects/${id}/tasks`), enabled: !!id });
export const useRevisions = (id: string) =>
  useQuery({ queryKey: ['projects', 'revisions', id], queryFn: () => api<Revision[]>(`/api/projects/${id}/revisions`), enabled: !!id });
export const useProjectEntries = (id: string) =>
  useQuery({ queryKey: ['projects', 'entries', id], queryFn: () => api<Entry[]>(`/api/entries?from=0&to=${Date.now() + 86_400_000}&projectId=${id}`) });

/** Any write (POST, PATCH, PUT, DELETE). Refreshes everything that can depend on it. */
export function useMutate<TVars>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: (v: TVars) => string, body: (v: TVars) => unknown = (v) => v) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, TVars>({
    mutationFn: (v: TVars) => api(path(v), { method, body: method === 'DELETE' ? undefined : body(v) }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['plan'] });
      void qc.invalidateQueries({ queryKey: keys.timer });
      void qc.invalidateQueries({ queryKey: keys.workday });
      void qc.invalidateQueries({ queryKey: keys.catalog });
    },
  });
}
