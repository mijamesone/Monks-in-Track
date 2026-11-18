import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Pencil, Play, Plus, Scissors, Square, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../components/Dialog.tsx';
import { Field, Select, TextInput, TimeInput, parseClock } from '../components/fields.tsx';
import { Button, Card, Chip, CompanyDot, EmptyState, companyColor } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useCompany } from '../lib/company.tsx';
import { duration, timeOfDay } from '../lib/format.ts';
import { useCatalog, useMutate, useNow, useProjectTasks, useProjects, useRevisions, useTimer } from '../lib/queries.ts';
import type { EntryKind, EntryWithContext } from '../lib/types.ts';

const DAY = 86_400_000;
const KIND_LABEL: Record<EntryKind, string> = { work: 'Work', revision: 'Revision', meeting: 'Meeting', break: 'Break', lunch: 'Lunch' };
const isBreak = (k: EntryKind) => k === 'break' || k === 'lunch';

function mondayOf(ts: number) {
  const d = new Date(ts);
  const day = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
}
const hhmm = (ts: number) => timeOfDay(ts);
/** Same calendar day as `base`, at hh:mm. */
function atTime(base: number, value: string) {
  const [h, m] = value.split(':').map(Number) as [number, number];
  const d = new Date(base);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
}
const dateInput = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function Time() {
  const [week, setWeek] = useState(() => mondayOf(Date.now()));
  const [kind, setKind] = useState<'all' | 'work' | 'revision' | 'meeting' | 'breaks'>('all');
  const [editing, setEditing] = useState<EntryWithContext | 'new' | null>(null);
  const [splitting, setSplitting] = useState<EntryWithContext | null>(null);
  const [undo, setUndo] = useState<EntryWithContext | null>(null);
  const { companyId } = useCompany();
  const catalog = useCatalog();
  const timer = useTimer();
  const now = useNow(timer.data?.now);
  const to = week + 7 * DAY;
  const entries = useQuery({
    queryKey: ['projects', 'time-week', week],
    queryFn: () => api<EntryWithContext[]>(`/api/entries?from=${week}&to=${to}&context=1`),
    refetchInterval: 30_000,
  });
  const remove = useMutate<{ id: string }>('DELETE', (v) => `/api/entries/${v.id}`);
  const update = useMutate<{ id: string; body: Record<string, unknown> }>('PATCH', (v) => `/api/entries/${v.id}`, (v) => v.body);
  const restart = useMutate<{ id: string }>('POST', (v) => `/api/entries/${v.id}/restart`, () => ({ startWorkday: true }));
  const stop = useMutate<Record<string, never>>('POST', () => '/api/timer/stop');
  const runningStart = useMutate<{ startedAt: number }>('PATCH', () => '/api/timer/start-time');
  const restore = useMutate<Record<string, unknown>>('POST', () => '/api/entries');

  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), 7000);
    return () => clearTimeout(id);
  }, [undo]);

  const companies = catalog.data?.companies ?? [];
  const list = (entries.data ?? []).filter((e) => {
    if (companyId !== 'all' && e.context?.companyId !== companyId) return false;
    if (kind === 'breaks') return isBreak(e.kind);
    return kind === 'all' || e.kind === kind;
  });

  // Group by local day (newest first) and flag overlaps within each day.
  const days = useMemo(() => {
    const map = new Map<number, EntryWithContext[]>();
    for (const e of list) {
      const d = new Date(e.startedAt);
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([day, items]) => {
        const sorted = [...items].sort((a, b) => a.startedAt - b.startedAt);
        const overlap = new Set<string>();
        for (let i = 0; i < sorted.length; i++)
          for (let j = i + 1; j < sorted.length; j++) {
            const a = sorted[i]!;
            const b = sorted[j]!;
            if (b.startedAt >= (a.endedAt ?? now)) break;
            overlap.add(a.id);
            overlap.add(b.id);
          }
        return { day, items: [...sorted].reverse(), overlap };
      });
  }, [list, now]);

  const mutError = remove.error ?? update.error ?? restart.error ?? runningStart.error ?? stop.error;
  const weekLabel = `${new Date(week).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(to - DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const weekTracked = list.filter((e) => !isBreak(e.kind)).reduce((s, e) => s + ((e.endedAt ?? now) - e.startedAt), 0);

  const saveTime = (e: EntryWithContext, which: 'start' | 'end', value: string) => {
    if (!value) return;
    if (which === 'start') {
      const ts = atTime(e.startedAt, value);
      if (ts === e.startedAt) return;
      if (e.endedAt === null) runningStart.mutate({ startedAt: ts });
      else update.mutate({ id: e.id, body: { startedAt: ts } });
    } else if (e.endedAt !== null) {
      let ts = atTime(e.startedAt, value);
      if (ts <= e.startedAt) ts += DAY; // ends after midnight
      if (ts !== e.endedAt) update.mutate({ id: e.id, body: { endedAt: ts } });
    }
  };

  const del = async (e: EntryWithContext) => {
    if (e.endedAt === null) return;
    await remove.mutateAsync({ id: e.id });
    setUndo(e);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 font-head text-[28px] font-extrabold tracking-[-0.02em]">Time</h1>
          <span className="text-sm text-text-2">
            {weekLabel} · tracked <span className="num font-semibold text-text">{duration(weekTracked)}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" aria-label="Previous week" onClick={() => setWeek(week - 7 * DAY)}>
            <ChevronLeft size={16} aria-hidden="true" />
          </Button>
          <Button size="sm" onClick={() => setWeek(mondayOf(Date.now()))} disabled={week === mondayOf(Date.now())}>
            This week
          </Button>
          <Button size="sm" aria-label="Next week" onClick={() => setWeek(week + 7 * DAY)}>
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Kind of time" className="!min-h-8 !w-40 text-[13px]">
            <option value="all">All kinds</option>
            <option value="work">Work</option>
            <option value="revision">Revision</option>
            <option value="meeting">Meetings</option>
            <option value="breaks">Lunch and breaks</option>
          </Select>
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden="true" /> Add time
          </Button>
        </div>
      </div>

      {mutError && (
        <p role="alert" className="m-0 rounded-field bg-danger-soft px-4 py-2 text-sm text-danger">
          {mutError.message}
        </p>
      )}

      {entries.isLoading ? (
        <div className="h-48 animate-pulse rounded-card bg-sunken" aria-label="Loading" />
      ) : days.length === 0 ? (
        <EmptyState title="No time this week" action={<Button variant="primary" onClick={() => setEditing('new')}>Add time</Button>}>
          Start a timer, or add time you forgot to track.
        </EmptyState>
      ) : (
        days.map(({ day, items, overlap }) => {
          const tracked = items.filter((e) => !isBreak(e.kind)).reduce((s, e) => s + ((e.endedAt ?? now) - e.startedAt), 0);
          const breaks = items.filter((e) => isBreak(e.kind)).reduce((s, e) => s + ((e.endedAt ?? now) - e.startedAt), 0);
          return (
            <Card key={day} className="px-5 pt-3 pb-1" label={new Date(day).toDateString()}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2">
                <span className="font-head font-bold">{new Date(day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                <span className="num text-sm text-text-2">
                  tracked <span className="font-semibold text-text">{duration(tracked)}</span>
                  {breaks > 0 && <> · lunch and breaks {duration(breaks)}</>}
                </span>
              </div>
              <ul className="m-0 list-none p-0">
                <AnimatePresence initial={false}>
                  {items.map((e) => {
                    const running = e.endedAt === null;
                    const ci = companies.findIndex((c) => c.id === e.context?.companyId);
                    const flagged = overlap.has(e.id);
                    return (
                      <motion.li
                        key={e.id}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, height: 0 }}
                        className={`grid grid-cols-[70px_76px_70px_minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-divider py-2 text-sm ${flagged ? '-mx-2 rounded-field bg-[var(--mt-chip-review-bg)] px-2' : ''}`}
                      >
                        <TimeField label="Start" value={hhmm(e.startedAt)} onCommit={(v) => saveTime(e, 'start', v)} />
                        {running ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-live px-2.5 py-0.5 text-xs font-semibold text-on-live">
                            <span className="mt-live-dot" aria-hidden="true" /> running
                          </span>
                        ) : (
                          <TimeField label="End" value={hhmm(e.endedAt!)} onCommit={(v) => saveTime(e, 'end', v)} />
                        )}
                        <span className="num text-right font-semibold">{duration((e.endedAt ?? now) - e.startedAt)}</span>
                        <span className="flex min-w-0 items-center gap-2">
                          {isBreak(e.kind) ? (
                            <span className="text-text-2">{KIND_LABEL[e.kind]}</span>
                          ) : (
                            <>
                              <CompanyDot color={companyColor(companies[ci], Math.max(0, ci))} />
                              <span className="min-w-0 truncate">
                                {e.projectId ? (
                                  <Link to="/projects/$projectId" params={{ projectId: e.projectId }} className="font-semibold hover:text-accent-ink">
                                    {e.context?.projectName}
                                  </Link>
                                ) : (
                                  <span className="font-semibold">Meeting</span>
                                )}
                                {e.context?.taskName && <span className="text-text-2"> › {e.context.taskName}</span>}
                              </span>
                            </>
                          )}
                          {flagged && <span className="shrink-0 text-xs font-semibold text-[var(--mt-chip-review-fg)]">overlaps</span>}
                        </span>
                        <span className="flex gap-1.5">
                          {e.kind === 'revision' && <Chip>Revision {e.context?.revision?.number ?? ''}</Chip>}
                          {e.kind === 'meeting' && <Chip>Meeting</Chip>}
                          {e.source === 'manual' && <Chip>added</Chip>}
                        </span>
                        <span className="flex items-center gap-0.5">
                          {running ? (
                            <IconBtn label="Stop timer" onClick={() => stop.mutate({})}>
                              <Square size={14} aria-hidden="true" />
                            </IconBtn>
                          ) : (
                            <>
                              {!isBreak(e.kind) && (
                                <IconBtn label="Restart this" onClick={() => restart.mutate({ id: e.id })}>
                                  <Play size={14} aria-hidden="true" />
                                </IconBtn>
                              )}
                              <IconBtn label="Split" onClick={() => setSplitting(e)}>
                                <Scissors size={14} aria-hidden="true" />
                              </IconBtn>
                              <IconBtn label="Edit" onClick={() => setEditing(e)}>
                                <Pencil size={14} aria-hidden="true" />
                              </IconBtn>
                              <IconBtn label="Delete" onClick={() => void del(e)}>
                                <Trash2 size={14} aria-hidden="true" />
                              </IconBtn>
                            </>
                          )}
                        </span>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            </Card>
          );
        })
      )}

      <EntryDialog entry={editing} onClose={() => setEditing(null)} />
      <SplitDialog entry={splitting} onClose={() => setSplitting(null)} />

      <AnimatePresence>
        {undo && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-4 rounded-card bg-text px-4 py-3 text-sm text-canvas shadow-lg"
          >
            Entry deleted ({duration(undo.endedAt! - undo.startedAt)}).
            <button
              type="button"
              className="font-semibold text-accent-soft underline"
              onClick={() => {
                const e = undo;
                setUndo(null);
                restore.mutate({ projectId: e.projectId, taskId: e.taskId, kind: e.kind, revisionRoundId: e.revisionRoundId, startedAt: e.startedAt, endedAt: e.endedAt, note: e.note });
              }}
            >
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="rounded-[8px] p-1.5 text-text-2 hover:bg-surface-2 hover:text-text">
      {children}
    </button>
  );
}

/** An inline HH:MM field (24-hour) that saves when you leave it or press Enter; invalid input snaps back. */
function TimeField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const bad = parseClock(v) === null;
  return (
    <input
      type="text"
      inputMode="numeric"
      maxLength={5}
      aria-label={label}
      aria-invalid={bad || undefined}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = parseClock(v);
        if (!n) return setV(value);
        setV(n);
        if (n !== value) onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setV(value);
      }}
      className={`num w-[70px] rounded-[8px] border bg-transparent px-1.5 py-1 text-sm ${bad ? 'border-danger' : 'border-transparent hover:border-line focus:border-accent'}`}
    />
  );
}

/** Add time you forgot to track, or change an entry's project, task, kind or note. */
function EntryDialog({ entry, onClose }: { entry: EntryWithContext | 'new' | null; onClose: () => void }) {
  const isNew = entry === 'new';
  const e = isNew || entry === null ? null : entry;
  const projects = useProjects();
  const [form, setForm] = useState({ projectId: '', taskId: '', kind: 'work' as EntryKind, roundId: '', date: dateInput(Date.now()), start: '', end: '', note: '' });
  useEffect(() => {
    if (e) setForm({ projectId: e.projectId ?? '', taskId: e.taskId ?? '', kind: e.kind, roundId: e.revisionRoundId ?? '', date: dateInput(e.startedAt), start: hhmm(e.startedAt), end: e.endedAt ? hhmm(e.endedAt) : '', note: e.note ?? '' });
    else if (isNew) setForm({ projectId: '', taskId: '', kind: 'work', roundId: '', date: dateInput(Date.now()), start: '', end: '', note: '' });
  }, [entry]); // eslint-disable-line react-hooks/exhaustive-deps
  const tasks = useProjectTasks(form.projectId);
  const rounds = useRevisions(form.kind === 'revision' ? form.projectId : '');
  const create = useMutate<Record<string, unknown>>('POST', () => '/api/entries');
  const save = useMutate<Record<string, unknown>>('PATCH', () => `/api/entries/${e?.id}`);
  const breakKind = isBreak(form.kind);
  const set = (k: keyof typeof form) => (ev: { target: { value: string } }) => setForm({ ...form, [k]: ev.target.value, ...(k === 'projectId' ? { taskId: '', roundId: '' } : {}) });

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const [y, mo, d] = form.date.split('-').map(Number) as [number, number, number];
    const base = new Date(y, mo - 1, d).getTime();
    const start = parseClock(form.start);
    const end = parseClock(form.end);
    if (!start || (e?.endedAt !== null && !end)) return;
    const startedAt = atTime(base, start);
    let endedAt = atTime(base, end ?? start);
    if (endedAt <= startedAt) endedAt += DAY;
    const body = {
      projectId: breakKind ? null : form.projectId || null,
      taskId: breakKind ? null : form.taskId || null,
      kind: form.kind,
      revisionRoundId: form.kind === 'revision' ? form.roundId || null : null,
      startedAt,
      ...(e?.endedAt === null ? {} : { endedAt }),
      note: form.note.trim() || null,
    };
    if (isNew) await create.mutateAsync(body);
    else await save.mutateAsync(body);
    onClose();
  };
  const error = create.error ?? save.error;
  const valid = !!parseClock(form.start) && (e?.endedAt === null || !!parseClock(form.end)) && (breakKind || form.kind === 'meeting' || !!form.projectId) && (form.kind !== 'revision' || !!form.roundId);

  return (
    <Dialog open={entry !== null} onClose={onClose} title={isNew ? 'Add time' : 'Edit entry'}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <Select value={form.kind} onChange={set('kind')}>
              {(Object.keys(KIND_LABEL) as EntryKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date">
            <TextInput type="date" value={form.date} onChange={set('date')} required />
          </Field>
        </div>
        {!breakKind && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={form.kind === 'meeting' ? 'Project (optional)' : 'Project'}>
              <Select value={form.projectId} onChange={set('projectId')}>
                <option value="">{form.kind === 'meeting' ? 'No project' : 'Choose a project'}</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Task (optional)">
              <Select value={form.taskId} onChange={set('taskId')} disabled={!form.projectId}>
                <option value="">Project-level</option>
                {(tasks.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.parentId ? '↳ ' : ''}
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        {form.kind === 'revision' && (
          <Field label="Revision round">
            <Select value={form.roundId} onChange={set('roundId')} disabled={!form.projectId}>
              <option value="">Choose a round</option>
              {(rounds.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  Round {r.number} · {r.title}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <TimeInput value={form.start} onChange={(v) => setForm({ ...form, start: v })} required />
          </Field>
          <Field label="End" hint={e?.endedAt === null ? 'Still running' : 'An end before the start means after midnight.'}>
            <TimeInput value={form.end} onChange={(v) => setForm({ ...form, end: v })} required={e?.endedAt !== null} disabled={e?.endedAt === null} />
          </Field>
        </div>
        <Field label="Note (optional)">
          <TextInput value={form.note} onChange={set('note')} />
        </Field>
        {error && <p className="m-0 text-sm text-danger">{error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!valid || create.isPending || save.isPending}>
            {isNew ? 'Add time' : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SplitDialog({ entry, onClose }: { entry: EntryWithContext | null; onClose: () => void }) {
  const [value, setValue] = useState('');
  const split = useMutate<{ at: number }>('POST', () => `/api/entries/${entry?.id}/split`);
  useEffect(() => {
    if (entry?.endedAt) setValue(hhmm(entry.startedAt + Math.round((entry.endedAt - entry.startedAt) / 2 / 60_000) * 60_000));
  }, [entry]);
  if (!entry?.endedAt) return null;
  return (
    <Dialog open={!!entry} onClose={onClose} title="Split entry" width={420}>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          const v = parseClock(value);
          if (!v) return;
          let ts = atTime(entry.startedAt, v);
          if (ts <= entry.startedAt) ts += DAY;
          await split.mutateAsync({ at: ts });
          onClose();
        }}
        className="flex flex-col gap-4"
      >
        <Field label="Split at" hint={`Between ${hhmm(entry.startedAt)} and ${hhmm(entry.endedAt)}. Both parts keep the same project and task; edit either afterwards.`}>
          <TimeInput value={value} onChange={setValue} autoFocus />
        </Field>
        {split.error && <p className="m-0 text-sm text-danger">{split.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!parseClock(value) || split.isPending}>
            Split
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

