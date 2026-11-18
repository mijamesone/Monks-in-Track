import { AnimatePresence, motion } from 'motion/react';
import { Check, Play } from 'lucide-react';
import { useMemo } from 'react';
import { Button, Card, Chip, CompanyDot, EmptyState, Label, StatusChip, companyColor } from '../components/ui.tsx';
import { useStartTimer } from '../lib/actions.ts';
import { useCompany } from '../lib/company.tsx';
import { clock, duration, greeting, longDate, signedMinutes, timeOfDay, MINUTE } from '../lib/format.ts';
import { useAction, useCatalog, useNow, useProjects, useReports, useTimer, useToday, useWorkday } from '../lib/queries.ts';
import { CheckInEditor, useWorkdayFlows } from '../components/WorkdayFlows.tsx';
import type { ProjectSummary, Task, WorkdaySummary } from '../lib/types.ts';

const enter = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -10 }, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } };

/** Dashboard with three states that change with your day (spec screen 1). */
export function Dashboard() {
  const workday = useWorkday();
  const timer = useTimer();
  const now = useNow(timer.data?.now);
  const wd = workday.data?.workday ?? null;
  const state = !wd ? 'before' : wd.workday.checkOutAt ? 'after' : 'during';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Label>{longDate(now)}</Label>
        <h1 className="m-0 font-head text-[34px] leading-tight font-extrabold tracking-[-0.02em]">{greeting(now)}</h1>
      </div>
      {workday.isLoading ? (
        <div className="h-48 animate-pulse rounded-card bg-sunken" aria-label="Loading" />
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={state} {...enter} className="flex flex-col gap-6">
            {state === 'before' && <BeforeWork carryOver={workday.data?.carryOver ?? []} />}
            {state === 'during' && <DuringWork now={now} />}
            {state === 'after' && wd && <AfterWork summary={wd} />}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

function useProjectMap() {
  const { companyId } = useCompany();
  const projects = useProjects(companyId === 'all' ? undefined : companyId);
  return useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p])), [projects.data]);
}

function BeforeWork({ carryOver }: { carryOver: Task[] }) {
  const flows = useWorkdayFlows();
  return (
    <>
      <Card className="flex flex-col items-start gap-4 p-7">
        <p className="m-0 max-w-xl text-[15px] text-text-2">
          Start Workday records your check-in time right away, then helps you carry over unfinished work, pick today's focus, note a blocker and copy your morning message.
        </p>
        <Button variant="primary" size="lg" onClick={flows.openStart}>
          Start Workday
        </Button>
      </Card>
      <FocusList title="Carried over from yesterday" tasks={carryOver} emptyText="Nothing unfinished from yesterday." />
    </>
  );
}

function DuringWork({ now }: { now: number }) {
  const today = useToday();
  const workday = useWorkday();
  const timer = useTimer();
  const flows = useWorkdayFlows();
  const wd = workday.data?.workday;
  const morning = useReports({ workdayId: wd?.workday.id, type: 'morning', limit: 1 }, !!wd);
  const running = timer.data?.running ?? null;
  const tracked = (wd?.trackedMs ?? 0) + (running ? Math.max(0, now - Math.max(running.startedAt, timer.data?.now ?? now)) : 0);
  const morningCopied = morning.data?.[0] ?? null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <ActiveTimer now={now} />
      </div>
      <Card className="flex flex-col gap-3 p-5 lg:col-span-4">
        <Label>Workday</Label>
        <span className="num font-head text-[30px] font-extrabold">{wd ? duration(now - wd.workday.checkInAt) : '–'}</span>
        {wd && <CheckInEditor summary={wd} />}
        <span className="text-sm text-text-2">Tracked {duration(tracked)}</span>
        <div className="flex items-center justify-between gap-2 border-t border-divider pt-3 text-sm">
          {morningCopied ? (
            <>
              <span className="text-text-2">Morning message copied at {timeOfDay(morningCopied.createdAt)}</span>
              <button type="button" className="font-semibold text-accent-ink underline-offset-2 hover:underline" onClick={() => wd && flows.openMessage('morning', wd.workday.id)}>
                Open
              </button>
            </>
          ) : (
            <>
              <span className="text-text-2">Morning message not copied yet</span>
              <Button size="sm" variant="soft" onClick={flows.openStart}>
                Morning setup
              </Button>
            </>
          )}
        </div>
        <Button variant="ghost" onClick={flows.openEnd}>
          End Workday
        </Button>
      </Card>
      <div className="lg:col-span-12">
        <FocusList title="Today's focus" tasks={today.data ?? []} emptyText="Nothing planned for today yet. Plan arrives in the next milestone." />
      </div>
    </div>
  );
}

