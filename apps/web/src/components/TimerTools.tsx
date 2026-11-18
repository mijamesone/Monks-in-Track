import { useState } from 'react';
import { timeOfDay } from '../lib/format.ts';
import { useMutate, useRevisions, useTimer } from '../lib/queries.ts';
import { Dialog } from './Dialog.tsx';
import { Field, TextInput, TimeInput, parseClock } from './fields.tsx';
import { Button, Chip } from './ui.tsx';

/** "Edit start": for when you started working before you pressed play. */
export function EditStartDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const timer = useTimer();
  const running = timer.data?.running;
  const [value, setValue] = useState('');
  const save = useMutate<{ startedAt: number }>('PATCH', () => '/api/timer/start-time');
  if (!running) return null;
  const current = timeOfDay(running.startedAt);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = parseClock(value || current);
    if (!v) return;
    const [h, m] = v.split(':').map(Number) as [number, number];
    const d = new Date(running.startedAt);
    let ts = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
    if (ts > Date.now()) ts -= 86_400_000; // a time "later" than now means yesterday evening
    save.mutate({ startedAt: ts }, { onSuccess: () => (setValue(''), onClose()) });
  };
  return (
    <Dialog open={open} onClose={onClose} title="When did you start?" width={420}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Start time" hint={`Currently ${current}. It cannot overlap your previous entry.`}>
          <TimeInput autoFocus value={value || current} onChange={setValue} />
        </Field>
        {save.error && <p className="m-0 text-sm text-danger">{save.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Revision mode: switch the running timer to a revision round of the same project, or back to normal work. */
export function RevisionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const timer = useTimer();
  const running = timer.data?.running ?? null;
  const projectId = running?.projectId ?? '';
  const revisions = useRevisions(projectId);
  const [title, setTitle] = useState('');
  const start = useMutate<{ kind: 'work' | 'revision'; revisionRoundId: string | null }>('POST', () => '/api/timer/start', (v) => ({
    projectId: running?.projectId ?? null,
    taskId: running?.taskId ?? null,
    kind: v.kind,
    revisionRoundId: v.revisionRoundId,
  }));
  const create = useMutate<{ title: string }>('POST', () => `/api/projects/${projectId}/revisions`, (v) => ({ title: v.title, taskId: running?.taskId ?? null }));
  if (!running?.projectId) return null;
  const open_ = (revisions.data ?? []).filter((r) => r.status !== 'done');
  const pick = (id: string) => start.mutate({ kind: 'revision', revisionRoundId: id }, { onSuccess: onClose });
  const addAndPick = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const r = (await create.mutateAsync({ title: title.trim() })) as { id: string };
    setTitle('');
    pick(r.id);
  };
  return (
    <Dialog open={open} onClose={onClose} title="Revision mode" width={500}>
      <p className="m-0 text-sm text-text-2">From now on, time counts as revision work for the round you choose. It still counts once toward the project total.</p>
      {running.kind === 'revision' && (
        <Button onClick={() => start.mutate({ kind: 'work', revisionRoundId: null }, { onSuccess: onClose })}>Back to normal work</Button>
      )}
      <div className="flex flex-col gap-2">
        {open_.length === 0 && <span className="text-sm text-text-3">No open revision rounds on this project.</span>}
        {open_.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => pick(r.id)}
            disabled={running.revisionRoundId === r.id}
            className="flex items-center gap-3 rounded-field border border-line px-3 py-2.5 text-left text-sm hover:border-accent disabled:border-accent disabled:bg-accent-soft"
          >
            <Chip>Round {r.number}</Chip>
            <span className="flex-1 font-semibold">{r.title}</span>
            {running.revisionRoundId === r.id && <span className="text-xs text-accent-ink">current</span>}
          </button>
        ))}
      </div>
      <form onSubmit={addAndPick} className="flex items-end gap-2 border-t border-divider pt-4">
        <div className="flex-1">
          <Field label="New revision round">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Client feedback, round 2" />
          </Field>
        </div>
        <Button type="submit" variant="primary" disabled={!title.trim()}>
          Start
        </Button>
      </form>
      {(start.error || create.error) && <p className="m-0 text-sm text-danger">{start.error?.message ?? create.error?.message}</p>}
    </Dialog>
  );
}
