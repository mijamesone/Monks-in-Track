import { Link } from '@tanstack/react-router';
import { BarChart3, CalendarDays, Clock3, FolderKanban, LayoutDashboard, ListTodo, NotebookPen, Plus, Settings } from 'lucide-react';
import { openQuickAdd } from './QuickAdd.tsx';
import { useCompany } from '../lib/company.tsx';
import { useCatalog } from '../lib/queries.ts';
import { CompanyDot, companyColor } from './ui.tsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/plan', label: 'Plan', icon: ListTodo },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/time', label: 'Time', icon: Clock3 },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/notes', label: 'Notes', icon: NotebookPen },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

export function Sidebar() {
  const { data } = useCatalog();
  const { companyId, setCompanyId } = useCompany();
  const companies = (data?.companies ?? []).filter((c) => c.archivedAt === null);
  const selectedIndex = companies.findIndex((c) => c.id === companyId);
  return (
    <nav aria-label="Main" className="mt-themed flex w-[232px] shrink-0 flex-col gap-1 border-r border-line bg-surface px-3.5 py-5">
      <div className="px-2 pb-3 font-head text-[17px] font-extrabold tracking-[-0.01em]">
        Monks<span className="text-accent-ink">Tracker</span>
      </div>

      <label className="mb-3 flex flex-col gap-1 px-1">
        <span className="sr-only">Company</span>
        <span className="relative flex items-center">
          <span className="pointer-events-none absolute left-3">
            <CompanyDot color={selectedIndex >= 0 ? companyColor(companies[selectedIndex], selectedIndex) : 'var(--mt-text-3)'} />
          </span>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="min-h-10 w-full appearance-none rounded-field border border-line bg-surface-2 pr-8 pl-8 text-[13px] font-medium text-text"
          >
            <option value="all">All Companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <svg className="pointer-events-none absolute right-3" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </label>

      {NAV.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: to === '/' }}
          className="flex items-center gap-2.5 rounded-field px-3 py-2.5 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          activeProps={{ className: '!bg-nav-active !text-on-nav-active font-semibold' }}
        >
          <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
          {label}
        </Link>
      ))}

      <div className="mt-auto flex flex-col gap-2 border-t border-divider pt-3">
        <button type="button" onClick={openQuickAdd} className="flex min-h-10 items-center gap-2 rounded-field border border-line px-3 text-sm font-semibold text-text hover:bg-surface-2">
          <Plus size={16} aria-hidden="true" /> Quick add
          <kbd className="ml-auto rounded border border-line px-1.5 text-[11px] text-text-3">Q</kbd>
        </button>
      </div>
    </nav>
  );
}
