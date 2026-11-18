import { useQueryClient } from '@tanstack/react-query';
import { Reorder } from 'motion/react';
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { patch, post } from '../lib/api.ts';
import { duration, signedMinutes, timeOfDay, MINUTE } from '../lib/format.ts';
import { keys, useCatalog, usePlan, useProjects, useTimer, useWorkday, useWorkdayReview } from '../lib/queries.ts';
import type { Task, WorkdaySummary } from '../lib/types.ts';
import { Dialog } from './Dialog.tsx';
import { Field, TextArea, TimeInput, parseClock } from './fields.tsx';
import { ReportComposer } from './ReportComposer.tsx';
import { Button, Chip, CompanyDot, StatusChip, companyColor } from './ui.tsx';

interface Flows {
  openStart: () => void;
  openEnd: () => void;
  openMessage: (type: 'morning' | 'evening', workdayId: string) => void;
}

const FlowsContext = createContext<Flows>({ openStart: () => {}, openEnd: () => {}, openMessage: () => {} });
export const useWorkdayFlows = () => useContext(FlowsContext);

/** Hosts the Start Workday and End Workday wizards so any screen can open them. */
export function WorkdayFlowsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<null | 'start' | 'end'>(null);
  const [message, setMessage] = useState<null | { type: 'morning' | 'evening'; workdayId: string }>(null);
  const flows = useMemo<Flows>(
    () => ({ openStart: () => setOpen('start'), openEnd: () => setOpen('end'), openMessage: (type, workdayId) => setMessage({ type, workdayId }) }),
    [],
  );
  return (
    <FlowsContext.Provider value={flows}>
      {children}
      {open === 'start' && <StartWorkdayWizard onClose={() => setOpen(null)} />}
      {open === 'end' && <EndWorkdayWizard onClose={() => setOpen(null)} />}
      <Dialog open={!!message} onClose={() => setMessage(null)} title={message?.type === 'evening' ? 'Evening message' : 'Morning message'} width={720}>
        {message && <ReportComposer params={{ type: message.type, workdayId: message.workdayId }} />}
      </Dialog>
    </FlowsContext.Provider>
  );
}

/** "HH:MM" on the same local day as `base`. */
function onDayOf(base: number, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const d = new Date(base);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
}

