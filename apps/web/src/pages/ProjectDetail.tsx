import { Link, useParams } from '@tanstack/react-router';
import { Archive, ArrowLeft, Check, ChevronRight, CornerDownRight, ExternalLink, IndentDecrease, IndentIncrease, Play, Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Field, Select, TextArea, TextInput, minutesText, parseMinutes } from '../components/fields.tsx';
import { Button, Card, Chip, CompanyDot, EmptyState, Label, StatusChip, companyColor } from '../components/ui.tsx';
import { useStartTimer } from '../lib/actions.ts';
import { duration, timeOfDay, MINUTE } from '../lib/format.ts';
import {
  useCatalog,
  useMutate,
  useProject,
  useProjectEntries,
  useProjectTasks,
  useRevisions,
  useTimer,
  type ProjectDetail as Project,
  type TaskWithTime,
} from '../lib/queries.ts';

type Tab = 'tasks' | 'overview' | 'time' | 'revisions';

export function ProjectDetail() {
  const { projectId } = useParams({ from: '/projects/$projectId' });
  const project = useProject(projectId);
  const catalog = useCatalog();
  const [tab, setTab] = useState<Tab>('tasks');
  const { start } = useStartTimer();
  const archive = useMutate<{ archived: boolean }>('PATCH', () => `/api/projects/${projectId}`);

  if (project.isLoading) return <div className="mx-auto h-60 max-w-6xl animate-pulse rounded-card bg-sunken" aria-label="Loading" />;
  if (project.error || !project.data)
    return (
      <div className="mx-auto max-w-6xl">
        <EmptyState title="Project not found" action={<Link to="/projects">Back to projects</Link>} />
      </div>
    );
  const p = project.data;
  const companies = catalog.data?.companies ?? [];
  const ci = companies.findIndex((c) => c.id === p.companyId);
  const status = catalog.data?.statuses.find((s) => s.id === p.statusId);
  const category = catalog.data?.categories.find((c) => c.id === p.categoryId);
  const estimateMs = p.estimateMinutes !== null ? p.estimateMinutes * MINUTE : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <Link to="/projects" className="inline-flex w-fit items-center gap-1.5 text-sm text-text-2 hover:text-text">
        <ArrowLeft size={15} aria-hidden="true" /> Projects
      </Link>

      {p.archivedAt && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-sunken px-4 py-3 text-sm">
          <span>This project is archived. Its hours still count in Reports.</span>
          <Button size="sm" onClick={() => archive.mutate({ archived: false })}>
            Unarchive
          </Button>
        </div>
      )}

      <Card className="flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="m-0 font-head text-[30px] leading-tight font-extrabold tracking-[-0.02em]">{p.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Chip>
                <CompanyDot color={companyColor(companies[ci], Math.max(0, ci))} size={8} />
                {companies[ci]?.name}
              </Chip>
              {category && <Chip>{category.name}</Chip>}
              <StatusChip status={status} />
              {p.reportName && <Chip>Reports as {p.reportName}</Chip>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => start({ projectId: p.id, taskId: null })} disabled={!!p.archivedAt}>
              <Play size={15} aria-hidden="true" /> Track project time
            </Button>
            {p.hulyUrl && (
              <a href={p.hulyUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-field border border-line px-4 text-sm font-semibold hover:bg-surface-2">
                <ExternalLink size={15} aria-hidden="true" /> Open in Huly
              </a>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <Stat value={p.completion.percent === null ? '–' : `${p.completion.percent}%`} label={`complete (${p.completion.done} of ${p.completion.total})`}>
            <Ring percent={p.completion.percent ?? 0} />
          </Stat>
          <Stat value={duration(p.totals.total)} label={`tracked · ${duration(p.totals.direct)} project-level`} />
          <Stat value={estimateMs !== null ? duration(estimateMs) : '–'} label={`estimate · tasks add up to ${duration(p.taskEstimateMinutes * MINUTE)}`} />
          <Stat
            value={estimateMs === null ? '–' : p.totals.total > estimateMs ? `+${duration(p.totals.total - estimateMs)}` : duration(estimateMs - p.totals.total)}
            label={estimateMs !== null && p.totals.total > estimateMs ? 'over estimate' : 'remaining'}
            danger={estimateMs !== null && p.totals.total > estimateMs}
          />
        </div>
      </Card>

      <div role="tablist" aria-label="Project sections" className="flex gap-1 border-b border-line">
        {(['tasks', 'overview', 'time', 'revisions'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`relative min-h-10 px-4 text-sm font-semibold capitalize ${tab === t ? 'text-accent-ink' : 'text-text-2 hover:text-text'}`}
          >
            {t}
            {tab === t && <motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          {tab === 'tasks' && <TaskTree project={p} />}
          {tab === 'overview' && <Overview project={p} />}
          {tab === 'time' && <TimeTab project={p} />}
          {tab === 'revisions' && <Revisions project={p} />}
        </motion.div>
      </AnimatePresence>

      <div className="flex justify-end">
        {!p.archivedAt && (
          <Button variant="danger" size="sm" onClick={() => window.confirm(`Archive "${p.name}"? Its tracked time stays in Reports.`) && archive.mutate({ archived: true })}>
            <Archive size={14} aria-hidden="true" /> Archive project
          </Button>
        )}
      </div>
    </div>
  );
}

function Stat({ value, label, children, danger }: { value: string; label: string; children?: React.ReactNode; danger?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {children}
      <div>
        <div className={`num font-head text-[26px] font-extrabold ${danger ? 'text-danger' : ''}`}>{value}</div>
        <div className="text-[13px] text-text-2">{label}</div>
      </div>
    </div>
  );
}

function Ring({ percent }: { percent: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
      <circle cx="23" cy="23" r={r} fill="none" stroke="var(--mt-bar)" strokeWidth="5" />
      <motion.circle
        cx="23"
        cy="23"
        r={r}
        fill="none"
        stroke="var(--mt-accent)"
        strokeWidth="5"
        strokeLinecap="round"
        transform="rotate(-90 23 23)"
        strokeDasharray={c}
        initial={false}
        animate={{ strokeDashoffset: c * (1 - percent / 100) }}
        transition={{ type: 'spring', stiffness: 70, damping: 18 }}
      />
    </svg>
  );
}

// ───────────────────────── task tree ─────────────────────────

interface Node {
  task: TaskWithTime;
  depth: number;
  hasChildren: boolean;
}

function flatten(tasks: TaskWithTime[], collapsed: Set<string>): Node[] {
  const kids = new Map<string | null, TaskWithTime[]>();
  for (const t of tasks) {
    const list = kids.get(t.parentId) ?? [];
    list.push(t);
    kids.set(t.parentId, list);
  }
  const ids = new Set(tasks.map((t) => t.id));
  const out: Node[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const t of (kids.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)) {
      const hasChildren = (kids.get(t.id) ?? []).length > 0;
      out.push({ task: t, depth, hasChildren });
      if (!collapsed.has(t.id)) walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  // Orphans (parent archived) still show at top level.
  for (const t of tasks) if (t.parentId && !ids.has(t.parentId) && !out.some((n) => n.task.id === t.id)) out.push({ task: t, depth: 0, hasChildren: false });
  return out;
}

function TaskTree({ project }: { project: Project }) {
  const tasks = useProjectTasks(project.id);
  const catalog = useCatalog();
  const timer = useTimer();
  const { start, error: startError } = useStartTimer();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const statuses = catalog.data?.statuses ?? [];
  const nodes = useMemo(() => flatten(tasks.data ?? [], collapsed), [tasks.data, collapsed]);
  const patch = useMutate<{ id: string; body: Record<string, unknown> }>('PATCH', (v) => `/api/tasks/${v.id}`, (v) => v.body);
  const move = useMutate<{ id: string; parentId: string | null }>('POST', (v) => `/api/tasks/${v.id}/move`, (v) => ({ projectId: project.id, parentId: v.parentId }));
  const complete = useMutate<{ id: string; completeSubtasks: boolean }>('POST', (v) => `/api/tasks/${v.id}/complete`, (v) => ({ completeSubtasks: v.completeSubtasks }));

  const indent = (i: number) => {
    const node = nodes[i]!;
    // The previous row at the same depth becomes the parent.
    for (let j = i - 1; j >= 0; j--) {
      const prev = nodes[j]!;
      if (prev.depth < node.depth) return;
      if (prev.depth === node.depth) return move.mutate({ id: node.task.id, parentId: prev.task.id });
    }
  };
  const outdent = (n: Node) => {
    if (!n.task.parentId) return;
    const parent = tasks.data?.find((t) => t.id === n.task.parentId);
    move.mutate({ id: n.task.id, parentId: parent?.parentId ?? null });
  };
  const toggleDone = (n: Node) => {
    const st = statuses.find((s) => s.id === n.task.statusId);
    if (st?.isDone) {
      const todo = statuses.find((s) => s.key === 'todo');
      if (todo) patch.mutate({ id: n.task.id, body: { statusId: todo.id } });
      return;
    }
    const openKids = n.hasChildren && (tasks.data ?? []).some((t) => t.parentId === n.task.id && !statuses.find((s) => s.id === t.statusId)?.isDone);
    complete.mutate({ id: n.task.id, completeSubtasks: openKids ? window.confirm('Also mark its open subtasks as done?') : false });
  };

  return (
    <Card className="px-4 pt-3 pb-3" label="Tasks">
      {tasks.isLoading ? (
        <div className="h-24 animate-pulse rounded-field bg-sunken" />
      ) : nodes.length === 0 ? (
        <div className="py-2">
          <EmptyState title="No tasks yet">Add the first one below. Paste a Huly link to file it with its key, or end the name with "1h 30m" for an estimate.</EmptyState>
        </div>
      ) : (
        <ul className="m-0 list-none p-0" aria-label="Task list">
          <AnimatePresence initial={false}>
            {nodes.map((n, i) => {
              const st = statuses.find((s) => s.id === n.task.statusId);
              const done = !!st?.isDone;
              const running = timer.data?.running?.taskId === n.task.id;
              const over = n.task.estimateMinutes !== null && n.task.time.total > n.task.estimateMinutes * MINUTE;
              return (
                <motion.li key={n.task.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <div className="group flex items-center gap-2 border-t border-divider py-2 text-sm first:border-t-0" style={{ paddingLeft: n.depth * 26 }}>
                    {n.hasChildren ? (
                      <button
                        type="button"
                        aria-label={collapsed.has(n.task.id) ? 'Expand subtasks' : 'Collapse subtasks'}
                        aria-expanded={!collapsed.has(n.task.id)}
                        onClick={() => setCollapsed((s) => (s.has(n.task.id) ? new Set([...s].filter((x) => x !== n.task.id)) : new Set([...s, n.task.id])))}
                        className="rounded p-0.5 text-text-3 hover:text-text"
                      >
                        <motion.span className="block" animate={{ rotate: collapsed.has(n.task.id) ? 0 : 90 }}>
                          <ChevronRight size={15} aria-hidden="true" />
                        </motion.span>
                      </button>
                    ) : (
                      <span className="w-[19px]">{n.depth > 0 && <CornerDownRight size={13} className="text-text-3" aria-hidden="true" />}</span>
                    )}
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={done}
                      aria-label={`Done: ${n.task.name}`}
                      onClick={() => toggleDone(n)}
                      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-colors ${done ? 'border-mint bg-mint text-on-fill' : 'border-line hover:border-accent'}`}
                    >
                      {done && (
                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
                          <Check size={13} strokeWidth={3} aria-hidden="true" />
                        </motion.span>
                      )}
                    </button>
                    <InlineName task={n.task} done={done} onSave={(name) => patch.mutate({ id: n.task.id, body: { name } })} />
                    {n.task.hulyKey &&
                      (n.task.hulyUrl ? (
                        <a href={n.task.hulyUrl} target="_blank" rel="noreferrer" className="hidden text-xs text-text-3 hover:text-accent-ink sm:inline">
                          {n.task.hulyKey}
                        </a>
                      ) : (
                        <span className="hidden text-xs text-text-3 sm:inline">{n.task.hulyKey}</span>
                      ))}
                    <label className="sr-only" htmlFor={`st-${n.task.id}`}>
                      Status
                    </label>
                    <select
                      id={`st-${n.task.id}`}
                      value={n.task.statusId}
                      onChange={(e) => patch.mutate({ id: n.task.id, body: { statusId: e.target.value } })}
                      className="cursor-pointer appearance-none rounded-full border-0 px-2.5 py-0.5 text-center text-xs font-semibold"
                      style={chipStyle(st?.key, st?.isDone, st?.isRejected)}
                    >
                      {statuses.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <EstimateCell task={n.task} onSave={(m) => patch.mutate({ id: n.task.id, body: { estimateMinutes: m } })} />
                    <span className={`num w-[86px] text-right text-[13px] ${over ? 'font-semibold text-danger' : 'text-text-2'}`} title={n.hasChildren ? `Own ${duration(n.task.time.own)}` : undefined}>
                      {duration(n.task.time.total)}
                    </span>
                    <span className="flex items-center gap-0.5 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                      <IconButton label={running ? 'Running' : `Start timer on ${n.task.name}`} onClick={() => start({ projectId: project.id, taskId: n.task.id })} disabled={running || done}>
                        <Play size={14} aria-hidden="true" />
                      </IconButton>
                      <IconButton label="Add subtask" onClick={() => setAddingUnder(n.task.id)}>
                        <Plus size={14} aria-hidden="true" />
                      </IconButton>
                      <IconButton label="Indent (make subtask)" onClick={() => indent(i)}>
                        <IndentIncrease size={14} aria-hidden="true" />
                      </IconButton>
                      <IconButton label="Outdent" onClick={() => outdent(n)} disabled={!n.task.parentId}>
                        <IndentDecrease size={14} aria-hidden="true" />
                      </IconButton>
                      <IconButton label="Archive task" onClick={() => patch.mutate({ id: n.task.id, body: { archived: true } })}>
                        <Archive size={14} aria-hidden="true" />
                      </IconButton>
                    </span>
                  </div>
                  {addingUnder === n.task.id && (
                    <div style={{ paddingLeft: (n.depth + 1) * 26 }} className="pb-2">
                      <AddTask projectId={project.id} parentId={n.task.id} autoFocus onDone={() => setAddingUnder(null)} />
                    </div>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
      <div className="border-t border-divider pt-3">
        <AddTask projectId={project.id} parentId={null} />
      </div>
      {(startError || patch.error || move.error) && <p className="mt-2 text-sm text-danger">{startError ?? patch.error?.message ?? move.error?.message}</p>}
    </Card>
  );
}

function chipStyle(key?: string, isDone?: boolean, isRejected?: boolean) {
  const map: Record<string, string> = { todo: 'todo', in_progress: 'progress', in_review: 'review', revision: 'revision', done: 'done', rejected: 'rejected', on_hold: 'hold', blocked: 'blocked' };
  const v = (key && map[key]) ?? (isDone ? 'done' : isRejected ? 'rejected' : 'todo');
  return { background: `var(--mt-chip-${v}-bg)`, color: `var(--mt-chip-${v}-fg)` };
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="rounded-[8px] p-1.5 text-text-2 hover:bg-surface-2 hover:text-text disabled:opacity-40">
      {children}
    </button>
  );
}

function InlineName({ task, done, onSave }: { task: TaskWithTime; done: boolean; onSave: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.name);
  if (editing)
    return (
      <input
        autoFocus
        value={value}
        aria-label="Task name"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (value.trim() && value.trim() !== task.name) onSave(value.trim());
          else setValue(task.name);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setValue(task.name);
            setEditing(false);
          }
        }}
        className="min-w-0 flex-1 rounded-[6px] border border-accent bg-surface px-1.5 py-0.5 text-sm"
      />
    );
  return (
    <button type="button" onClick={() => setEditing(true)} className={`min-w-0 flex-1 truncate text-left ${done ? 'text-text-3 line-through' : ''}`} title="Click to rename">
      {task.name}
    </button>
  );
}

function EstimateCell({ task, onSave }: { task: TaskWithTime; onSave: (m: number | null) => void }) {
  const [value, setValue] = useState(minutesText(task.estimateMinutes));
  const [bad, setBad] = useState(false);
  return (
    <input
      value={value}
      placeholder="est."
      aria-label={`Estimate for ${task.name}`}
      aria-invalid={bad}
      onChange={(e) => {
        setValue(e.target.value);
        setBad(parseMinutes(e.target.value) === undefined);
      }}
      onBlur={() => {
        const m = parseMinutes(value);
        if (m === undefined) return;
        if (m !== task.estimateMinutes) onSave(m);
        setValue(minutesText(m));
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={`num w-[62px] rounded-[6px] border bg-transparent px-1.5 py-0.5 text-right text-[13px] text-text-2 ${bad ? 'border-danger' : 'border-transparent hover:border-line focus:border-accent'}`}
    />
  );
}

/** Add a task: Enter saves and keeps the field open for the next one. Huly links and "1h 30m" are understood. */
function AddTask({ projectId, parentId, autoFocus, onDone }: { projectId: string; parentId: string | null; autoFocus?: boolean; onDone?: () => void }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const isHuly = /https?:\/\/\S+\/tracker\//.test(text);
  const createTask = useMutate<{ name: string }>('POST', () => '/api/tasks', (v) => ({ projectId, parentId, name: v.name }));
  const quick = useMutate<{ text: string }>('POST', () => '/api/quick-add', (v) => ({ text: v.text, projectId, parentId }));
  const submit = async () => {
    const t = text.trim();
    if (!t) return onDone?.();
    // Clear at once so you can type the next task while this one saves; put the text back if saving fails.
    setText('');
    ref.current?.focus();
    try {
      if (isHuly) await quick.mutateAsync({ text: t });
      else await createTask.mutateAsync({ name: t });
    } catch {
      setText((now) => now || t);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
    if (e.key === 'Escape') onDone?.();
  };
  const error = createTask.error ?? quick.error;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Plus size={16} className="shrink-0 text-text-3" aria-hidden="true" />
        <input
          ref={ref}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => !text && onDone?.()}
          aria-label={parentId ? 'New subtask' : 'New task'}
          placeholder={parentId ? 'Subtask name, Enter to add' : 'Add a task: name, "Blog cover 1h 30m", or paste a Huly link'}
          className="min-h-9 flex-1 rounded-field border border-transparent bg-transparent px-2 text-sm placeholder:text-text-3 hover:border-line focus:border-accent"
        />
        {isHuly && <Chip>Huly link</Chip>}
      </div>
      {error && <span className="pl-7 text-sm text-danger">{error.message}</span>}
    </div>
  );
}

// ───────────────────────── overview ─────────────────────────

function Overview({ project: p }: { project: Project }) {
  const catalog = useCatalog();
  const save = useMutate<Record<string, unknown>>('PATCH', () => `/api/projects/${p.id}`);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const v = (k: keyof Project) => draft[k as string] ?? (p[k] === null || p[k] === undefined ? '' : String(p[k]));
  const set = (k: string) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });
  const estimate = parseMinutes(draft.estimateMinutes ?? minutesText(p.estimateMinutes));
  const dirty = Object.keys(draft).length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (estimate === undefined) return;
    const body: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(draft)) {
      if (k === 'estimateMinutes') body.estimateMinutes = estimate;
      else if (k === 'name') body.name = val.trim();
      else if (k === 'priority') body.priority = Number(val);
      else body[k] = val.trim() === '' ? null : val.trim();
    }
    save.mutate(body, { onSuccess: () => setDraft({}) });
  };
  const opt = (list: { id: string; name: string }[] = []) => list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>);

  return (
    <Card className="p-6">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Name">
          <TextInput required value={v('name')} onChange={set('name')} />
        </Field>
        <Field label="Name in reports" hint='e.g. "(MP) Mingle". Empty uses the name.'>
          <TextInput value={v('reportName')} onChange={set('reportName')} />
        </Field>
        <Field label="Company">
          <Select value={v('companyId')} onChange={set('companyId')}>
            {opt(catalog.data?.companies.filter((c) => c.archivedAt === null))}
          </Select>
        </Field>
        <Field label="Work category">
          <Select value={v('categoryId')} onChange={set('categoryId')}>
            {opt(catalog.data?.categories.filter((c) => c.archivedAt === null))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={v('statusId')} onChange={set('statusId')}>
            {opt(catalog.data?.statuses)}
          </Select>
        </Field>
        <Field label="Project type">
          <Select value={v('typeId')} onChange={set('typeId')}>
            <option value="">None</option>
            {opt(catalog.data?.projectTypes)}
          </Select>
        </Field>
        <Field label="Report group" hint="Projects in one group merge into one line when their status matches.">
          <Select value={v('reportGroupId')} onChange={set('reportGroupId')}>
            <option value="">None</option>
            {(catalog.data?.reportGroups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estimate" hint={estimate === undefined ? 'Use 6h, 90m or 1:30' : undefined}>
          <TextInput value={draft.estimateMinutes ?? minutesText(p.estimateMinutes)} onChange={set('estimateMinutes')} aria-invalid={estimate === undefined} />
        </Field>
        <Field label="Start date">
          <TextInput type="date" value={v('startDate')} onChange={set('startDate')} />
        </Field>
        <Field label="Deadline">
          <TextInput type="date" value={v('deadline')} onChange={set('deadline')} />
        </Field>
        <Field label="Assigned by">
          <TextInput value={v('assignedBy')} onChange={set('assignedBy')} />
        </Field>
        <Field label="Client">
          <TextInput value={v('clientName')} onChange={set('clientName')} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Huly project link">
            <TextInput type="url" value={v('hulyUrl')} onChange={set('hulyUrl')} placeholder="https://huly…" />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Description">
            <TextArea value={v('description')} onChange={set('description')} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Notes">
            <TextArea value={v('notes')} onChange={set('notes')} />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-3 md:col-span-2">
          {save.error && <span className="text-sm text-danger">{save.error.message}</span>}
          {save.isSuccess && !dirty && <span className="text-sm text-text-2">Saved</span>}
          <Button onClick={() => setDraft({})} disabled={!dirty}>
            Discard
          </Button>
          <Button type="submit" variant="primary" disabled={!dirty || estimate === undefined || save.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ───────────────────────── time ─────────────────────────

function TimeTab({ project }: { project: Project }) {
  const entries = useProjectEntries(project.id);
  const tasks = useProjectTasks(project.id);
  const names = new Map((tasks.data ?? []).map((t) => [t.id, t.name]));
  const byDay = new Map<string, NonNullable<typeof entries.data>>();
  for (const e of entries.data ?? []) {
    const day = new Date(e.startedAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const list = byDay.get(day) ?? [];
    list.push(e);
    byDay.set(day, list);
  }
  return (
    <div className="flex flex-col gap-4">
      <Card className="grid grid-cols-2 gap-4 p-5 md:grid-cols-4">
        <div>
          <Label>Project-level</Label>
          <div className="num font-head text-xl font-bold">{duration(project.totals.direct)}</div>
        </div>
        <div>
          <Label>On tasks</Label>
          <div className="num font-head text-xl font-bold">{duration(project.totals.total - project.totals.direct)}</div>
        </div>
        <div>
          <Label>Revisions</Label>
          <div className="num font-head text-xl font-bold">{duration(project.totals.revision)}</div>
        </div>
        <div>
          <Label>Total</Label>
          <div className="num font-head text-xl font-bold">{duration(project.totals.total)}</div>
        </div>
      </Card>
      {(entries.data ?? []).length === 0 ? (
        <EmptyState title="No time tracked yet">Start the timer on this project or one of its tasks.</EmptyState>
      ) : (
        [...byDay.entries()].map(([day, list]) => (
          <Card key={day} className="px-5 py-3" label={day}>
            <div className="flex justify-between pb-1">
              <span className="font-head font-bold">{day}</span>
              <span className="num text-sm text-text-2">{duration(list.reduce((s, e) => s + ((e.endedAt ?? Date.now()) - e.startedAt), 0))}</span>
            </div>
            {list.map((e) => (
              <div key={e.id} className="flex items-center gap-3 border-t border-divider py-2 text-sm">
                <span className="num w-[110px] text-text-2">
                  {timeOfDay(e.startedAt)}–{e.endedAt ? timeOfDay(e.endedAt) : 'now'}
                </span>
                <span className="min-w-0 flex-1 truncate">{e.taskId ? names.get(e.taskId) ?? 'Task' : 'Project-level work'}</span>
                {e.kind !== 'work' && <Chip>{e.kind}</Chip>}
                <span className="num w-16 text-right">{duration((e.endedAt ?? Date.now()) - e.startedAt)}</span>
              </div>
            ))}
          </Card>
        ))
      )}
      <p className="m-0 text-xs text-text-3">Editing entries, manual entries and the calendar view arrive with the Time screen.</p>
    </div>
  );
}

// ───────────────────────── revisions ─────────────────────────

function Revisions({ project }: { project: Project }) {
  const revisions = useRevisions(project.id);
  const [title, setTitle] = useState('');
  const [by, setBy] = useState('');
  const create = useMutate<{ title: string; requestedBy: string | null }>('POST', () => `/api/projects/${project.id}/revisions`);
  const update = useMutate<{ id: string; status: string }>('PATCH', (v) => `/api/revisions/${v.id}`, (v) => ({ status: v.status }));
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate({ title: title.trim(), requestedBy: by.trim() || null }, { onSuccess: () => (setTitle(''), setBy('')) });
  };
  return (
    <Card className="flex flex-col gap-3 p-5">
      {(revisions.data ?? []).length === 0 ? (
        <EmptyState title="No revision rounds">Record a revision request here; time tracked in Revision mode counts toward its round.</EmptyState>
      ) : (
        (revisions.data ?? []).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-divider pb-3 text-sm last:border-b-0">
            <Chip>Round {r.number}</Chip>
            <span className="min-w-0 flex-1 font-semibold">{r.title}</span>
            {r.requestedBy && <span className="text-text-2">by {r.requestedBy}</span>}
            <span className="num text-text-2">{duration(r.timeMs)}</span>
            <Select value={r.status} onChange={(e) => update.mutate({ id: r.id, status: e.target.value })} className="!min-h-8 !w-36 text-[13px]" aria-label={`Status of round ${r.number}`}>
              <option value="requested">Requested</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </Select>
          </div>
        ))
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-3 border-t border-divider pt-3">
        <div className="min-w-[220px] flex-1">
          <Field label="New revision request">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bigger CTA on step 3" />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Requested by">
            <TextInput value={by} onChange={(e) => setBy(e.target.value)} placeholder="Client" />
          </Field>
        </div>
        <Button type="submit" variant="primary" disabled={!title.trim() || create.isPending}>
          Add round
        </Button>
      </form>
    </Card>
  );
}
