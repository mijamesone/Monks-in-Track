import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowRight, CalendarClock, Check, Play, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStartTimer } from '../lib/actions.ts';
import { post } from '../lib/api.ts';
import { useCompany } from '../lib/company.tsx';
import { duration, timeOfDay, MINUTE } from '../lib/format.ts';
import { useCatalog, useDashboard, usePlanBoard, useProjects, useReports, useTimer, useToday, type DashboardData } from '../lib/queries.ts';
import { useQueryClient } from '@tanstack/react-query';
import type { Task } from '../lib/types.ts';
import { Button, Card, Chip, CompanyDot, StatusChip, companyColor } from './ui.tsx';

/** Dashboard data for the selected company. */
export function useDashboardData() {
  const { companyId } = useCompany();
  return useDashboard(companyId === 'all' ? undefined : companyId);
}

function CardTitle({ children, count, action }: { children: ReactNode; count?: number; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 pb-2">
      <h2 className="m-0 font-head text-[15px] font-bold">
        {children} {count !== undefined && count > 0 && <span className="num font-medium text-text-3">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 py-2 text-sm text-text-3">{children}</p>;
}

function useTaskLook() {
  const catalog = useCatalog();
  const projects = useProjects();
  const companies = catalog.data?.companies ?? [];
  const projectOf = (t: { projectId: string }) => projects.data?.find((p) => p.id === t.projectId);
  return {
    dot: (t: { projectId: string }) => {
      const ci = companies.findIndex((c) => c.id === projectOf(t)?.companyId);
      return companyColor(companies[ci], Math.max(0, ci));
    },
    project: (t: { projectId: string }) => projectOf(t)?.reportName || projectOf(t)?.name || '',
    status: (t: Task) => catalog.data?.statuses.find((s) => s.id === t.statusId),
  };
}

/** Card F: quick switch to the tasks you worked on most recently. */
export function QuickSwitchCard({ data }: { data: DashboardData | undefined }) {
  const look = useTaskLook();
  const timer = useTimer();
  const { start } = useStartTimer();
  const list = (data?.recentTasks ?? []).filter((t) => t.id !== timer.data?.running?.taskId);
  return (
    <Card className="px-5 pt-4 pb-3" label="Quick switch">
      <CardTitle>Quick switch</CardTitle>
      {list.length === 0 ? (
        <Empty>Tasks you track time on show up here for a one-click switch.</Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {list.map((t) => (
            <li key={t.id} className="flex items-center gap-3 border-t border-divider py-2 text-sm first:border-t-0">
              <CompanyDot color={look.dot(t)} />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              <span className="hidden max-w-[140px] truncate text-xs text-text-3 sm:inline">{look.project(t)}</span>
              <Button size="sm" variant="ghost" className="px-2" aria-label={`Switch to ${t.name}`} onClick={() => start({ projectId: t.projectId, taskId: t.id })}>
                <Play size={13} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Card G: revision rounds that are requested or in progress. */
export function RevisionsDueCard({ data }: { data: DashboardData | undefined }) {
  const list = data?.revisionsDue ?? [];
  return (
    <Card className="px-5 pt-4 pb-3" label="Revisions due">
      <CardTitle count={list.length}>Revisions due</CardTitle>
      {list.length === 0 ? (
        <Empty>No open revision rounds.</Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {list.slice(0, 6).map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <Chip>Round {r.number}</Chip>
              <Link to="/projects/$projectId" params={{ projectId: r.projectId }} className="min-w-0 flex-1 truncate hover:underline">
                {r.projectName}: {r.title}
              </Link>
              <span className="text-xs text-text-3">{r.status === 'in_progress' ? 'in progress' : 'requested'}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Card H: what you finished today. */
export function CompletedTodayCard({ data }: { data: DashboardData | undefined }) {
  const look = useTaskLook();
  const list = data?.completedToday ?? [];
  return (
    <Card className="px-5 pt-4 pb-3" label="Completed today">
      <CardTitle count={list.length}>Completed today</CardTitle>
      {list.length === 0 ? (
        <Empty>Nothing finished yet today.</Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {list.map((t) => (
            <li key={t.id} className="flex items-center gap-2.5 text-sm">
              <Check size={14} className="shrink-0 text-mint" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              <span className="text-xs text-text-3">{t.completedAt ? timeOfDay(t.completedAt) : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Card I: deadlines in the next 7 days, overdue first. */
export function DeadlinesCard({ data }: { data: DashboardData | undefined }) {
  const list = data?.deadlines ?? [];
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <Card className="px-5 pt-4 pb-3" label="Deadlines">
      <CardTitle count={list.length}>Deadlines this week</CardTitle>
      {list.length === 0 ? (
        <Empty>No deadlines in the next 7 days.</Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {list.slice(0, 6).map((d) => (
            <li key={`${d.kind}-${d.id}`} className="flex items-center gap-2 text-sm">
              <CalendarClock size={14} className={`shrink-0 ${d.overdue ? 'text-danger' : 'text-text-3'}`} aria-hidden="true" />
              <Link to="/projects/$projectId" params={{ projectId: d.projectId }} className="min-w-0 flex-1 truncate hover:underline">
                {d.name}
                {d.kind === 'task' && <span className="text-text-3"> · {d.projectName}</span>}
              </Link>
              <span className={`text-xs ${d.overdue ? 'font-semibold text-danger' : 'text-text-2'}`}>{d.overdue ? `overdue · ${fmt(d.date)}` : fmt(d.date)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Card J: things that need your attention now. */
export function AlertsCard({ data, morningCopied, workdayOpen }: { data: DashboardData | undefined; morningCopied: boolean | null; workdayOpen: boolean }) {
  const catalog = useCatalog();
  const timer = useTimer();
  const s = catalog.data?.settings;
  const capacity = s ? s.fullDayMinutes - s.lunchMinutes : 480;
  const ctx = timer.data?.runningContext;
  const running = timer.data?.running;
  const overEstimate = !!(running && ctx?.estimateMinutes && ctx.priorMs + ((timer.data?.now ?? Date.now()) - running.startedAt) > ctx.estimateMinutes * MINUTE);
  const items: { key: string; text: string; to?: '/time' | '/plan' }[] = [];
  if (data?.alerts.overlapsToday) items.push({ key: 'overlap', text: `${data.alerts.overlapsToday} overlapping time ${data.alerts.overlapsToday > 1 ? 'entries' : 'entry'} today`, to: '/time' });
  if (data && data.alerts.todayEstimateMinutes > capacity) items.push({ key: 'capacity', text: `Today is planned for ${duration(data.alerts.todayEstimateMinutes * MINUTE)}, more than ${duration(capacity * MINUTE)}`, to: '/plan' });
  if (data?.alerts.overdue) items.push({ key: 'overdue', text: `${data.alerts.overdue} overdue deadline${data.alerts.overdue > 1 ? 's' : ''}` });
  if (overEstimate) items.push({ key: 'estimate', text: `${ctx?.taskName ?? ctx?.projectName} is over its estimate` });
  if (workdayOpen && morningCopied === false) items.push({ key: 'morning', text: 'Morning message not copied yet' });
  return (
    <Card className="px-5 pt-4 pb-3" label="Alerts">
      <CardTitle count={items.length}>Alerts</CardTitle>
      {items.length === 0 ? (
        <Empty>All clear.</Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {items.map((a) => (
            <li key={a.key} className="flex items-center gap-2 text-sm">
              <AlertTriangle size={14} className="shrink-0 text-amber" aria-hidden="true" />
              <span className="min-w-0 flex-1">{a.text}</span>
              {a.to && (
                <Link to={a.to} className="inline-flex items-center gap-1 text-xs font-semibold text-accent-ink hover:underline">
                  Open <ArrowRight size={12} aria-hidden="true" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Card K: productivity summary. */
export function ProductivityCard({ data }: { data: DashboardData | undefined }) {
  const today = useToday();
  const catalog = useCatalog();
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const statuses = new Map((catalog.data?.statuses ?? []).map((s) => [s.id, s]));
  const focus = (today.data ?? []).filter((t) => {
    const st = statuses.get(t.statusId);
    return st && !st.isRejected && !(st.isDone && (t.completedAt ?? 0) < startOfToday);
  });
  const done = focus.filter((t) => statuses.get(t.statusId)?.isDone).length;
  const stat = (value: string, label: string) => (
    <div>
      <div className="num font-head text-[22px] font-extrabold">{value}</div>
      <div className="text-xs text-text-2">{label}</div>
    </div>
  );
  return (
    <Card className="px-5 pt-4 pb-4" label="Productivity">
      <CardTitle>Productivity</CardTitle>
      <div className="grid grid-cols-3 gap-3">
        {stat(duration(data?.productivity.todayTrackedMs ?? 0), 'tracked today')}
        {stat(duration(data?.productivity.weekTrackedMs ?? 0), 'this week')}
        {stat(`${done}/${focus.length}`, 'focus done')}
      </div>
    </Card>
  );
}

/** Before work: tasks from This Week you could pull into Today. */
export function SuggestionsCard() {
  const qc = useQueryClient();
  const { companyId } = useCompany();
  const board = usePlanBoard(companyId === 'all' ? undefined : companyId);
  const look = useTaskLook();
  const list = (board.data?.columns.this_week ?? []).filter((t) => !look.status(t)?.isDone).slice(0, 5);
  const add = async (t: Task) => {
    await post('/api/plan/move', { taskIds: [t.id], bucket: 'today' });
    void qc.invalidateQueries({ queryKey: ['plan'] });
    void qc.invalidateQueries({ queryKey: ['workday'] });
  };
  return (
    <Card className="px-5 pt-4 pb-3" label="From This Week">
      <CardTitle
        action={
          <Link to="/plan" className="text-xs font-semibold text-accent-ink hover:underline">
            Open Plan
          </Link>
        }
      >
        From This Week
      </CardTitle>
      {list.length === 0 ? (
        <Empty>Nothing waiting in This Week.</Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {list.map((t) => (
            <li key={t.id} className="flex items-center gap-3 border-t border-divider py-2 text-sm first:border-t-0">
              <CompanyDot color={look.dot(t)} />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              <StatusChip status={look.status(t)} />
              <Button size="sm" variant="ghost" className="px-2" aria-label={`Add ${t.name} to Today`} onClick={() => void add(t)}>
                <Plus size={13} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** After work: today's open focus tasks, which carry over tomorrow. */
export function TomorrowCard() {
  const today = useToday();
  const look = useTaskLook();
  const list = (today.data ?? []).filter((t) => {
    const st = look.status(t);
    return st && !st.isDone && !st.isRejected;
  });
  return (
    <Card className="px-5 pt-4 pb-3" label="For tomorrow">
      <CardTitle count={list.length}>For tomorrow</CardTitle>
      {list.length === 0 ? (
        <Empty>Today's focus is done. Nothing carries over.</Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {list.map((t) => (
            <li key={t.id} className="flex items-center gap-2.5 text-sm">
              <CompanyDot color={look.dot(t)} />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              <span className="text-xs text-text-3">{look.project(t)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** After work: today's copied messages. */
export function TodaysMessagesCard({ workdayId }: { workdayId: string }) {
  const reports = useReports({ workdayId, limit: 20 });
  const label = { morning: 'Morning', evening: 'Evening', lunch_start: 'Lunch start', lunch_end: 'Back from lunch' } as const;
  return (
    <Card className="px-5 pt-4 pb-3" label="Today's messages">
      <CardTitle
        action={
          <Link to="/reports" className="text-xs font-semibold text-accent-ink hover:underline">
            All messages
          </Link>
        }
      >
        Today's messages
      </CardTitle>
      {(reports.data ?? []).length === 0 ? (
        <Empty>No messages copied today.</Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {[...(reports.data ?? [])].reverse().map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <Chip>{label[r.type]}</Chip>
              <span className="text-text-2">copied at {timeOfDay(r.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Cards that arrive with later phases, shown so the layout is final. */
export function ComingCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="border-dashed px-5 pt-4 pb-3" label={title}>
      <CardTitle>{title}</CardTitle>
      <p className="m-0 text-sm text-text-3">{children}</p>
    </Card>
  );
}
