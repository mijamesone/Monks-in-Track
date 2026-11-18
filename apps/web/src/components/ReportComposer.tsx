import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { patch, post } from '../lib/api.ts';
import { timeOfDay } from '../lib/format.ts';
import { useCatalog, useProjects } from '../lib/queries.ts';
import type { GeneratedReport, SavedReport } from '../lib/types.ts';
import { Select } from './fields.tsx';
import { Button, Chip } from './ui.tsx';

export interface ComposerParams {
  type: 'morning' | 'evening';
  workdayId: string;
  blocker?: string;
  focusTaskIds?: string[];
  /** Evening: planned check-out time for the overtime note. */
  at?: number;
}

/**
 * The morning or evening message (spec flow 9): generated from your data in your Discord format,
 * fully editable, and saved to history when you copy it.
 */
export function ReportComposer({ params, onCopied }: { params: ComposerParams; onCopied?: (r: SavedReport) => void }) {
  const qc = useQueryClient();
  const catalog = useCatalog();
  const projects = useProjects();
  const [merge, setMerge] = useState<boolean | undefined>(undefined);
  const [includeNote, setIncludeNote] = useState(true);
  const [edited, setEdited] = useState<string | null>(null);
  const [copied, setCopied] = useState<SavedReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const body = { ...params, blocker: params.blocker?.trim() || undefined, mergeGroups: merge, includeNote: params.type === 'evening' ? includeNote : undefined };
  const gen = useQuery({
    queryKey: ['report-preview', body] as const,
    queryFn: () => post<GeneratedReport>('/api/reports/generate', body),
    placeholderData: keepPreviousData,
  });
  const generated = gen.data?.text ?? '';
  const text = edited ?? generated;
  // A new copy is needed whenever the text changes after copying.
  useEffect(() => setCopied(null), [text]);

  const statuses = catalog.data?.statuses ?? [];
  const byId = new Map((projects.data ?? []).map((p) => [p.id, p]));
  const inMessage = (gen.data?.projectIds ?? []).map((id) => byId.get(id)).filter((p) => !!p);
  const hasGroups = (catalog.data?.reportGroups.length ?? 0) > 0;
  const mergeOn = merge ?? ((catalog.data?.settings.report as { mergeGroups?: boolean } | undefined)?.mergeGroups ?? true);

  const setStatus = async (projectId: string, statusId: string) => {
    setError(null);
    try {
      await patch(`/api/projects/${projectId}`, { statusId });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['report-preview'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the status.');
    }
  };

  const copy = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* the text stays selectable to copy by hand */
    }
    try {
      const saved = await post<SavedReport>('/api/reports', { type: params.type, workdayId: params.workdayId, generatedText: generated, finalText: text, via: 'copy' });
      setCopied(saved);
      void qc.invalidateQueries({ queryKey: ['reports'] });
      onCopied?.(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the message.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {inMessage.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-text-2">Project statuses in this message</span>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {inMessage.map((p) => (
              <li key={p.id} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-semibold">{p.reportName || p.name}</span>
                <Select aria-label={`Status of ${p.reportName || p.name}`} value={p.statusId} onChange={(e) => void setStatus(p.id, e.target.value)} className="w-[190px]">
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {[s.emoji, s.name].filter(Boolean).join(' ')}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {hasGroups && (
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={mergeOn} onChange={(e) => setMerge(e.target.checked)} className="size-4 accent-[var(--mt-accent)]" />
            Merge grouped projects (e.g. DM &amp; DevM Blog)
          </label>
        )}
        {params.type === 'evening' && (
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={includeNote} onChange={(e) => setIncludeNote(e.target.checked)} className="size-4 accent-[var(--mt-accent)]" />
            Overtime note in the first line
          </label>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="report-text" className="text-[13px] font-medium text-text-2">
            {params.type === 'morning' ? 'Morning message' : 'Evening message'}
          </label>
          {edited !== null && (
            <span className="flex items-center gap-2">
              <Chip>Edited</Chip>
              <Button size="sm" onClick={() => setEdited(null)}>
                <RotateCcw size={13} aria-hidden="true" /> Back to generated
              </Button>
            </span>
          )}
        </div>
        <textarea
          id="report-text"
          value={text}
          onChange={(e) => setEdited(e.target.value)}
          rows={Math.min(18, Math.max(8, text.split('\n').length + 1))}
          spellCheck={false}
          readOnly={gen.isLoading}
          placeholder={gen.isLoading ? 'Writing your message…' : undefined}
          aria-busy={gen.isFetching}
          className="w-full resize-y rounded-field border border-line bg-surface-2 px-4 py-3 font-mono text-[13px] leading-relaxed text-text outline-none focus:border-accent"
        />
        {edited !== null && <span className="text-xs text-text-3">Your edits are kept. Changes you make above no longer update the text until you go back to generated.</span>}
      </div>

      {(error || gen.error) && <p className="m-0 text-sm text-danger">{error ?? gen.error?.message}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {copied && <span className="mr-auto text-sm text-text-2">Copied at {timeOfDay(copied.createdAt)} · saved to history</span>}
        <Button disabled title="Arrives in Phase 3">
          Send to Discord
        </Button>
        <Button variant="primary" onClick={() => void copy()} disabled={!text.trim() || gen.isLoading}>
          {copied ? 'Copy again' : 'Copy message'}
        </Button>
      </div>
    </div>
  );
}
