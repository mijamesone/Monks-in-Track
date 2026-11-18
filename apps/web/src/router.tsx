import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppShell } from './components/AppShell.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Placeholder } from './pages/Placeholder.tsx';

const rootRoute = createRootRoute({ component: AppShell });

const page = (path: string, title: string, milestone: string, text: string) =>
  createRoute({ getParentRoute: () => rootRoute, path, component: () => <Placeholder title={title} milestone={milestone}>{text}</Placeholder> });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: Dashboard }),
  page('/plan', 'Plan', 'M5', 'Backlog, This Week and Today, with drag to plan your day.'),
  page('/projects', 'Projects', 'M2', 'Your projects by company, with tasks, subtasks, Huly links and completion.'),
  page('/time', 'Time', 'M3', 'Every time entry, editable, with calendar and timesheet views later.'),
  page('/calendar', 'Calendar', 'Phase 2', 'Deadlines, leave and, later, Google Calendar meetings.'),
  page('/notes', 'Notes', 'Phase 2', 'Quick notes attached to projects and tasks, convertible to tasks.'),
  page('/reports', 'Reports', 'M5', 'Daily, weekly and monthly hours by company, project and category.'),
  page('/settings', 'Settings', 'M2', 'Companies, statuses, report wording, workday rules, theme and backups.'),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
