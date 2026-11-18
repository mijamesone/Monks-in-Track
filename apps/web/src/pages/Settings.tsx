import { useState } from 'react';
import { Field, Select, TextInput, TimeInput, parseClock } from '../components/fields.tsx';
import { Button, Card, CompanyDot, EmptyState, Label, StatusChip, companyColor } from '../components/ui.tsx';
import { useCatalog, useMutate, useProjects } from '../lib/queries.ts';
import { Backups, Security } from '../components/SettingsSystem.tsx';
import type { Company, Status } from '../lib/types.ts';

type Section = 'companies' | 'statuses' | 'groups' | 'huly' | 'theme' | 'backups' | 'security';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'companies', label: 'Companies' },
  { id: 'statuses', label: 'Statuses and report wording' },
  { id: 'groups', label: 'Report groups' },
  { id: 'huly', label: 'Huly codes' },
  { id: 'theme', label: 'Theme' },
  { id: 'backups', label: 'Backups' },
  { id: 'security', label: 'Security (PIN)' },
];

export function Settings() {
  const [section, setSection] = useState<Section>('companies');
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <h1 className="m-0 font-head text-[28px] font-extrabold tracking-[-0.02em]">Settings</h1>
      <div className="flex flex-col gap-5 md:flex-row">
        <nav aria-label="Settings sections" className="flex shrink-0 flex-row flex-wrap gap-1 md:w-56 md:flex-col">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              aria-current={section === s.id}
              className={`rounded-field px-3 py-2 text-left text-sm ${section === s.id ? 'bg-nav-active font-semibold text-on-nav-active' : 'text-text-2 hover:bg-surface-2'}`}
            >
              {s.label}
            </button>
          ))}
          <p className="mt-3 hidden px-3 text-xs text-text-3 md:block">Workday hours, lunch times, leave and sounds are not editable here yet.</p>
        </nav>
        <div className="min-w-0 flex-1">
          {section === 'companies' && <Companies />}
          {section === 'statuses' && <Statuses />}
          {section === 'groups' && <Groups />}
          {section === 'huly' && <HulyCodes />}
          {section === 'theme' && <Theme />}
          {section === 'backups' && <Backups />}
          {section === 'security' && <Security />}
        </div>
      </div>
    </div>
  );
}

