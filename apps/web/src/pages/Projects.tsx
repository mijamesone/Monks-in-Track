import { Link, useNavigate } from '@tanstack/react-router';
import { ExternalLink, Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Dialog } from '../components/Dialog.tsx';
import { Field, Select, TextInput, parseMinutes } from '../components/fields.tsx';
import { Button, Card, Chip, CompanyDot, EmptyState, Label, StatusChip, companyColor } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useCompany } from '../lib/company.tsx';
import { duration, MINUTE } from '../lib/format.ts';
import { useCatalog, useMutate, type ProjectDetail } from '../lib/queries.ts';
import type { Status } from '../lib/types.ts';
import { useQuery } from '@tanstack/react-query';

export function Projects() {
  const { companyId } = useCompany();
  const catalog = useCatalog();
  const [view, setView] = useState<'list' | 'board'>('list');
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const projects = useQuery({
    queryKey: ['projects', 'page', companyId, archived],
    queryFn: () => api<ProjectDetail[]>(`/api/projects?${new URLSearchParams({ ...(companyId !== 'all' ? { companyId } : {}), ...(archived ? { archived: '1' } : {}) })}`),
  });

  const companies = (catalog.data?.companies ?? []).filter((c) => c.archivedAt === null);
  const statuses = catalog.data?.statuses ?? [];
  const q = search.trim().toLowerCase();
  const list = (projects.data ?? []).filter(
    (p) => (archived ? true : p.archivedAt === null) && (!q || `${p.name} ${p.reportName ?? ''} ${p.clientName ?? ''}`.toLowerCase().includes(q)),
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="m-0 font-head text-[28px] font-extrabold tracking-[-0.02em]">Projects</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="View" className="flex rounded-field border border-line p-0.5">
            {(['list', 'board'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`min-h-8 rounded-[8px] px-3 text-[13px] font-semibold capitalize ${view === v ? 'bg-accent-soft text-accent-ink' : 'text-text-2'}`}
              >
                {v}
              </button>
            ))}
          </div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" /> New project
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <TextInput type="search" placeholder="Search projects" value={search} onChange={(e) => setSearch(e.target.value)} className="!w-64" aria-label="Search projects" />
        <label className="flex items-center gap-2 text-sm text-text-2">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="h-4 w-4 accent-[var(--mt-accent)]" />
          Show archived
        </label>
      </div>

      {projects.isLoading ? (
        <div className="h-40 animate-pulse rounded-card bg-sunken" aria-label="Loading" />
      ) : list.length === 0 ? (
        <EmptyState
          title={q ? 'No projects match' : 'No projects yet'}
          action={
            !q && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                New project
              </Button>
            )
          }
        >
          {q ? 'Try another word.' : 'A project is ongoing work like "DM Blog". A single deliverable like "10 web agency in NY" is a task inside it.'}
        </EmptyState>
      ) : view === 'list' ? (
        <div className="flex flex-col gap-5">
          {companies
            .filter((c) => companyId === 'all' || c.id === companyId)
            .map((company, ci) => {
              const rows = list.filter((p) => p.companyId === company.id);
              if (!rows.length) return null;
              return (
                <Card key={company.id} className="overflow-hidden" label={company.name}>
                  <div className="flex items-center gap-2 border-b border-divider px-5 py-3">
                    <CompanyDot color={companyColor(company, ci)} />
                    <span className="font-head font-bold">{company.name}</span>
                    <Chip>{rows.length}</Chip>
                  </div>
                  <ul className="m-0 list-none p-0">
                    <AnimatePresence initial={false}>
                      {rows.map((p) => (
                        <motion.li key={p.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                          <ProjectRow project={p} status={statuses.find((s) => s.id === p.statusId)} category={catalog.data?.categories.find((c) => c.id === p.categoryId)?.name} />
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </Card>
              );
            })}
        </div>
      ) : (
        <Board projects={list} />
      )}

      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function ProjectRow({ project: p, status, category }: { project: ProjectDetail; status: Status | undefined; category?: string }) {
  const pct = p.completion.percent;
  const est = p.estimateMinutes;
  return (
    <div className={`grid grid-cols-[minmax(0,2.2fr)_auto_auto_minmax(0,1fr)_minmax(0,1.3fr)_auto] items-center gap-4 border-t border-divider px-5 py-3 text-sm first:border-t-0 ${p.archivedAt ? 'opacity-60' : ''}`}>
      <div className="min-w-0">
        <Link to="/projects/$projectId" params={{ projectId: p.id }} className="block truncate font-semibold text-text hover:text-accent-ink">
          {p.name}
        </Link>
        {p.reportName && p.reportName !== p.name && <div className="truncate text-xs text-text-3">Reports as {p.reportName}</div>}
      </div>
      {category ? <Chip>{category}</Chip> : <span />}
      <StatusChip status={status} />
      <div className="flex items-center gap-2" title="Completion">
        <div className="h-1.5 flex-1 rounded-full bg-bar">
          <div className="h-1.5 rounded-full bg-accent" style={{ width: `${pct ?? 0}%` }} />
        </div>
        <span className="num w-9 text-right text-xs text-text-2">{pct === null ? '–' : `${pct}%`}</span>
      </div>
      <span className="num text-[13px] text-text-2">
        {duration(p.totals.total)}
        {est ? <span className="text-text-3"> / {duration(est * MINUTE)}</span> : null}
      </span>
      {p.hulyUrl ? (
        <a href={p.hulyUrl} target="_blank" rel="noreferrer" aria-label={`Open ${p.name} in Huly`} className="rounded-field p-1.5 text-text-2 hover:bg-surface-2 hover:text-text">
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      ) : (
        <span className="w-7" />
      )}
    </div>
  );
}

function Board({ projects }: { projects: ProjectDetail[] }) {
  const catalog = useCatalog();
  const statuses = catalog.data?.statuses ?? [];
  const companies = catalog.data?.companies ?? [];
  const columns = statuses.filter((s) => projects.some((p) => p.statusId === s.id) || ['todo', 'in_progress', 'in_review', 'done'].includes(s.key));
  return (
    <div className="grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2">
      {columns.map((s) => {
        const items = projects.filter((p) => p.statusId === s.id);
        return (
          <section key={s.id} aria-label={s.name} className="mt-themed flex flex-col gap-3 rounded-card bg-sunken p-3">
            <div className="flex items-center justify-between px-1">
              <StatusChip status={s} />
              <span className="text-xs text-text-3">{items.length}</span>
            </div>
            {items.map((p) => {
              const ci = companies.findIndex((c) => c.id === p.companyId);
              return (
                <Link key={p.id} to="/projects/$projectId" params={{ projectId: p.id }} className="mt-themed flex flex-col gap-2 rounded-field border border-line bg-surface p-3 hover:border-accent">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <CompanyDot color={companyColor(companies[ci], Math.max(0, ci))} />
                    {p.name}
                  </span>
                  <span className="num text-xs text-text-2">
                    {p.completion.percent === null ? 'No tasks' : `${p.completion.percent}% done`} · {duration(p.totals.total)}
                  </span>
                </Link>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const catalog = useCatalog();
  const { companyId } = useCompany();
  const navigate = useNavigate();
  const companies = (catalog.data?.companies ?? []).filter((c) => c.archivedAt === null);
  const categories = (catalog.data?.categories ?? []).filter((c) => c.archivedAt === null);
  const [form, setForm] = useState({ name: '', companyId: '', categoryId: '', typeId: '', reportName: '', hulyUrl: '', estimate: '' });
  const create = useMutate<Record<string, unknown>>('POST', () => '/api/projects');
  const defaults = useMemo(
    () => ({
      companyId: companyId !== 'all' ? companyId : (companies[0]?.id ?? ''),
      categoryId: categories.find((c) => c.name === 'Internal Work')?.id ?? categories[0]?.id ?? '',
    }),
    [companyId, companies, categories],
  );
  const value = { ...form, companyId: form.companyId || defaults.companyId, categoryId: form.categoryId || defaults.categoryId };
  const estimate = parseMinutes(value.estimate);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.name.trim() || estimate === undefined) return;
    const created = (await create.mutateAsync({
      name: value.name.trim(),
      companyId: value.companyId,
      categoryId: value.categoryId,
      ...(value.typeId ? { typeId: value.typeId } : {}),
      ...(value.reportName.trim() ? { reportName: value.reportName.trim() } : {}),
      ...(value.hulyUrl.trim() ? { hulyUrl: value.hulyUrl.trim() } : {}),
      ...(estimate !== null ? { estimateMinutes: estimate } : {}),
    })) as { id: string };
    setForm({ name: '', companyId: '', categoryId: '', typeId: '', reportName: '', hulyUrl: '', estimate: '' });
    onClose();
    void navigate({ to: '/projects/$projectId', params: { projectId: created.id } });
  };

  return (
    <Dialog open={open} onClose={onClose} title="New project">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name">
          <TextInput autoFocus required value={value.name} onChange={set('name')} placeholder="DM Blog" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company">
            <Select value={value.companyId} onChange={set('companyId')}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Work category">
            <Select value={value.categoryId} onChange={set('categoryId')}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Label>Optional, can be added later</Label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name in reports" hint='e.g. "(MP) Mingle"'>
            <TextInput value={value.reportName} onChange={set('reportName')} />
          </Field>
          <Field label="Project type">
            <Select value={value.typeId} onChange={set('typeId')}>
              <option value="">None</option>
              {(catalog.data?.projectTypes ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Huly project link">
            <TextInput type="url" value={value.hulyUrl} onChange={set('hulyUrl')} placeholder="https://huly…" />
          </Field>
          <Field label="Estimate" hint={estimate === undefined ? 'Use 6h, 90m or 1:30' : 'e.g. 6h or 1h 30m'}>
            <TextInput value={value.estimate} onChange={set('estimate')} aria-invalid={estimate === undefined} />
          </Field>
        </div>
        {create.error && <p className="m-0 text-sm text-danger">{create.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!value.name.trim() || estimate === undefined || create.isPending}>
            Create project
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
