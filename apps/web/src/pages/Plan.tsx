import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, ExternalLink, MoreHorizontal, Play, Plus, Search } from 'lucide-react';
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { TextInput } from '../components/fields.tsx';
import { Button, Chip, CompanyDot, EmptyState, StatusChip, companyColor } from '../components/ui.tsx';
import { useStartTimer } from '../lib/actions.ts';
import { patch, post } from '../lib/api.ts';
import { useCompany } from '../lib/company.tsx';
import { duration, MINUTE } from '../lib/format.ts';
import { useAction, useCatalog, usePlanBoard, useProjects, useTimer, type PlanBoard } from '../lib/queries.ts';
import type { Bucket, Task } from '../lib/types.ts';

const COLUMNS: { id: Bucket; title: string; empty: string }[] = [
  { id: 'backlog', title: 'Backlog', empty: 'Nothing in the backlog.' },
  { id: 'this_week', title: 'This Week', empty: 'Nothing planned for this week yet.' },
  { id: 'today', title: 'Today', empty: 'Nothing planned for today; drag from This Week or Backlog.' },
];

/** Plan (spec screen 2): Backlog, This Week and Today across projects. The top of Today is your first focus. */
export function Plan() {
  const qc = useQueryClient();
  const { companyId } = useCompany();
  const company = companyId === 'all' ? undefined : companyId;
  const board = usePlanBoard(company);
  const catalog = useCatalog();
  const projects = useProjects();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ bucket: Bucket; index: number } | null>(null);
  const dragging = useRef<string[]>([]);
  const boardKey = ['plan', 'board', company ?? 'all'] as const;

  const statuses = useMemo(() => new Map((catalog.data?.statuses ?? []).map((s) => [s.id, s])), [catalog.data]);
  const projectMap = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p])), [projects.data]);
  const s = catalog.data?.settings;
  const capacityMinutes = s ? s.fullDayMinutes - s.lunchMinutes : 480;
  const isOpen = (t: Task) => {
    const st = statuses.get(t.statusId);
    return !!st && !st.isDone && !st.isRejected;
  };

  const data = board.data;
  const q = query.trim().toLowerCase();
  const matches = (t: Task) => {
    if (!q) return true;
    const p = projectMap.get(t.projectId);
    return [t.name, t.hulyKey ?? '', p?.name ?? '', p?.reportName ?? '', data?.parents[t.parentId ?? ''] ?? ''].some((x) => x.toLowerCase().includes(q));
  };
  const columnOf = (id: string): Bucket | null => {
    if (!data) return null;
    for (const c of COLUMNS) if (data.columns[c.id].some((t) => t.id === id)) return c.id;
    return null;
  };

  /** Moves tasks optimistically; on failure the board snaps back and says so. */
  const move = async (ids: string[], bucket: Bucket, index?: number) => {
    if (!data || !ids.length) return;
    setError(null);
    const crossing = ids.some((id) => columnOf(id) !== bucket);
    const withKids = crossing && ids.some((id) => (data.subtaskCounts[id] ?? 0) > 0);
    const withSubtasks = withKids ? window.confirm('Move their open subtasks too?') : false;
    const before = data;
    const all = Object.values(data.columns).flat();
    const moving = ids.map((id) => all.find((t) => t.id === id)).filter((t): t is Task => !!t);
    const next: PlanBoard = { ...data, columns: { backlog: [], this_week: [], today: [] } };
    for (const c of COLUMNS) next.columns[c.id] = data.columns[c.id].filter((t) => !ids.includes(t.id));
    const target = next.columns[bucket];
    const at = Math.max(0, Math.min(index ?? target.length, target.length));
    next.columns[bucket] = [...target.slice(0, at), ...moving.map((t) => ({ ...t, planBucket: bucket })), ...target.slice(at)];
    qc.setQueryData(boardKey, next);
    // Anchor on the task it lands before (or the end): the stored column also holds tasks the board hides.
    const beforeTaskId = target[at]?.id ?? null;
    try {
      await post('/api/plan/move', { taskIds: ids, bucket, beforeTaskId, withSubtasks, ...(beforeTaskId ? {} : { index: Number.MAX_SAFE_INTEGER }) });
    } catch (e) {
      qc.setQueryData(boardKey, before);
      setError(`Could not move: ${e instanceof Error ? e.message : 'unknown error'}. The board was put back.`);
    } finally {
      void qc.invalidateQueries({ queryKey: ['plan'] });
    }
  };

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const ordered = (ids: string[]) => (data ? Object.values(data.columns).flat().map((t) => t.id).filter((id) => ids.includes(id)) : ids);

  const onDragStart = (e: DragEvent, id: string) => {
    const ids = selected.includes(id) ? ordered(selected) : [id];
    dragging.current = ids;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ids.join(','));
  };
  const indexAt = (e: DragEvent<HTMLElement>, bucket: Bucket) => {
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-task-id]')].filter((el) => !dragging.current.includes(el.dataset.taskId!));
    const i = cards.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    // Index among the column's tasks once the moving ones are taken out (hidden-by-search tasks count too).
    const visible = i === -1 ? cards.length : i;
    const col = (data?.columns[bucket] ?? []).filter((t) => !dragging.current.includes(t.id));
    if (visible >= cards.length) return col.length;
    const anchor = cards[visible]!.dataset.taskId!;
    return col.findIndex((t) => t.id === anchor);
  };

  const todayOpen = (data?.columns.today ?? []).filter(isOpen);
  const todayMinutes = todayOpen.reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0);
  const over = todayMinutes > capacityMinutes;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-head text-[28px] font-extrabold tracking-[-0.02em]">Plan</h1>
          <p className="m-0 text-sm text-text-2">Drag tasks between columns, or select several and move them together. The top of Today is your first focus.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            role="status"
            aria-label="Today's planned time"
            className={`num rounded-full px-3 py-1 text-sm font-semibold ${over ? 'bg-amber text-on-fill' : 'bg-surface-2 text-text-2'}`}
          >
            Today {duration(todayMinutes * MINUTE)} of {duration(capacityMinutes * MINUTE)}
            {over ? ' · over capacity' : ''}
          </span>
          <span className="relative flex items-center">
            <Search size={15} className="pointer-events-none absolute left-3 text-text-3" aria-hidden="true" />
            <TextInput aria-label="Filter tasks" placeholder="Filter by task, project or Huly key" value={query} onChange={(e) => setQuery(e.target.value)} className="w-72 pl-9" />
          </span>
        </div>
      </div>

      {selected.length > 0 && (
        <div role="toolbar" aria-label="Selected tasks" className="mt-themed sticky top-[72px] z-[5] flex flex-wrap items-center gap-2 rounded-card border border-accent bg-accent-soft px-4 py-2.5 text-sm">
          <span className="font-semibold text-accent-ink">{selected.length} selected</span>
          <span className="text-text-2">Move to</span>
          {COLUMNS.map((c) => (
            <Button key={c.id} size="sm" onClick={() => void move(ordered(selected), c.id).then(() => setSelected([]))}>
              {c.title}
            </Button>
          ))}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected([])}>
            Clear selection
          </Button>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-card bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {board.isLoading || !data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {COLUMNS.map((c) => (
            <div key={c.id} className="h-72 animate-pulse rounded-card bg-sunken" aria-label="Loading" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          {COLUMNS.map((c) => {
            const tasks = data.columns[c.id];
            const shown = tasks.filter(matches);
            const est = tasks.filter(isOpen).reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0);
            return (
              <section
                key={c.id}
                aria-label={c.title}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const index = indexAt(e, c.id);
                  if (drop?.bucket !== c.id || drop.index !== index) setDrop({ bucket: c.id, index });
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const ids = dragging.current.length ? dragging.current : e.dataTransfer.getData('text/plain').split(',').filter(Boolean);
                  const index = indexAt(e, c.id);
                  setDrop(null);
                  dragging.current = [];
                  setSelected([]);
                  void move(ids, c.id, index);
                }}
                className={`mt-themed flex min-h-[200px] flex-col gap-2 rounded-card border bg-surface p-3 transition-colors ${
                  drop?.bucket === c.id ? 'border-accent bg-accent-soft/40' : 'border-line'
                }`}
              >
                <div className="flex items-center justify-between gap-2 px-1 pb-1">
                  <h2 className="m-0 font-head text-[15px] font-bold">
                    {c.title} <span className="num font-medium text-text-3">{tasks.filter(isOpen).length}</span>
                  </h2>
                  <span className="num text-xs text-text-2">{est ? duration(est * MINUTE) : ''}</span>
                </div>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {shown.length === 0 && <li className="px-1 py-6 text-center text-sm text-text-3">{q ? 'No tasks match the filter.' : c.empty}</li>}
                  {shown.map((t) => {
                    const realIndex = tasks.findIndex((x) => x.id === t.id);
                    return (
                      <PlanCard
                        key={t.id}
                        task={t}
                        bucket={c.id}
                        parentName={t.parentId ? data.parents[t.parentId] : undefined}
                        subtasks={data.subtaskCounts[t.id] ?? 0}
                        selected={selected.includes(t.id)}
                        showDropLine={drop?.bucket === c.id && drop.index === tasks.filter((x) => !dragging.current.includes(x.id)).findIndex((x) => x.id === t.id)}
                        onToggle={() => toggle(t.id)}
                        onDragStart={(e) => onDragStart(e, t.id)}
                        onDragEnd={() => {
                          dragging.current = [];
                          setDrop(null);
                        }}
                        onMove={(bucket) => void move([t.id], bucket)}
                        onUp={realIndex > 0 ? () => void move([t.id], c.id, realIndex - 1) : undefined}
                        onDown={realIndex < tasks.length - 1 ? () => void move([t.id], c.id, realIndex + 1) : undefined}
                      />
                    );
                  })}
                  {drop?.bucket === c.id && drop.index >= tasks.filter((x) => !dragging.current.includes(x.id)).length && (
                    <li aria-hidden="true" className="h-0.5 rounded-full bg-accent" />
                  )}
                </ul>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 justify-start border-dashed text-text-2"
                  onClick={() => window.dispatchEvent(new CustomEvent('mt:quick-add', { detail: { bucket: c.id } }))}
                >
                  <Plus size={14} aria-hidden="true" /> Add to {c.title}
                </Button>
              </section>
            );
          })}
        </div>
      )}
      {!board.isLoading && data && Object.values(data.columns).every((c) => c.length === 0) && (
        <EmptyState title="Nothing to plan yet">Add tasks to your projects, or press Q to add one here.</EmptyState>
      )}
    </div>
  );
}