function Companies() {
  const catalog = useCatalog();
  const [name, setName] = useState('');
  const create = useMutate<{ name: string }>('POST', () => '/api/companies');
  const companies = catalog.data?.companies ?? [];
  return (
    <Card className="flex flex-col gap-1 p-5">
      <Label>Companies</Label>
      {companies.map((c, i) => (
        <CompanyRow key={c.id} company={c} index={i} />
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate({ name: name.trim() }, { onSuccess: () => setName('') });
        }}
        className="mt-3 flex items-end gap-2 border-t border-divider pt-4"
      >
        <div className="flex-1">
          <Field label="Add a company">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" />
          </Field>
        </div>
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Add
        </Button>
      </form>
    </Card>
  );
}

function CompanyRow({ company: c, index }: { company: Company; index: number }) {
  const save = useMutate<Record<string, unknown>>('PATCH', () => `/api/companies/${c.id}`);
  const [name, setName] = useState(c.name);
  const [short, setShort] = useState(c.shortName ?? '');
  const color = c.color ?? '';
  return (
    <div className={`grid grid-cols-[auto_minmax(0,1fr)_110px_auto] items-center gap-3 border-t border-divider py-3 first-of-type:border-t-0 ${c.archivedAt ? 'opacity-60' : ''}`}>
      <label className="relative flex cursor-pointer items-center" title="Company colour">
        <CompanyDot color={companyColor(c, index)} size={22} />
        <input type="color" value={color || '#7d40ff'} onChange={(e) => save.mutate({ color: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`${c.name} colour`} />
      </label>
      <TextInput value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== c.name && save.mutate({ name: name.trim() })} aria-label="Company name" />
      <TextInput value={short} onChange={(e) => setShort(e.target.value)} onBlur={() => short !== (c.shortName ?? '') && save.mutate({ shortName: short.trim() || null })} aria-label="Short name" placeholder="Short" />
      <Button size="sm" variant={c.archivedAt ? 'ghost' : 'danger'} onClick={() => save.mutate({ archived: !c.archivedAt })}>
        {c.archivedAt ? 'Unarchive' : 'Archive'}
      </Button>
    </div>
  );
}

function Statuses() {
  const catalog = useCatalog();
  const [name, setName] = useState('');
  const create = useMutate<{ name: string }>('POST', () => '/api/statuses');
  const statuses = catalog.data?.statuses ?? [];
  return (
    <Card className="flex flex-col gap-1 p-5">
      <div className="flex flex-col gap-1 pb-2">
        <Label>Statuses and how they read in Discord</Label>
        <span className="text-sm text-text-2">A report line is: project, then emoji, then report text. Example: (MP) Mingle 🔃 In progress</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1.3fr)_70px_minmax(0,1.3fr)_128px_150px] gap-3 px-1 pb-1 text-xs font-semibold text-text-3">
        <span>Name</span>
        <span>Emoji</span>
        <span>Report text</span>
        <span>Counts as</span>
        <span />
      </div>
      {statuses.map((s) => (
        <StatusRow key={s.id} status={s} />
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate({ name: name.trim() }, { onSuccess: () => setName('') });
        }}
        className="mt-3 flex items-end gap-2 border-t border-divider pt-4"
      >
        <div className="flex-1">
          <Field label="Add a status">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Waiting on client" />
          </Field>
        </div>
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Add
        </Button>
      </form>
      {create.error && <p className="m-0 text-sm text-danger">{create.error.message}</p>}
    </Card>
  );
}

function StatusRow({ status: s }: { status: Status }) {
  const save = useMutate<Record<string, unknown>>('PATCH', () => `/api/statuses/${s.id}`);
  const remove = useMutate<Record<string, never>>('DELETE', () => `/api/statuses/${s.id}`);
  const [draft, setDraft] = useState({ name: s.name, emoji: s.emoji, reportText: s.reportText });
  const commit = (k: keyof typeof draft) => () => draft[k] !== s[k] && save.mutate({ [k]: draft[k] });
  const kind = s.isDone ? 'done' : s.isRejected ? 'rejected' : 'open';
  return (
    <div className="grid grid-cols-[minmax(0,1.3fr)_70px_minmax(0,1.3fr)_128px_150px] items-center gap-3 border-t border-divider py-2">
      <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onBlur={commit('name')} aria-label="Status name" />
      <TextInput value={draft.emoji} onChange={(e) => setDraft({ ...draft, emoji: e.target.value })} onBlur={commit('emoji')} aria-label={`Emoji for ${s.name}`} className="text-center" />
      <TextInput value={draft.reportText} onChange={(e) => setDraft({ ...draft, reportText: e.target.value })} onBlur={commit('reportText')} aria-label={`Report text for ${s.name}`} placeholder="(not shown)" />
      <Select
        value={kind}
        onChange={(e) => save.mutate({ isDone: e.target.value === 'done', isRejected: e.target.value === 'rejected' })}
        aria-label={`What ${s.name} counts as`}
        className="!w-32 text-[13px]"
      >
        <option value="open">Open</option>
        <option value="done">Done</option>
        <option value="rejected">Rejected</option>
      </Select>
      <span className="flex items-center gap-2">
        <StatusChip status={s} />
        <Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => window.confirm(`Delete status "${s.name}"?`) && remove.mutate({})}>
          ✕
        </Button>
      </span>
      {(save.error || remove.error) && <span className="col-span-5 text-sm text-danger">{save.error?.message ?? remove.error?.message}</span>}
    </div>
  );
}

