import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const control =
  'mt-themed min-h-10 w-full rounded-field border border-line bg-surface px-3 text-sm text-text placeholder:text-text-3 focus:border-accent';

/** A labelled control. The hint sits outside the <label> so the control's accessible name is just the label. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-text-2">{label}</span>
        {children}
      </label>
      {hint && <span className="text-xs text-text-3">{hint}</span>}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" {...props} className={`${control} ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={`${control} py-2 ${props.className ?? ''}`} />;
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <span className="relative flex items-center">
      <select {...props} className={`${control} appearance-none pr-8 ${props.className ?? ''}`}>
        {children}
      </select>
      <svg className="pointer-events-none absolute right-3 text-text-2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </span>
  );
}

/** "1h 30m", "90", "1:30" or "45m" → minutes. Empty → null. Invalid → undefined. */
export function parseMinutes(text: string): number | null | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const hm = /^(\d{1,3}):([0-5]\d)$/.exec(t);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const m = /^(?:(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/.exec(t);
  if (m && (m[1] || m[2])) return Math.round(Number(m[1] ?? 0) * 60) + Number(m[2] ?? 0);
  return undefined;
}

export function minutesText(min: number | null): string {
  if (min === null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
