import { cloneElement, isValidElement, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const control =
  'mt-themed min-h-10 w-full rounded-field border border-line bg-surface px-3 text-sm text-text placeholder:text-text-3 focus:border-accent';

/**
 * A labelled control. The label is linked to the control by id (not by wrapping it), so the
 * control's accessible name is exactly the label, and the hint is announced as its description.
 */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
    ? cloneElement(children, { id: children.props.id ?? id, 'aria-describedby': hint ? hintId : children.props['aria-describedby'] })
    : children;
  const controlId = isValidElement<{ id?: string }>(children) ? (children.props.id ?? id) : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={controlId} className="text-[13px] font-medium text-text-2">
        {label}
      </label>
      {control}
      {hint && (
        <span id={hintId} className="text-xs text-text-3">
          {hint}
        </span>
      )}
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
  // id and aria-describedby from <Field> land on the <select> via {...props}.
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

/** "9" → 09:00, "930" → 09:30, "0930" → 09:30, "9:5" → 09:05. Returns HH:MM (24-hour) or null. */
export function parseClock(text: string): string | null {
  const t = text.trim();
  let h: number;
  let m: number;
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(t);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else if (/^\d{1,4}$/.test(t)) {
    if (t.length <= 2) (h = Number(t), (m = 0));
    else if (t.length === 3) (h = Number(t.slice(0, 1)), (m = Number(t.slice(1))));
    else (h = Number(t.slice(0, 2)), (m = Number(t.slice(2))));
  } else return null;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * A 24-hour HH:MM field, the same on every computer (the browser's own time picker follows the
 * system's 12-hour setting and can hide AM/PM). Normalises what you type when you leave the field.
 */
export function TimeInput({ value, onChange, className = '', ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & { value: string; onChange: (v: string) => void }) {
  const invalid = value !== '' && parseClock(value) === null;
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="HH:MM"
      maxLength={5}
      autoComplete="off"
      {...rest}
      value={value}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => {
        const n = parseClock(value);
        if (n && n !== value) onChange(n);
        rest.onBlur?.(e);
      }}
      className={`num ${control} ${invalid ? '!border-danger' : ''} ${className}`}
    />
  );
}
