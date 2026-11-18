import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppShell } from './components/AppShell.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Placeholder } from './pages/Placeholder.tsx';
import { ProjectDetail } from './pages/ProjectDetail.tsx';
import { Plan } from './pages/Plan.tsx';
import { Projects } from './pages/Projects.tsx';
import { Reports } from './pages/Reports.tsx';
import { Settings } from './pages/Settings.tsx';
import { Time } from './pages/Time.tsx';

const rootRoute = createRootRoute({ component: AppShell });

const page = (path: string, title: string, milestone: string, text: string) =>
  createRoute({ getParentRoute: () => rootRoute, path, component: () => <Placeholder title={title} milestone={milestone}>{text}</Placeholder> });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: Dashboard }),
  createRoute({ getParentRoute: () => rootRoute, path: '/plan', component: Plan }),
  createRoute({ getParentRoute: () => rootRoute, path: '/projects', component: Projects }),
  createRoute({ getParentRoute: () => rootRoute, path: '/projects/$projectId', component: ProjectDetail }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/time',
    component: Time,
    // Links from Reports: /time?week=<Monday ms>&projectId=<id>
    validateSearch: (s: Record<string, unknown>): { week?: number; projectId?: string } => ({
      week: Number.isFinite(Number(s.week)) && s.week !== undefined ? Number(s.week) : undefined,
      projectId: typeof s.projectId === 'string' && s.projectId ? s.projectId : undefined,
    }),
  }),
  page('/calendar', 'Calendar', 'Phase 2', 'Deadlines, leave and, later, Google Calendar meetings.'),
  page('/notes', 'Notes', 'Phase 2', 'Quick notes attached to projects and tasks, convertible to tasks.'),
  createRoute({ getParentRoute: () => rootRoute, path: '/reports', component: Reports }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: Settings }),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
