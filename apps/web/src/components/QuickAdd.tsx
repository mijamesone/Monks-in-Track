import { useEffect, useState } from 'react';
import { useCompany } from '../lib/company.tsx';
import { useCatalog, useMutate, useProjects } from '../lib/queries.ts';
import type { Bucket } from '../lib/types.ts';
import { Dialog } from './Dialog.tsx';
import { Field, Select, TextArea } from './fields.tsx';
import { Button } from './ui.tsx';

type Result = { status: 'created'; tasks: { id: string; name: string }[]; existing: { id: string; name: string }[] } | { status: 'needs_project'; unknownCodes: string[] };

/**
 * Quick add (press Q anywhere). Paste one or more Huly links and they file themselves by project code;
 * plain text needs a project. "Blog cover 1h 30m" sets the estimate.
 */
export function QuickAdd() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState('');
  const [bucket, setBucket] = useState<Bucket>('today');
  const [result, setResult] = useState<Result | null>(null);
  const { companyId } = useCompany();
  const projects = useProjects(companyId === 'all' ? undefined : companyId);
  const catalog = useCatalog();
  const add = useMutate<{ text: string; projectId?: string; planBucket: Bucket }>('POST', () => '/api/quick-add');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mt:quick-add', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mt:quick-add', onOpen);
    };
  }, []);

  const close = () => {
    setOpen(false);
    setResult(null);
    add.reset();
  };
  const needsProject = result?.status === 'needs_project';
  const hasLink = /https?:\/\/\S+\/tracker\//.test(text);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const r = (await add.mutateAsync({ text: text.trim(), planBucket: bucket, ...(projectId ? { projectId } : {}) })) as Result;
    setResult(r);
    if (r.status === 'created') {
      setText('');
      setProjectId('');
    }
  };

  const companies = catalog.data?.companies ?? [];
  return (
    <Dialog open={open} onClose={close} title="Quick add">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Task" hint="Paste Huly links (one or many), or type a name. End with 1h 30m to set an estimate.">
          <TextArea
            autoFocus
            rows={3}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }
            }}
            placeholder="https://huly.designmonks.co/workbench/designmonks/tracker/BLOG_-653"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={needsProject ? 'Which project? (remembered for this Huly code)' : hasLink ? 'Project (only for new Huly codes)' : 'Project'}>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-invalid={needsProject && !projectId}>
              <option value="">{hasLink ? 'Auto, from the link' : 'Choose a project'}</option>
              {(projects.data ?? [])
                .filter((p) => !('archivedAt' in p) || (p as { archivedAt: number | null }).archivedAt === null)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {companies.find((c) => c.id === p.companyId)?.shortName ?? ''}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Plan for">
            <Select value={bucket} onChange={(e) => setBucket(e.target.value as Bucket)}>
              <option value="today">Today</option>
              <option value="this_week">This week</option>
              <option value="backlog">Backlog</option>
            </Select>
          </Field>
        </div>
        {needsProject && (
          <p role="alert" className="m-0 rounded-field bg-accent-soft px-3 py-2 text-sm text-accent-strong">
            {result.unknownCodes.length ? `New Huly code ${result.unknownCodes.join(', ')}: choose its project once and it will be remembered.` : 'Choose a project for this task.'}
          </p>
        )}
        {result?.status === 'created' && (
          <p role="status" className="m-0 rounded-field bg-live px-3 py-2 text-sm text-on-live">
            Added {result.tasks.length} {result.tasks.length === 1 ? 'task' : 'tasks'}
            {result.existing.length ? `, ${result.existing.length} already existed` : ''}. Add another, or press Esc.
          </p>
        )}
        {add.error && <p className="m-0 text-sm text-danger">{add.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={close}>Close</Button>
          <Button type="submit" variant="primary" disabled={!text.trim() || add.isPending || (needsProject && !projectId)}>
            Add
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Opens quick add from a button anywhere. */
export const openQuickAdd = () => window.dispatchEvent(new Event('mt:quick-add'));