function ActiveTimer({ now }: { now: number }) {
  const timer = useTimer();
  const catalog = useCatalog();
  const stop = useAction<Record<string, never>, unknown>('/api/timer/stop');
  const t = timer.data;
  if (!t?.running || !t.runningContext) {
    return (
      <Card className="flex h-full flex-col justify-center gap-2 p-7">
        <Label>Active timer</Label>
        <span className="font-head text-xl font-bold">Nothing running</span>
        <span className="text-sm text-text-2">Press play on a task below to start tracking.</span>
      </Card>
    );
  }
  const ctx = t.runningContext;
  const companies = catalog.data?.companies ?? [];
  const ci = companies.findIndex((c) => c.id === ctx.companyId);
  const elapsed = now - t.running.startedAt;
  const est = ctx.estimateMinutes ? ctx.estimateMinutes * MINUTE : null;
  const used = ctx.priorMs + elapsed;
  const pct = est ? Math.min(100, (used / est) * 100) : null;
  return (
    <Card className="flex flex-col gap-4 p-7" label="Active timer">
      <div className="flex flex-wrap items-center gap-2">
        <Chip>
          <CompanyDot color={companyColor(companies[ci], Math.max(0, ci))} size={8} />
          {companies[ci]?.name ?? 'Company'}
        </Chip>
        {ctx.hulyKey && <Chip>{ctx.hulyKey}</Chip>}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-live px-2.5 py-0.5 text-xs font-semibold text-on-live">
          <span className="mt-live-dot" aria-hidden="true" /> Running
        </span>
      </div>
      <div>
        <div className="font-head text-xl font-bold">{ctx.taskName ?? ctx.projectName}</div>
        {ctx.taskName && <div className="text-sm text-text-2">{ctx.projectName}</div>}
      </div>
      <motion.div key={Math.floor(elapsed / 60000)} initial={{ opacity: 0.7 }} animate={{ opacity: 1 }} className="num font-head text-[56px] leading-none font-extrabold tracking-[-0.03em]">
        {clock(elapsed)}
      </motion.div>
      {pct !== null && est !== null && (
        <>
          <div className="h-2 rounded-full bg-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Estimate used">
            <motion.div className="h-2 rounded-full" style={{ background: used > est ? 'var(--mt-danger)' : 'var(--mt-accent)' }} initial={false} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 80, damping: 20 }} />
          </div>
          <div className="flex justify-between text-[13px] text-text-2">
            <span className="num">{used <= est ? `${clock(est - used)} left` : `${clock(used - est)} over`}</span>
            <span>estimate {duration(est)}</span>
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => stop.mutate({})}>
          Pause
        </Button>
      </div>
    </Card>
  );
}