function Groups() {
  const catalog = useCatalog();
  const projects = useProjects();
  const [label, setLabel] = useState('');
  const create = useMutate<{ label: string }>('POST', () => '/api/report-groups');
  const remove = useMutate<{ id: string }>('DELETE', (v) => `/api/report-groups/${v.id}`);
  const groups = catalog.data?.reportGroups ?? [];
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-1">
        <Label>Report groups</Label>
        <span className="text-sm text-text-2">Projects in one group merge into one report line when their status matches, like "DM &amp; DevM Blog". Assign projects on each project's Overview tab.</span>
      </div>
      {groups.length === 0 && <EmptyState title="No groups yet" />}
      {groups.map((g) => {
        const members = (projects.data ?? []).filter((p) => (p as { reportGroupId?: string | null }).reportGroupId === g.id);
        return (
          <div key={g.id} className="flex flex-wrap items-center gap-3 border-t border-divider pt-3">
            <span className="font-semibold">{g.label}</span>
            <span className="flex-1 text-sm text-text-2">{members.length ? members.map((m) => m.name).join(' + ') : 'No projects yet'}</span>
            <Button size="sm" variant="danger" onClick={() => remove.mutate({ id: g.id })}>
              Delete
            </Button>
          </div>
        );
      })}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim()) create.mutate({ label: label.trim() }, { onSuccess: () => setLabel('') });
        }}
        className="flex items-end gap-2 border-t border-divider pt-4"
      >
        <div className="flex-1">
          <Field label="New group label">
            <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="DM & DevM Blog" />
          </Field>
        </div>
        <Button type="submit" variant="primary" disabled={!label.trim()}>
          Add
        </Button>
      </form>
    </Card>
  );
}

function HulyCodes() {
  const catalog = useCatalog();
  const projects = useProjects();
  const [code, setCode] = useState('');
  const [projectId, setProjectId] = useState('');
  const save = useMutate<{ code: string; projectId: string | null }>('PUT', (v) => `/api/huly-codes/${encodeURIComponent(v.code)}`, (v) => ({ projectId: v.projectId }));
  const codes = catalog.data?.hulyCodes ?? [];
  const list = projects.data ?? [];
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-1">
        <Label>Huly codes</Label>
        <span className="text-sm text-text-2">A pasted link like …/tracker/BLOG_-653 is filed under the project mapped to BLOG_. New codes are also learned the first time you paste one.</span>
      </div>
      {codes.map((c) => (
        <div key={c.code} className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3 border-t border-divider pt-3">
          <span className="font-semibold">{c.code}</span>
          <Select value={c.projectId ?? ''} onChange={(e) => save.mutate({ code: c.code, projectId: e.target.value || null })} aria-label={`Project for ${c.code}`}>
            <option value="">Ask each time</option>
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) save.mutate({ code: code.trim(), projectId: projectId || null }, { onSuccess: () => (setCode(''), setProjectId('')) });
        }}
        className="grid grid-cols-[120px_minmax(0,1fr)_auto] items-end gap-3 border-t border-divider pt-4"
      >
        <Field label="Code">
          <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="BLOG_" />
        </Field>
        <Field label="Project">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Ask each time</option>
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="primary" disabled={!code.trim()}>
          Add
        </Button>
      </form>
    </Card>
  );
}

function Theme() {
  const catalog = useCatalog();
  const save = useMutate<Record<string, unknown>>('PATCH', () => '/api/settings');
  const theme = catalog.data?.settings.theme;
  if (!theme) return null;
  const set = (patch: Partial<typeof theme>) => save.mutate({ theme: { ...theme, ...patch } });
  return (
    <Card className="flex flex-col gap-4 p-5">
      <Label>Theme</Label>
      <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-2">
        {(
          [
            ['auto', 'Follow the time of day'],
            ['light', 'Always light'],
            ['dark', 'Always dark'],
          ] as const
        ).map(([mode, text]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={theme.mode === mode}
            onClick={() => set({ mode })}
            className={`min-h-10 rounded-field border px-4 text-sm font-semibold ${theme.mode === mode ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-text-2 hover:bg-surface-2'}`}
          >
            {text}
          </button>
        ))}
      </div>
      {theme.mode === 'auto' && (
        <div className="grid max-w-md grid-cols-2 gap-3">
          <Field label="Light from">
            <ThemeTime value={theme.lightFrom} onSave={(v) => set({ lightFrom: v })} />
          </Field>
          <Field label="Dark from">
            <ThemeTime value={theme.darkFrom} onSave={(v) => set({ darkFrom: v })} />
          </Field>
        </div>
      )}
    </Card>
  );
}

function ThemeTime({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <TimeInput
      value={v}
      onChange={setV}
      onBlur={() => {
        const n = parseClock(v);
        if (n && n !== value) onSave(n);
      }}
    />
  );
}