function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Steps">
      {steps.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? 'step' : undefined}
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-semibold ${
            i === current ? 'bg-accent text-on-accent' : i < current ? 'bg-accent-soft text-accent-ink' : 'bg-surface-2 text-text-3'
          }`}
        >
          <span className="num">{i + 1}</span> {s}
        </li>
      ))}
    </ol>
  );
}

function useTaskMeta() {
  const catalog = useCatalog();
  const projects = useProjects();
  const statuses = new Map((catalog.data?.statuses ?? []).map((s) => [s.id, s]));
  const projectMap = new Map((projects.data ?? []).map((p) => [p.id, p]));
  const companies = catalog.data?.companies ?? [];
  const dot = (t: Task) => {
    const p = projectMap.get(t.projectId);
    const ci = companies.findIndex((c) => c.id === p?.companyId);
    return companyColor(companies[ci], Math.max(0, ci));
  };
  const projectName = (t: Task) => {
    const p = projectMap.get(t.projectId);
    return p?.reportName || p?.name || '';
  };
  const isOpen = (t: Task) => {
    const s = statuses.get(t.statusId);
    return !!s && !s.isDone && !s.isRejected;
  };
  return { statuses, dot, projectName, isOpen };
}

function TaskLine({ task, children }: { task: Task; children?: ReactNode }) {
  const meta = useTaskMeta();
  return (
    <div className="flex min-h-10 items-center gap-3 text-sm">
      <CompanyDot color={meta.dot(task)} />
      <span className="min-w-0 flex-1 truncate">{task.name}</span>
      <span className="hidden max-w-[160px] truncate text-xs text-text-3 sm:inline">{meta.projectName(task)}</span>
      {task.hulyKey && <span className="hidden text-xs text-text-3 md:inline">{task.hulyKey}</span>}
      <StatusChip status={meta.statuses.get(task.statusId)} />
      {children}
    </div>
  );
}

export function CheckInEditor({ summary }: { summary: WorkdaySummary }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(timeOfDay(summary.workday.checkInAt));
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const v = parseClock(value);
    if (!v) return setError('Use 24-hour time, e.g. 09:00.');
    try {
      await patch(`/api/workday/${summary.workday.id}/check-in`, { checkInAt: onDayOf(summary.workday.checkInAt, v) });
      setEditing(false);
      setError(null);
      void qc.invalidateQueries({ queryKey: keys.workday });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the check-in time.');
    }
  };
  if (!editing)
    return (
      <span className="text-sm text-text-2">
        Checked in at <strong className="num text-text">{timeOfDay(summary.workday.checkInAt)}</strong>{' '}
        <button type="button" className="font-semibold text-accent-ink underline-offset-2 hover:underline" onClick={() => setEditing(true)}>
          Edit
        </button>
      </span>
    );
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="check-in-time" className="text-text-2">
        Check-in time
      </label>
      <TimeInput id="check-in-time" value={value} onChange={setValue} className="w-24" />
      <Button size="sm" variant="primary" onClick={() => void save()}>
        Save
      </Button>
      <Button size="sm" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {error && <span className="w-full text-danger">{error}</span>}
    </span>
  );
}

/** Flow 1: check-in is saved the moment this opens; then carry over, focus, blocker and the morning message. */
function StartWorkdayWizard({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const workday = useWorkday();
  const today = usePlan('today');
  const week = usePlan('this_week');
  const backlog = usePlan('backlog');
  const meta = useTaskMeta();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const [carry, setCarry] = useState<Task[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string[]>([]);
  const [blocker, setBlocker] = useState('');
  const [showBacklog, setShowBacklog] = useState(false);
  const [saving, setSaving] = useState(false);

  const summary = workday.data?.workday ?? null;
  const running = summary && !summary.workday.checkOutAt ? summary : null;

  // Start the workday once (check-in = now), unless it is already running.
  useEffect(() => {
    if (started.current || workday.isLoading || !workday.data) return;
    started.current = true;
    if (running) return;
    if (summary?.workday.checkOutAt) {
      setError('Today’s workday has already ended. Reopen it from the dashboard to continue.');
      return;
    }
    post('/api/workday/start', {})
      .then(() => qc.invalidateQueries({ queryKey: keys.workday }))
      .catch((e: Error) => setError(e.message));
  }, [workday.isLoading, workday.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Snapshot the unfinished Today tasks once, all ticked.
  useEffect(() => {
    if (carry !== null || !today.data || !meta.statuses.size) return;
    const open = today.data.filter(meta.isOpen);
    setCarry(open);
    setTicked(new Set(open.map((t) => t.id)));
    if (running?.workday.morningBlocker) setBlocker(running.workday.morningBlocker);
  }, [today.data, meta.statuses.size]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo(() => new Map([...(today.data ?? []), ...(week.data ?? []), ...(backlog.data ?? [])].map((t) => [t.id, t])), [today.data, week.data, backlog.data]);
  const toFocus = () => {
    // Keep any order you already made; add newly ticked carry-overs at the end.
    const keep = focus.filter((id) => ticked.has(id) || !(carry ?? []).some((t) => t.id === id));
    const add = (carry ?? []).filter((t) => ticked.has(t.id) && !keep.includes(t.id)).map((t) => t.id);
    setFocus([...keep, ...add]);
    setStep(1);
  };
  const move = (id: string, by: number) => {
    const i = focus.indexOf(id);
    const j = i + by;
    if (j < 0 || j >= focus.length) return;
    const next = [...focus];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setFocus(next);
  };
  const toMessage = async () => {
    if (!running) return;
    setSaving(true);
    setError(null);
    try {
      const drop = (carry ?? []).filter((t) => !ticked.has(t.id)).map((t) => t.id);
      await post('/api/workday/focus', { focusTaskIds: focus, dropTaskIds: drop });
      await patch(`/api/workday/${running.workday.id}/blocker`, { which: 'morning', blocker: blocker.trim() || null });
      void qc.invalidateQueries({ queryKey: ['plan'] });
      void qc.invalidateQueries({ queryKey: keys.workday });
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your focus.');
    } finally {
      setSaving(false);
    }
  };

  const suggestions = (list: Task[] | undefined) => (list ?? []).filter((t) => meta.isOpen(t) && !focus.includes(t.id));

  return (
    <Dialog open onClose={onClose} title="Start Workday" width={760}>
      <Steps steps={['Carry over', "Today's focus", 'Blocker', 'Message']} current={step} />
      {running && <CheckInEditor summary={running} />}
      {error && <p className="m-0 text-sm text-danger">{error}</p>}

      {step === 0 && (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-sm text-text-2">Unfinished tasks still in Today. Untick any you are not doing today; they move to This Week.</p>
          {carry === null ? (
            <div className="h-20 animate-pulse rounded-card bg-sunken" aria-label="Loading" />
          ) : carry.length === 0 ? (
            <p className="m-0 rounded-field bg-surface-2 px-4 py-3 text-sm text-text-2">Nothing unfinished from yesterday.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-divider p-0">
              {carry.map((t) => (
                <li key={t.id}>
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Carry over ${t.name}`}
                      checked={ticked.has(t.id)}
                      onChange={(e) => {
                        const next = new Set(ticked);
                        if (e.target.checked) next.add(t.id);
                        else next.delete(t.id);
                        setTicked(next);
                      }}
                      className="size-4 accent-[var(--mt-accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <TaskLine task={t} />
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Later</Button>
            <Button variant="primary" onClick={toFocus} disabled={carry === null || !running}>
              Next
            </Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-sm text-text-2">Your focus for today, in order. Drag to reorder, or use the arrows. The order is used in the morning message.</p>
          {focus.length === 0 ? (
            <p className="m-0 rounded-field bg-surface-2 px-4 py-3 text-sm text-text-2">No focus tasks yet. Add some from the suggestions below.</p>
          ) : (
            <Reorder.Group axis="y" values={focus} onReorder={setFocus} className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Today's focus">
              {focus.map((id, i) => {
                const t = all.get(id);
                if (!t) return null;
                return (
                  <Reorder.Item key={id} value={id} className="flex cursor-grab items-center gap-2 rounded-field border border-line bg-surface px-2 active:cursor-grabbing">
                    <GripVertical size={16} className="shrink-0 text-text-3" aria-hidden="true" />
                    <span className="num w-5 text-center text-xs font-bold text-text-3">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <TaskLine task={t}>
                        <span className="flex gap-1">
                          <Button size="sm" aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => move(id, -1)} className="px-2">
                            <ArrowUp size={14} aria-hidden="true" />
                          </Button>
                          <Button size="sm" aria-label={`Move ${t.name} down`} disabled={i === focus.length - 1} onClick={() => move(id, 1)} className="px-2">
                            <ArrowDown size={14} aria-hidden="true" />
                          </Button>
                          <Button size="sm" aria-label={`Remove ${t.name} from focus`} onClick={() => setFocus(focus.filter((x) => x !== id))} className="px-2">
                            <X size={14} aria-hidden="true" />
                          </Button>
                        </span>
                      </TaskLine>
                    </span>
                  </Reorder.Item>
                );
              })}
            </Reorder.Group>
          )}

          <SuggestionList title="From This Week" tasks={suggestions(week.data)} onAdd={(id) => setFocus([...focus, id])} empty="Nothing else planned for this week." />
          {showBacklog ? (
            <SuggestionList title="From Backlog" tasks={suggestions(backlog.data)} onAdd={(id) => setFocus([...focus, id])} empty="The backlog is empty." />
          ) : (
            <button type="button" className="self-start text-sm font-semibold text-accent-ink underline-offset-2 hover:underline" onClick={() => setShowBacklog(true)}>
              Show backlog tasks too
            </button>
          )}
          <div className="flex justify-between gap-2">
            <Button onClick={() => setStep(0)}>Back</Button>
            <Button variant="primary" onClick={() => setStep(2)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <Field label="Blocker" hint="Leave empty for “None”.">
            <TextArea autoFocus value={blocker} onChange={(e) => setBlocker(e.target.value)} placeholder="None" />
          </Field>
          <div className="flex justify-between gap-2">
            <Button onClick={() => setStep(1)}>Back</Button>
            <Button variant="primary" onClick={() => void toMessage()} disabled={saving}>
              Save and write message
            </Button>
          </div>
        </div>
      )}

      {step === 3 && running && (
        <div className="flex flex-col gap-4">
          <ReportComposer params={{ type: 'morning', workdayId: running.workday.id, focusTaskIds: focus, blocker }} />
          <div className="flex justify-between gap-2 border-t border-divider pt-4">
            <Button onClick={() => setStep(2)}>Back</Button>
            <Button variant="done" onClick={onClose}>
              Start working
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function SuggestionList({ title, tasks, onAdd, empty }: { title: string; tasks: Task[]; onAdd: (id: string) => void; empty: string }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <span className="text-[13px] font-semibold text-text-2">{title}</span>
      {tasks.length === 0 ? (
        <span className="text-sm text-text-3">{empty}</span>
      ) : (
        <ul className="m-0 flex max-h-56 list-none flex-col divide-y divide-divider overflow-y-auto p-0">
          {tasks.map((t) => (
            <li key={t.id}>
              <TaskLine task={t}>
                <Button size="sm" aria-label={`Add ${t.name} to focus`} onClick={() => onAdd(t.id)} className="px-2">
                  <Plus size={14} aria-hidden="true" />
                </Button>
              </TaskLine>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type RunningChoice = 'stop_now' | 'stop_at' | 'keep';

/** Flow 8: decide on a running timer, review the day, write the evening message, then check out. */
function EndWorkdayWizard({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const workday = useWorkday();
  const timer = useTimer();
  const summary = workday.data?.workday && !workday.data.workday.workday.checkOutAt ? workday.data.workday : null;
  const review = useWorkdayReview(summary?.workday.id ?? null);
  const running = timer.data?.running ?? null;
  // The moment you pressed End Workday; the time field shows its minute.
  const [pressedAt] = useState(() => Date.now());
  const openedAt = Math.floor(pressedAt / MINUTE) * MINUTE;
  const [checkOut, setCheckOut] = useState(() => timeOfDay(openedAt));
  const [choice, setChoice] = useState<RunningChoice>('stop_now');
  const [stopAt, setStopAt] = useState(() => timeOfDay(openedAt));
  const [blocker, setBlocker] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const steps = running ? ['Running timer', 'Review', 'Message'] : ['Review', 'Message'];
  const name = steps[step];

  useEffect(() => {
    if (blocker === null && review.data) setBlocker(review.data.morningBlocker ?? '');
  }, [review.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!summary) {
    return (
      <Dialog open onClose={onClose} title="End Workday" width={520}>
        <p className="m-0 text-sm text-text-2">{workday.isLoading ? 'Loading…' : 'No workday is running.'}</p>
      </Dialog>
    );
  }

  const outClock = parseClock(checkOut);
  const typed = outClock ? onDayOf(openedAt, outClock) : null;
  // Left at its default minute, check-out is the exact moment you pressed End Workday, so a timer
  // started earlier in that same minute still ends before check-out.
  const outAt = typed === openedAt ? pressedAt : typed;
  const outValid = outAt !== null && outAt > summary.workday.checkInAt && outAt <= Date.now() + MINUTE;
  const stopClock = parseClock(stopAt);
  const stopAtTs = stopClock ? onDayOf(openedAt, stopClock) : null;
  const balance = outAt !== null ? Math.round((outAt - summary.workday.checkInAt) / MINUTE) - summary.workday.expectedMinutes : 0;

  const end = async () => {
    if (!outValid || outAt === null) return setError('Check-out must be after check-in and not in the future.');
    setEnding(true);
    setError(null);
    try {
      const runningBody =
        !running ? undefined : choice === 'keep' ? { action: 'keep' } : choice === 'stop_at' && stopAtTs !== null ? { action: 'stop_at', at: stopAtTs } : { action: 'stop_now' };
      await post('/api/workday/end', { at: Math.min(outAt, Date.now()), running: runningBody, blocker: blocker?.trim() || null });
      void qc.invalidateQueries({ queryKey: keys.workday });
      void qc.invalidateQueries({ queryKey: keys.timer });
      void qc.invalidateQueries({ queryKey: ['plan'] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not end the workday.');
    } finally {
      setEnding(false);
    }
  };

  const r = review.data;
  const stat = (value: string, label: string) => (
    <div>
      <div className="num font-head text-[22px] font-extrabold">{value}</div>
      <div className="text-xs text-text-2">{label}</div>
    </div>
  );

  return (
    <Dialog open onClose={onClose} title="End Workday" width={760}>
      <Steps steps={steps} current={step} />
      {error && <p className="m-0 text-sm text-danger">{error}</p>}

      {name === 'Running timer' && running && (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-sm text-text-2">
            A timer is still running on <strong className="text-text">{timer.data?.runningContext?.taskName ?? timer.data?.runningContext?.projectName}</strong> since {timeOfDay(running.startedAt)}.
          </p>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="sr-only">What happens to the running timer</legend>
            {(
              [
                ['stop_now', 'Stop it at check-out'],
                ['stop_at', 'Stop it at an earlier time'],
                ['keep', 'Keep it running (work continues after check-out)'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-3 rounded-field border border-line px-3 py-2.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                <input type="radio" name="running" value={value} checked={choice === value} onChange={() => setChoice(value)} className="size-4 accent-[var(--mt-accent)]" />
                {label}
              </label>
            ))}
          </fieldset>
          {choice === 'stop_at' && (
            <Field label="Stop time" hint={`After ${timeOfDay(running.startedAt)}, not after check-out.`}>
              <TimeInput value={stopAt} onChange={setStopAt} className="w-28" />
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => setStep(step + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {name === 'Review' && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Check-out time" hint={`Checked in at ${timeOfDay(summary.workday.checkInAt)}.`}>
              <TimeInput value={checkOut} onChange={setCheckOut} className="w-28" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4 rounded-card bg-surface-2 p-4 sm:grid-cols-5">
            {stat(outAt ? duration(outAt - summary.workday.checkInAt) : '–', 'workday')}
            {stat(duration(summary.trackedMs), 'tracked work')}
            {stat(duration(summary.breakMs), 'lunch and breaks')}
            {stat(duration(summary.untrackedMs), 'untracked')}
            {stat(signedMinutes(balance), `balance today (${signedMinutes(summary.runningBalanceMinutes + balance)} total)`)}
          </div>
          {!r ? (
            <div className="h-24 animate-pulse rounded-card bg-sunken" aria-label="Loading" />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <ReviewList title="Completed today" tasks={r.completed} empty="Nothing completed today." />
              <ReviewList title="Still in progress" tasks={r.inProgress} empty="Nothing in progress." tracked={r.trackedByTask} />
              <ReviewList title="Not started (stays in Today for tomorrow)" tasks={r.unfinished} empty="Every focus task was touched." />
              <section aria-label="Revisions today" className="flex flex-col gap-1">
                <span className="text-[13px] font-semibold text-text-2">Revisions today</span>
                {r.revisions.length === 0 ? (
                  <span className="text-sm text-text-3">No revisions requested or completed today.</span>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {r.revisions.map((v) => (
                      <li key={v.id} className="flex items-center gap-2 text-sm">
                        <Chip>Round {v.number}</Chip>
                        <span className="min-w-0 flex-1 truncate">
                          {v.projectName}: {v.title}
                        </span>
                        <span className="text-xs text-text-3">{v.completedToday ? 'completed' : 'requested'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
          <Field label="Blocker" hint="Prefilled from this morning. Leave empty for “None”.">
            <TextArea value={blocker ?? ''} onChange={(e) => setBlocker(e.target.value)} placeholder="None" />
          </Field>
          <div className="flex justify-between gap-2">
            {step > 0 ? <Button onClick={() => setStep(step - 1)}>Back</Button> : <Button onClick={onClose}>Cancel</Button>}
            <Button variant="primary" onClick={() => (outValid ? setStep(step + 1) : setError('Check-out must be after check-in and not in the future.'))}>
              Next
            </Button>
          </div>
        </div>
      )}

      {name === 'Message' && outAt !== null && (
        <div className="flex flex-col gap-4">
          <ReportComposer params={{ type: 'evening', workdayId: summary.workday.id, blocker: blocker ?? undefined, at: outAt }} />
          <div className="flex justify-between gap-2 border-t border-divider pt-4">
            <Button onClick={() => setStep(step - 1)}>Back</Button>
            <Button variant="done" onClick={() => void end()} disabled={ending}>
              End workday at {timeOfDay(outAt)}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function ReviewList({ title, tasks, empty, tracked }: { title: string; tasks: Task[]; empty: string; tracked?: Record<string, number> }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <span className="text-[13px] font-semibold text-text-2">{title}</span>
      {tasks.length === 0 ? (
        <span className="text-sm text-text-3">{empty}</span>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {tasks.map((t) => (
            <li key={t.id}>
              <TaskLine task={t}>{tracked?.[t.id] ? <span className="num text-xs text-text-2">{duration(tracked[t.id]!)}</span> : null}</TaskLine>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