function FocusList({ title, tasks, emptyText }: { title: string; tasks: Task[]; emptyText: string }) {
  const catalog = useCatalog();
  const projects = useProjectMap();
  const timer = useTimer();
  const { companyId } = useCompany();
  const { start, error } = useStartTimer();
  const complete = useAction<{ id: string }, unknown>((b) => `/api/tasks/${b.id}/complete`);
  const statuses = new Map((catalog.data?.statuses ?? []).map((s) => [s.id, s]));
  const companies = catalog.data?.companies ?? [];
  // Tasks finished on an earlier day leave Today's focus; only today's wins stay visible (struck through).
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const visible = tasks.filter(
    (t) => (companyId === 'all' || projects.has(t.projectId)) && !(statuses.get(t.statusId)?.isDone && (t.completedAt ?? 0) < startOfToday),
  );
  const doneCount = visible.filter((t) => statuses.get(t.statusId)?.isDone).length;

  return (
    <Card className="px-5 pt-4 pb-2" label={title}>
      <div className="flex items-center justify-between pb-2">
        <span className="font-head text-[15px] font-bold">{title}</span>
        {visible.length > 0 && <Chip>{`${doneCount} of ${visible.length} done`}</Chip>}
      </div>
      {visible.length === 0 ? (
        <div className="pb-3">
          <EmptyState title="All clear">{emptyText}</EmptyState>
        </div>
      ) : (
        <ul className="m-0 list-none p-0">
          <AnimatePresence initial={false}>
            {visible.map((task) => {
              const project: ProjectSummary | undefined = projects.get(task.projectId);
              const status = statuses.get(task.statusId);
              const ci = companies.findIndex((c) => c.id === project?.companyId);
              const isRunning = timer.data?.running?.taskId === task.id;
              const isDone = !!status?.isDone;
              return (
                <motion.li key={task.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-3 border-t border-divider py-2.5 text-sm">
                  <CompanyDot color={companyColor(companies[ci], Math.max(0, ci))} />
                  <span className={`min-w-0 flex-1 truncate ${isDone ? 'text-text-3 line-through' : ''}`}>{task.name}</span>
                  <span className="hidden text-xs text-text-3 sm:inline">{project?.reportName ?? project?.name}</span>
                  {task.hulyKey && <span className="hidden text-xs text-text-3 md:inline">{task.hulyKey}</span>}
                  <StatusChip status={status} />
                  <span className="num w-14 text-right text-[13px] text-text-2">{task.estimateMinutes ? duration(task.estimateMinutes * MINUTE) : ''}</span>
                  {!isDone && (
                    <span className="flex gap-1.5">
                      <Button size="sm" variant={isRunning ? 'soft' : 'ghost'} aria-label={`Start timer on ${task.name}`} disabled={isRunning} onClick={() => start({ projectId: task.projectId, taskId: task.id })}>
                        <Play size={14} aria-hidden="true" />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Mark ${task.name} done`} onClick={() => complete.mutate({ id: task.id })}>
                        <Check size={14} aria-hidden="true" />
                      </Button>
                    </span>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </Card>
  );
}

function AfterWork({ summary }: { summary: WorkdaySummary }) {
  const s = summary;
  const flows = useWorkdayFlows();
  const evening = useReports({ workdayId: s.workday.id, type: 'evening', limit: 1 });
  const reopen = useAction<Record<string, never>, unknown>(`/api/workday/${s.workday.id}/reopen`);
  const copied = evening.data?.[0] ?? null;
  const stat = (value: string, label: string) => (
    <div>
      <div className="num font-head text-[30px] font-extrabold">{value}</div>
      <div className="text-[13px] text-text-2">{label}</div>
    </div>
  );
  return (
    <Card className="flex flex-col gap-5 p-7">
      <Label>
        Day complete · {timeOfDay(s.workday.checkInAt)} to {s.workday.checkOutAt ? timeOfDay(s.workday.checkOutAt) : '–'}
      </Label>
      <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
        {stat(duration(s.durationMs), 'workday')}
        {stat(duration(s.trackedMs), 'tracked work')}
        {stat(duration(s.breakMs), 'lunch and breaks')}
        {stat(duration(s.untrackedMs), 'untracked')}
        {stat(signedMinutes(s.balanceTodayMinutes), `balance today (${signedMinutes(s.runningBalanceMinutes)} total)`)}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-divider pt-4 text-sm">
        <span className="text-text-2">{copied ? `Evening message copied at ${timeOfDay(copied.createdAt)}` : 'Evening message not copied yet'}</span>
        <Button size="sm" variant={copied ? 'ghost' : 'primary'} onClick={() => flows.openMessage('evening', s.workday.id)}>
          {copied ? 'Open evening message' : 'Write evening message'}
        </Button>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => window.confirm('Reopen today’s workday? Its time balance is removed until you end it again.') && reopen.mutate({})}
          disabled={reopen.isPending}
        >
          Reopen workday
        </Button>
        {reopen.error && <span className="w-full text-danger">{reopen.error.message}</span>}
      </div>
    </Card>
  );
}
