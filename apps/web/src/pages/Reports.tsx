import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Button, Card, Chip, EmptyState, Label } from '../components/ui.tsx';
import { Select } from '../components/fields.tsx';
import { Analytics } from '../components/Analytics.tsx';
import { timeOfDay } from '../lib/format.ts';
import { useReports } from '../lib/queries.ts';
import type { ReportType, SavedReport } from '../lib/types.ts';

const TYPE_LABEL: Record<ReportType, string> = {
  morning: 'Morning',
  evening: 'Evening',
  lunch_start: 'Lunch start',
  lunch_end: 'Back from lunch',
};

function dayLabel(ts: number) {
  return new Date(ts).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Reports: message history now; hours analytics arrive in M5. */
export function Reports() {
  const [type, setType] = useState<ReportType | ''>('');
  const reports = useReports({ type: type || undefined, limit: 200 });
  const groups = new Map<string, SavedReport[]>();
  for (const r of reports.data ?? []) {
    const key = dayLabel(r.createdAt);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="m-0 font-head text-[28px] font-extrabold tracking-[-0.02em]">Reports</h1>
      <Analytics />

      <section aria-labelledby="history-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="history-title" className="m-0 font-head text-xl font-extrabold">
              Message history
            </h2>
            <p className="m-0 text-sm text-text-2">Every message you copied, exactly as you copied it. Saved messages cannot be changed.</p>
          </div>
          <Select aria-label="Message type" value={type} onChange={(e) => setType(e.target.value as ReportType | '')} className="w-[190px]">
            <option value="">All messages</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        {reports.isLoading ? (
          <div className="h-40 animate-pulse rounded-card bg-sunken" aria-label="Loading" />
        ) : groups.size === 0 ? (
          <EmptyState title="No messages yet">Messages appear here once you copy them from Start Workday, End Workday or the lunch flow.</EmptyState>
        ) : (
          [...groups].map(([day, list]) => (
            <div key={day} className="flex flex-col gap-2">
              <Label>{day}</Label>
              {list.map((r) => (
                <HistoryItem key={r.id} report={r} />
              ))}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function HistoryItem({ report: r }: { report: SavedReport }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = r.finalText.split('\n');
  // Collapsed: the first few lines that have text, so a morning message shows more than its headers.
  const preview = lines.filter((l) => l.trim()).slice(0, 5);
  const long = preview.length < lines.length;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.finalText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* select the text by hand */
    }
  };
  return (
    <Card as="div" className="flex flex-col gap-3 p-4" label={`${TYPE_LABEL[r.type]} message, ${timeOfDay(r.createdAt)}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip>{TYPE_LABEL[r.type]}</Chip>
        <span className="text-sm text-text-2">
          {r.sentAt ? `Sent at ${timeOfDay(r.sentAt)}` : `Copied at ${timeOfDay(r.copiedAt ?? r.createdAt)}`}
        </span>
        {r.finalText !== r.generatedText && <Chip>Edited</Chip>}
        <Button size="sm" className="ml-auto" onClick={() => void copy()}>
          <Copy size={13} aria-hidden="true" /> {copied ? 'Copied' : 'Copy again'}
        </Button>
      </div>
      <pre className="m-0 overflow-x-auto rounded-field bg-surface-2 px-4 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-text">
        {open || !long ? r.finalText : `${preview.join('\n')}\n…`}
      </pre>
      {long && (
        <button type="button" className="self-start text-sm font-semibold text-accent-ink underline-offset-2 hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </Card>
  );
}
