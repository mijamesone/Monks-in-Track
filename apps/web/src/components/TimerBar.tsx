import { AnimatePresence, motion } from 'motion/react';
import { Check, ExternalLink, Pause, Play, Coffee } from 'lucide-react';
import { useStartTimer } from '../lib/actions.ts';
import { clock, duration, timeOfDay, MINUTE } from '../lib/format.ts';
import { useAction, useCatalog, useNow, useTimer, useWorkday } from '../lib/queries.ts';
import { Button, Chip, CompanyDot, companyColor } from './ui.tsx';

/** The bar pinned above every screen: workday state, the running timer and its controls. */
export function TimerBar() {
  const timer = useTimer();
  const workday = useWorkday();
  const catalog = useCatalog();
  const now = useNow(timer.data?.now);
  const stop = useAction<Record<string, never>, unknown>('/api/timer/stop');
  const endBreak = useAction<{ resume: boolean }, unknown>('/api/breaks/end');
  const complete = useAction<{ id: string }, unknown>((b) => `/api/tasks/${b.id}/complete`);
  const review = useAction<{ action: string }, unknown>('/api/timer/review');
  const { start } = useStartTimer();

  const t = timer.data;
  const running = t?.running ?? null;
  const ctx = t?.runningContext ?? null;
  const companies = catalog.data?.companies ?? [];
  const companyIndex = companies.findIndex((c) => c.id === ctx?.companyId);
  const wd = workday.data?.workday ?? null;

  const elapsed = running ? now - running.startedAt : 0;
  const estimateMs = ctx?.estimateMinutes ? ctx.estimateMinutes * MINUTE : null;
  const used = (ctx?.priorMs ?? 0) + elapsed;
  const left = estimateMs === null ? null : estimateMs - used;

  const workdayChip = !wd
    ? 'Workday not started'
    : wd.workday.checkOutAt
      ? `Ended at ${timeOfDay(wd.workday.checkOutAt)}`
      : `Working since ${timeOfDay(wd.workday.checkInAt)}`;

  return (
    <header className="mt-themed sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
      {t?.review && (
        <div role="alert" className="flex flex-wrap items-center gap-3 bg-amber px-6 py-2.5 text-sm text-on-fill">
          <span className="font-semibold">
            {t.review.reason === 'unattended_gap'
              ? `The timer kept running while you were away (${duration(t.review.unattendedMs)} since ${timeOfDay(t.review.lastSeenAt)}).`
              : `This timer has run ${duration(t.review.unattendedMs)} without you touching anything.`}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" className="!border-on-fill/30 !text-on-fill" onClick={() => review.mutate({ action: 'keep_all' })}>
              Keep it all
            </Button>
            <Button size="sm" variant="ghost" className="!border-on-fill/30 !text-on-fill" onClick={() => review.mutate({ action: 'discard_unattended' })}>
              Stop at {timeOfDay(t.review.lastSeenAt)}
            </Button>
          </span>
        </div>
      )}
      <div className="flex min-h-[60px] flex-wrap items-center gap-3 px-6 py-2.5">
        <Chip>{workdayChip}</Chip>
        <AnimatePresence mode="wait" initial={false}>
          {t?.break ? (
            <motion.div key="break" className="flex items-center gap-3" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              <Coffee size={18} aria-hidden="true" className="text-text-2" />
              <span className="text-sm font-semibold">{t.break.kind === 'lunch' ? 'On lunch' : 'On a break'}</span>
              <span className="num font-head text-[17px] font-extrabold">{clock(now - t.break.startedAt)}</span>
              <Button size="sm" variant="primary" onClick={() => endBreak.mutate({ resume: true })}>
                Back to work
              </Button>
            </motion.div>
          ) : running && ctx ? (
            <motion.div key={`run-${running.id}`} className="flex min-w-0 flex-wrap items-center gap-3" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              <span className="mt-live-dot" aria-hidden="true" />
              <CompanyDot color={companyColor(companies[companyIndex], Math.max(0, companyIndex))} />
              <span className="min-w-0 truncate text-sm font-semibold">
                {ctx.projectName}
                {ctx.taskName && <span className="text-text-2"> › {ctx.taskName}</span>}
                {running.kind === 'revision' && ctx.revision && <span className="text-accent-ink"> · Revision {ctx.revision.number}</span>}
              </span>
              <span className="num font-head text-[19px] font-extrabold tracking-[-0.02em]">{clock(elapsed)}</span>
              {left !== null && (
                <span className={`num text-[13px] ${left < 0 ? 'font-semibold text-danger' : 'text-text-2'}`}>
                  {left >= 0 ? `${clock(left)} left` : `${clock(-left)} over`}
                </span>
              )}
              <span className="flex gap-2">
                <Button size="sm" variant="primary" onClick={() => stop.mutate({})} aria-label="Pause timer">
                  <Pause size={15} aria-hidden="true" /> Pause
                </Button>
                {running.taskId && (
                  <Button size="sm" variant="done" onClick={() => complete.mutate({ id: running.taskId! })}>
                    <Check size={15} aria-hidden="true" /> Done
                  </Button>
                )}
                {ctx.hulyUrl && (
                  <a href={ctx.hulyUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1.5 rounded-field border border-line px-3 text-[13px] font-semibold text-text hover:bg-surface-2">
                    <ExternalLink size={14} aria-hidden="true" /> Huly
                  </a>
                )}
              </span>
            </motion.div>
          ) : (
            <motion.div key="idle" className="flex items-center gap-3" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              {t?.lastStopped && t.lastStoppedContext ? (
                <Button
                  size="sm"
                  variant="soft"
                  onClick={() =>
                    start({ projectId: t.lastStopped!.projectId, taskId: t.lastStopped!.taskId, kind: t.lastStopped!.kind as 'work', revisionRoundId: t.lastStopped!.revisionRoundId })
                  }
                >
                  <Play size={15} aria-hidden="true" /> Resume {t.lastStoppedContext.taskName ?? t.lastStoppedContext.projectName}
                </Button>
              ) : (
                <span className="text-sm text-text-2">No timer running. Start one from Today's focus.</span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
