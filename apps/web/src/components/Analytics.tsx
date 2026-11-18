import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api.ts';
import { useCompany } from '../lib/company.tsx';
import { duration, signedMinutes } from '../lib/format.ts';
import { useCatalog, useProjects } from '../lib/queries.ts';
import { Select } from './fields.tsx';
import { Button, Card, EmptyState } from './ui.tsx';

type Period = 'day' | 'week' | 'month';
const DAY = 86_400_000;

interface Row {
  id: string;
  name: string;
  ms: number;
  projectId?: string;
  projectName?: string;
}
export interface AnalyticsData {
  period: { from: number; to: number };
  workdayMs: number | null;
  trackedMs: number;
  breakMs: number | null;
  byKind: Record<string, number>;
  revisionShare: number;
  byCompany: Row[];
  byProject: Row[];
  byCategory: Row[];
  byTask: Row[];
  tasksCompleted: number;
  tasksUnfinished: number;
  estimates: { withEstimate: number; overEstimate: number; tasks: { taskId: string; name: string; projectName: string; estimateMs: number; actualMs: number }[] };
  series: { date: string; trackedMs: number; breakMs: number; workdayMs: number; balanceMinutes: number | null; runningBalanceMinutes: number }[];
}

function startOf(period: Period, ts: number): number {
  const d = new Date(ts);
  if (period === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (period === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
}
function shift(period: Period, from: number, by: number): number {
  const d = new Date(from);
  if (period === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + by).getTime();
  if (period === 'month') return new Date(d.getFullYear(), d.getMonth() + by, 1).getTime();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * by).getTime();
}
const mondayOf = (ts: number) => startOf('week', ts);
const fmtDay = (ts: number, opts: Intl.DateTimeFormatOptions) => new Date(ts).toLocaleDateString('en-GB', opts);
const dateOf = (key: string) => new Date(`${key}T12:00:00`).getTime();

/** Reports analytics (spec screen 9 and flow 10). */
export function Analytics() {
  const { companyId: globalCompany } = useCompany();
  const catalog = useCatalog();
  const projects = useProjects();
  const [period, setPeriod] = useState<Period>('week');
  const [from, setFrom] = useState(() => startOf('week', Date.now()));
  const [company, setCompany] = useState(globalCompany === 'all' ? '' : globalCompany);
  const [project, setProject] = useState('');
  const [category, setCategory] = useState('');
  const [tag, setTag] = useState('');
  const to = shift(period, from, 1);

  const q = new URLSearchParams({ from: String(from), to: String(to) });
  if (company) q.set('companyId', company);
  if (project) q.set('projectId', project);
  if (category) q.set('categoryId', category);
  if (tag) q.set('tagId', tag);
  const data = useQuery({ queryKey: ['projects', 'analytics', q.toString()] as const, queryFn: () => api<AnalyticsData>(`/api/analytics?${q}`), placeholderData: (prev) => prev });

  const label =
    period === 'day'
      ? fmtDay(from, { weekday: 'long', day: 'numeric', month: 'long' })
      : period === 'month'
        ? fmtDay(from, { month: 'long', year: 'numeric' })
        : `${fmtDay(from, { day: 'numeric', month: 'short' })} – ${fmtDay(to - DAY, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const isCurrent = from === startOf(period, Date.now());
  const tags = ((catalog.data as unknown as { tags?: { id: string; name: string }[] })?.tags ?? []) as { id: string; name: string }[];
  const projectList = (projects.data ?? []).filter((p) => !company || p.companyId === company);
  const d = data.data;
  const empty = d && d.trackedMs === 0 && (d.workdayMs ?? 0) === 0;

  return (
    <section aria-labelledby="analytics-title" className="flex flex-col gap-4">
      <h2 id="analytics-title" className="m-0 font-head text-xl font-extrabold">
        Hours
      </h2>
      {/* Filters: one row above the charts. */}
      <div role="group" aria-label="Analytics filters" className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Period" className="flex rounded-field border border-line p-0.5">
          {(['day', 'week', 'month'] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              onClick={() => {
                setPeriod(p);
                setFrom(startOf(p, Date.now()));
              }}
              className={`min-h-8 rounded-[6px] px-3 text-[13px] font-semibold capitalize ${period === p ? 'bg-accent text-on-accent' : 'text-text-2 hover:bg-surface-2'}`}
            >
              {p}
            </button>
          ))}
        </div>
        <Button size="sm" className="px-2" aria-label={`Previous ${period}`} onClick={() => setFrom(shift(period, from, -1))}>
          <ChevronLeft size={15} aria-hidden="true" />
        </Button>
        <span className="num min-w-[150px] text-center text-sm font-semibold" aria-live="polite">
          {label}
        </span>
        <Button size="sm" className="px-2" aria-label={`Next ${period}`} onClick={() => setFrom(shift(period, from, 1))}>
          <ChevronRight size={15} aria-hidden="true" />
        </Button>
        {!isCurrent && (
          <Button size="sm" onClick={() => setFrom(startOf(period, Date.now()))}>
            This {period}
          </Button>
        )}
        <span className="flex flex-1 flex-wrap justify-end gap-2">
          <Select aria-label="Company" value={company} onChange={(e) => (setCompany(e.target.value), setProject(''))} className="w-[160px]">
            <option value="">All companies</option>
            {(catalog.data?.companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)} className="w-[180px]">
            <option value="">All projects</option>
            {projectList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-[150px]">
            <option value="">All categories</option>
            {(catalog.data?.categories ?? []).filter((c) => c.archivedAt === null).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {tags.length > 0 && (
            <Select aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)} className="w-[140px]">
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </span>
      </div>

      {data.isLoading || !d ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-card bg-sunken" aria-label="Loading" />
          ))}
        </div>
      ) : empty ? (
        <EmptyState title="No time in this period">Track a few days to see trends, or pick another period.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4" aria-busy={data.isFetching}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Tile value={d.workdayMs === null ? '–' : duration(d.workdayMs)} label={d.workdayMs === null ? 'workday (all work only)' : 'workday time'} />
            <Tile value={duration(d.trackedMs)} label="tracked work" />
            <Tile value={d.breakMs === null ? '–' : duration(d.breakMs)} label="lunch and breaks" />
            <Tile value={`${Math.round(d.revisionShare * 100)}%`} label="revision time" />
            <Tile value={`${d.tasksCompleted}`} label={`completed · ${d.tasksUnfinished} still planned`} />
            <Tile value={d.estimates.withEstimate ? `${d.estimates.overEstimate} of ${d.estimates.withEstimate}` : '–'} label="finished tasks over estimate" />
          </div>

          {period !== 'day' && <DailyChart series={d.series} />}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BarList title="By company" rows={d.byCompany} total={d.trackedMs} />
            <BarList title="Client vs internal" rows={d.byCategory} total={d.trackedMs} />
            <BarList title="By project" rows={d.byProject.slice(0, 10)} total={d.trackedMs} link={(r) => ({ projectId: r.id, week: mondayOf(from) })} />
            <BarList title="Top tasks" rows={d.byTask} total={d.trackedMs} sub={(r) => r.projectName} link={(r) => ({ projectId: r.projectId!, week: mondayOf(from) })} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <KindSplit byKind={d.byKind} />
            {period !== 'day' && d.workdayMs !== null && <BalanceChart series={d.series} />}
          </div>

          <EstimateTable rows={d.estimates.tasks} />
        </div>
      )}
    </section>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <Card as="div" className="flex flex-col gap-1 px-4 py-3.5">
      <span className="num font-head text-[26px] leading-tight font-extrabold">{value}</span>
      <span className="text-xs text-text-2">{label}</span>
    </Card>
  );
}

/** A chart card with a title and a Table view toggle (every value is reachable without hover). */
function ChartCard({ title, children, table, legend }: { title: string; children: ReactNode; table: ReactNode; legend?: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className="flex flex-col gap-3 px-5 pt-4 pb-4" label={title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 font-head text-[15px] font-bold">{title}</h3>
        <button type="button" aria-pressed={asTable} onClick={() => setAsTable(!asTable)} className="text-xs font-semibold text-accent-ink hover:underline">
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {legend && !asTable && legend}
      {asTable ? table : children}
    </Card>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`border-b border-line py-1.5 text-xs font-semibold text-text-2 ${i ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`num border-b border-divider py-1.5 ${j ? 'text-right text-text-2' : ''}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One hover/focus tooltip per chart; the value leads. */
function useTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; value: string; label: string } | null>(null);
  const show = (el: HTMLElement, value: string, label: string) => {
    const box = ref.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (box) setTip({ x: r.left + r.width / 2 - box.left, y: r.top - box.top, value, label });
  };
  const node = tip && (
    <div role="tooltip" className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-field border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md" style={{ left: tip.x, top: tip.y - 6 }}>
      <div className="num font-bold text-text">{tip.value}</div>
      <div className="text-text-2">{tip.label}</div>
    </div>
  );
  return { ref, show, hide: () => setTip(null), node };
}

function niceMax(maxHours: number) {
  const steps = [1, 2, 4, 6, 8, 10, 12, 16, 24];
  return steps.find((s) => s >= maxHours) ?? Math.ceil(maxHours);
}

/** Tracked work per day: one series, so one hue and no legend; click a day to open that week in Time. */
function DailyChart({ series }: { series: AnalyticsData['series'] }) {
  const navigate = useNavigate();
  const tt = useTooltip();
  const maxH = niceMax(Math.max(1, ...series.map((s) => s.trackedMs / 3_600_000)));
  const ticks = [0, maxH / 2, maxH];
  const many = series.length > 10;
  return (
    <ChartCard title="Tracked work per day" table={<DataTable head={['Day', 'Tracked', 'Workday']} rows={series.map((s) => [fmtDay(dateOf(s.date), { weekday: 'short', day: 'numeric', month: 'short' }), duration(s.trackedMs), s.workdayMs ? duration(s.workdayMs) : '–'])} />}>
      <div ref={tt.ref} className="relative">
        {tt.node}
        <div className="relative flex h-48 items-end gap-[2px] pl-9">
          {ticks.map((t) => (
            <div key={t} className="pointer-events-none absolute inset-x-0 left-9 border-t border-divider" style={{ bottom: `${(t / maxH) * 100}%` }}>
              <span className="num absolute -top-2 -left-9 w-7 text-right text-[11px] text-text-3">{t}h</span>
            </div>
          ))}
          {series.map((s) => {
            const pct = (s.trackedMs / 3_600_000 / maxH) * 100;
            const label = fmtDay(dateOf(s.date), { weekday: 'long', day: 'numeric', month: 'short' });
            return (
              <button
                key={s.date}
                type="button"
                aria-label={`${label}: ${duration(s.trackedMs)} tracked`}
                onMouseEnter={(e) => tt.show(e.currentTarget, duration(s.trackedMs), label)}
                onFocus={(e) => tt.show(e.currentTarget, duration(s.trackedMs), label)}
                onMouseLeave={tt.hide}
                onBlur={tt.hide}
                onClick={() => void navigate({ to: '/time', search: { week: mondayOf(dateOf(s.date)) } })}
                className="group relative flex h-full flex-1 items-end justify-center"
              >
                <span className="w-full max-w-10 rounded-t-[4px] bg-[var(--mt-viz-bar)] group-hover:brightness-110" style={{ height: `${Math.max(pct, s.trackedMs ? 1.5 : 0)}%` }} />
              </button>
            );
          })}
        </div>
        <div className="flex gap-[2px] pl-9 pt-1.5">
          {series.map((s, i) => (
            <span key={s.date} className="num flex-1 text-center text-[11px] text-text-3">
              {many ? (i % 5 === 0 ? new Date(dateOf(s.date)).getDate() : '') : fmtDay(dateOf(s.date), { weekday: 'short' })}
            </span>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

/** Horizontal magnitude bars, sorted; values labelled at the end of each bar. */
function BarList({ title, rows, total, sub, link }: { title: string; rows: Row[]; total: number; sub?: (r: Row) => string | undefined; link?: (r: Row) => { projectId: string; week: number } }) {
  const max = Math.max(1, ...rows.map((r) => r.ms));
  return (
    <ChartCard title={title} table={<DataTable head={['Name', 'Hours', 'Share']} rows={rows.map((r) => [r.name, duration(r.ms), `${total ? Math.round((r.ms / total) * 100) : 0}%`])} />}>
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-text-3">No tracked time.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {rows.map((r) => {
            const content = (
              <>
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    {r.name}
                    {sub?.(r) && <span className="text-xs text-text-3"> · {sub(r)}</span>}
                  </span>
                  <span className="num shrink-0 text-text-2">
                    {duration(r.ms)} <span className="text-xs text-text-3">{total ? Math.round((r.ms / total) * 100) : 0}%</span>
                  </span>
                </span>
                <span className="mt-1 block h-2 rounded-full bg-bar">
                  <span className="block h-2 rounded-full bg-[var(--mt-viz-bar)]" style={{ width: `${(r.ms / max) * 100}%` }} />
                </span>
              </>
            );
            const target = link?.(r);
            return (
              <li key={r.id}>
                {target ? (
                  <Link to="/time" search={target} className="block rounded-[6px] hover:bg-surface-2" aria-label={`${r.name}: ${duration(r.ms)}. Open its time entries`}>
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}

/** Work vs revision vs meeting: one stacked bar, 2px gaps, legend plus labelled values. */
function KindSplit({ byKind }: { byKind: Record<string, number> }) {
  const parts = [
    { key: 'work', label: 'First-pass work', color: 'var(--mt-viz-1)', ms: byKind.work ?? 0 },
    { key: 'revision', label: 'Revisions', color: 'var(--mt-viz-2)', ms: byKind.revision ?? 0 },
    { key: 'meeting', label: 'Meetings', color: 'var(--mt-viz-3)', ms: byKind.meeting ?? 0 },
  ];
  const total = parts.reduce((s, p) => s + p.ms, 0);
  const pct = (ms: number) => (total ? Math.round((ms / total) * 100) : 0);
  return (
    <ChartCard
      title="Kind of work"
      table={<DataTable head={['Kind', 'Hours', 'Share']} rows={parts.map((p) => [p.label, duration(p.ms), `${pct(p.ms)}%`])} />}
      legend={
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm" aria-label="Legend">
          {parts.map((p) => (
            <li key={p.key} className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-3 rounded-full" style={{ background: p.color }} aria-hidden="true" />
              {p.label} <span className="num text-text-2">{duration(p.ms)} · {pct(p.ms)}%</span>
            </li>
          ))}
        </ul>
      }
    >
      <div className="flex h-5 gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={parts.map((p) => `${p.label} ${pct(p.ms)}%`).join(', ')}>
        {parts
          .filter((p) => p.ms > 0)
          .map((p) => (
            <span key={p.key} className="h-full" style={{ width: `${(p.ms / total) * 100}%`, background: p.color }} />
          ))}
      </div>
    </ChartCard>
  );
}

/** Daily time balance: diverging around zero (blue above expected, red below), with the running total. */
function BalanceChart({ series }: { series: AnalyticsData['series'] }) {
  const tt = useTooltip();
  const days = series.filter((s) => s.balanceMinutes !== null);
  const maxAbs = Math.max(30, ...days.map((s) => Math.abs(s.balanceMinutes!)));
  const last = series[series.length - 1];
  return (
    <ChartCard
      title="Time balance"
      table={<DataTable head={['Day', 'Balance', 'Running total']} rows={days.map((s) => [fmtDay(dateOf(s.date), { weekday: 'short', day: 'numeric', month: 'short' }), signedMinutes(s.balanceMinutes!), signedMinutes(s.runningBalanceMinutes)])} />}
      legend={
        <p className="m-0 text-sm text-text-2">
          Running total at the end of the period: <strong className="num text-text">{last ? signedMinutes(last.runningBalanceMinutes) : '–'}</strong>
        </p>
      }
    >
      {days.length === 0 ? (
        <p className="m-0 text-sm text-text-3">No ended workdays in this period.</p>
      ) : (
        <div ref={tt.ref} className="relative">
          {tt.node}
          <div className="relative flex h-40 gap-[2px]">
            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-line" aria-hidden="true" />
            {series.map((s) => {
              const b = s.balanceMinutes;
              const h = b === null ? 0 : (Math.abs(b) / maxAbs) * 50;
              const label = fmtDay(dateOf(s.date), { weekday: 'long', day: 'numeric', month: 'short' });
              const value = b === null ? 'no workday' : `${signedMinutes(b)} · total ${signedMinutes(s.runningBalanceMinutes)}`;
              return (
                <button
                  key={s.date}
                  type="button"
                  aria-label={`${label}: ${value}`}
                  disabled={b === null}
                  onMouseEnter={(e) => tt.show(e.currentTarget, value, label)}
                  onFocus={(e) => tt.show(e.currentTarget, value, label)}
                  onMouseLeave={tt.hide}
                  onBlur={tt.hide}
                  className="relative h-full flex-1"
                >
                  {b !== null && b !== 0 && (
                    <span
                      className={`absolute inset-x-[15%] ${b > 0 ? 'rounded-t-[4px]' : 'rounded-b-[4px]'}`}
                      style={b > 0 ? { bottom: '50%', height: `${h}%`, background: 'var(--mt-viz-pos)' } : { top: '50%', height: `${h}%`, background: 'var(--mt-viz-neg)' }}
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex gap-[2px] pt-1.5">
            {series.map((s, i) => (
              <span key={s.date} className="num flex-1 text-center text-[11px] text-text-3">
                {series.length > 10 ? (i % 5 === 0 ? new Date(dateOf(s.date)).getDate() : '') : fmtDay(dateOf(s.date), { weekday: 'short' })}
              </span>
            ))}
          </div>
          <div className="flex justify-between pt-1 text-[11px] text-text-3">
            <span>Above the line: worked more than expected</span>
            <span>Below: less</span>
          </div>
        </div>
      )}
    </ChartCard>
  );
}

function EstimateTable({ rows: sorted }: { rows: AnalyticsData['estimates']['tasks'] }) {
  if (!sorted.length) return null;
  return (
    <Card className="flex flex-col gap-2 px-5 pt-4 pb-4" label="Estimate vs actual">
      <h3 className="m-0 font-head text-[15px] font-bold">Estimate vs actual (finished tasks)</h3>
      <DataTable
        head={['Task', 'Estimate', 'Actual', 'Difference']}
        rows={sorted.map((t) => [`${t.name} · ${t.projectName}`, duration(t.estimateMs), duration(t.actualMs), `${t.actualMs >= t.estimateMs ? '+' : '−'}${duration(Math.abs(t.actualMs - t.estimateMs))}`])}
      />
      <p className="m-0 text-xs text-text-3">Actual counts all time ever tracked on the task, so a task finished this period may include earlier days.</p>
    </Card>
  );
}

