import { Outlet, useRouterState } from '@tanstack/react-router';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useCatalog, useHeartbeat, useTimer } from '../lib/queries.ts';
import { useTimeOfDayTheme } from '../lib/theme.ts';
import { Sidebar } from './Sidebar.tsx';
import { LunchFlow } from './LunchFlow.tsx';
import { QuickAdd } from './QuickAdd.tsx';
import { useEffect } from 'react';
import { unlockAudioOnFirstInteraction } from '../lib/sound.ts';
import { TimerBar } from './TimerBar.tsx';

export function AppShell() {
  const catalog = useCatalog();
  const timer = useTimer();
  useTimeOfDayTheme(catalog.data?.settings.theme);
  useHeartbeat();
  useEffect(unlockAudioOnFirstInteraction, []);
  const path = useRouterState({ select: (s) => s.location.pathname.split('/').slice(0, 3).join('/') });
  const offline = catalog.isError && timer.isError;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-full bg-canvas">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TimerBar />
          {offline && (
            <div role="alert" className="mx-6 mt-4 rounded-card bg-danger-soft px-4 py-3 text-sm text-danger">
              Cannot reach the MonksTracker server on this computer. Your data is safe; start the server and this page reconnects by itself.
            </div>
          )}
          <AnimatePresence mode="wait" initial={false}>
            <motion.main
              key={path}
              className="min-w-0 flex-1 px-6 py-6 lg:px-8"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } }}
              exit={{ opacity: 0, y: -6, transition: { duration: 0.14 } }}
            >
              <Outlet />
            </motion.main>
          </AnimatePresence>
        </div>
      </div>
      <QuickAdd />
      <LunchFlow />
    </MotionConfig>
  );
}