function PlanCard({
  task,
  bucket,
  parentName,
  subtasks,
  selected,
  showDropLine,
  onToggle,
  onDragStart,
  onDragEnd,
  onMove,
  onUp,
  onDown,
}: {
  task: Task;
  bucket: Bucket;
  parentName?: string;
  subtasks: number;
  selected: boolean;
  showDropLine: boolean;
  onToggle: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onMove: (b: Bucket) => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const qc = useQueryClient();
  const catalog = useCatalog();
  const projects = useProjects();
  const timer = useTimer();
  const { start } = useStartTimer();
  const complete = useAction<{ id: string }, unknown>((b) => `/api/tasks/${b.id}/complete`);
  const [more, setMore] = useState(false);
  const status = catalog.data?.statuses.find((s) => s.id === task.statusId);
  const project = projects.data?.find((p) => p.id === task.projectId);
  const companies = catalog.data?.companies ?? [];
  const ci = companies.findIndex((c) => c.id === project?.companyId);
  const done = !!status?.isDone;
  const running = timer.data?.running?.taskId === task.id;

  const setDate = async (value: string) => {
    await patch(`/api/tasks/${task.id}`, { plannedDate: value || null });
    void qc.invalidateQueries({ queryKey: ['plan'] });
  };

  return (
    <>
      {showDropLine && <li aria-hidden="true" className="h-0.5 rounded-full bg-accent" />}
      <li
        data-task-id={task.id}
        draggable={!done}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        aria-label={task.name}
        className={`group rounded-field border bg-surface px-3 py-2.5 text-sm ${selected ? 'border-accent ring-1 ring-accent' : 'border-line'} ${done ? 'opacity-70' : 'cursor-grab active:cursor-grabbing'}`}
      >
        <div className="flex items-start gap-2.5">
          <input type="checkbox" aria-label={`Select ${task.name}`} checked={selected} onChange={onToggle} disabled={done} className="mt-1 size-4 accent-[var(--mt-accent)]" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-start gap-2">
              <CompanyDot color={companyColor(companies[ci], Math.max(0, ci))} />
              <div className="min-w-0 flex-1">
                {parentName && <div className="truncate text-xs text-text-3">{parentName} ›</div>}
                <div className={`font-semibold leading-snug ${done ? 'text-text-3 line-through' : ''}`}>{task.name}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip className="max-w-[160px] truncate">{project?.reportName || project?.name || 'Project'}</Chip>
              <StatusChip status={status} />
              {task.hulyKey && <span className="text-xs text-text-3">{task.hulyKey}</span>}
              {subtasks > 0 && <span className="text-xs text-text-3">{subtasks} open subtask{subtasks > 1 ? 's' : ''}</span>}
              {task.plannedDate && <span className="text-xs text-text-3">on {task.plannedDate}</span>}
              <span className="num ml-auto text-xs text-text-2">{task.estimateMinutes ? duration(task.estimateMinutes * MINUTE) : ''}</span>
            </div>
          </div>
          {!done && (
            <span className="flex shrink-0 gap-1">
              <Button size="sm" variant={running ? 'soft' : 'ghost'} className="px-2" aria-label={`Start timer on ${task.name}`} disabled={running} onClick={() => start({ projectId: task.projectId, taskId: task.id })}>
                <Play size={13} aria-hidden="true" />
              </Button>
              <Button size="sm" variant="ghost" className="px-2" aria-label={`Mark ${task.name} done`} onClick={() => complete.mutate({ id: task.id })}>
                <Check size={13} aria-hidden="true" />
              </Button>
              <Button size="sm" variant="ghost" className="px-2" aria-label={`More for ${task.name}`} aria-expanded={more} onClick={() => setMore(!more)}>
                <MoreHorizontal size={13} aria-hidden="true" />
              </Button>
            </span>
          )}
        </div>
        {more && !done && (
          <div className="mt-2.5 flex flex-col gap-2 border-t border-divider pt-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-text-2">Move to</span>
              {COLUMNS.filter((c) => c.id !== bucket).map((c) => (
                <Button key={c.id} size="sm" onClick={() => onMove(c.id)}>
                  {c.title}
                </Button>
              ))}
              <span className="ml-auto flex gap-1">
                <Button size="sm" className="px-2" aria-label={`Move ${task.name} up`} disabled={!onUp} onClick={onUp}>
                  <ArrowUp size={13} aria-hidden="true" />
                </Button>
                <Button size="sm" className="px-2" aria-label={`Move ${task.name} down`} disabled={!onDown} onClick={onDown}>
                  <ArrowDown size={13} aria-hidden="true" />
                </Button>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`date-${task.id}`} className="text-xs text-text-2">
                Scheduled for
              </label>
              <input
                id={`date-${task.id}`}
                type="date"
                defaultValue={task.plannedDate ?? ''}
                onChange={(e) => void setDate(e.target.value)}
                className="mt-themed min-h-8 rounded-field border border-line bg-surface px-2 text-[13px] text-text"
              />
              {task.hulyUrl && (
                <a href={task.hulyUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-accent-ink hover:underline">
                  <ExternalLink size={12} aria-hidden="true" /> Open in Huly
                </a>
              )}
            </div>
          </div>
        )}
      </li>
    </>
  );
}
