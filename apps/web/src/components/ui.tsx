import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Company, Status } from '../lib/types.ts';

type Variant = 'primary' | 'done' | 'ghost' | 'soft' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent border-accent hover:brightness-110',
  done: 'bg-mint text-on-fill border-mint hover:brightness-105',
  ghost: 'bg-transparent text-text border-line hover:bg-surface-2',
  soft: 'bg-accent-soft text-accent-ink border-transparent hover:brightness-95',
  danger: 'bg-transparent text-danger border-line hover:bg-danger-soft',
};

export function Button({
  variant = 'ghost',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'min-h-8 px-3 text-[13px]', md: 'min-h-10 px-4 text-sm', lg: 'min-h-12 px-6 text-[15px]' };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-field border font-semibold transition-[filter,background-color,transform] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${sizes[size]} ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = '', as: As = 'section', label }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'nav'; label?: string }) {
  return (
    <As aria-label={label} className={`mt-themed rounded-card border border-line bg-surface ${className}`}>
      {children}
    </As>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-semibold tracking-[0.08em] text-text-2 uppercase">{children}</span>;
}

export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-text-2 ${className}`}>
      {children}
    </span>
  );
}

const CHIP_VAR: Record<string, string> = {
  todo: 'todo',
  in_progress: 'progress',
  in_review: 'review',
  revision: 'revision',
  done: 'done',
  rejected: 'rejected',
  on_hold: 'hold',
  blocked: 'blocked',
};

/** Soft-tinted status chip (Direction A). Custom statuses fall back by their done/rejected flags. */
export function StatusChip({ status }: { status: Status | undefined }) {
  if (!status) return null;
  const v = CHIP_VAR[status.key] ?? (status.isDone ? 'done' : status.isRejected ? 'rejected' : 'todo');
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
      style={{ background: `var(--mt-chip-${v}-bg)`, color: `var(--mt-chip-${v}-fg)` }}
    >
      {status.name}
    </span>
  );
}

/** A company's colour: its own if set, else a token by position. */
export function companyColor(company: Company | undefined, index: number): string {
  return company?.color ?? `var(--mt-company-${(index % 2) + 1})`;
}

export function CompanyDot({ color, size = 9 }: { color: string; size?: number }) {
  return <span aria-hidden="true" className="inline-block shrink-0 rounded-[3px]" style={{ width: size, height: size, background: color }} />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-line px-5 py-6">
      <span className="font-head text-base font-bold">{title}</span>
      {children && <span className="text-sm text-text-2">{children}</span>}
      {action}
    </div>
  );
}
