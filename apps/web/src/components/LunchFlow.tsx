import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell } from 'lucide-react';
import { post } from '../lib/api.ts';
import { timeOfDay } from '../lib/format.ts';
import { useAction, useCatalog, useNow, useTimer, useWorkday } from '../lib/queries.ts';
import { alarm, askNotificationPermission, chime, notify } from '../lib/sound.ts';
import { Dialog } from './Dialog.tsx';
import { Button } from './ui.tsx';

const MESSAGES = { start: 'Taking lunch break', end: 'Back from lunch!' } as const;

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function todayAt(now: number, hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
}

/** Per-day "already handled" flags, kept on this computer so a refresh does not repeat a reminder. */
function useDayFlags(day: string) {
  const key = `mt.lunch.${day}`;
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, boolean>;
    } catch {
      return {};
    }
  };
  const [flags, setFlags] = useState(read);
  useEffect(() => setFlags(read()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string) => {
    const next = { ...flags, [k]: true };
    setFlags(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* not remembered in private mode */
    }
  };
  return [flags, set] as const;
}

/** Your lunch routine (spec flow 11): 13:20 heads-up, 13:30 prompt, messages, and the return alarm. */
export function LunchFlow() {
  const timer = useTimer();
  const catalog = useCatalog();
  const workday = useWorkday();
  const now = useNow(timer.data?.now);
  const s = catalog.data?.settings;
  const t = timer.data;
  const [flags, setFlag] = useDayFlags(dayKey(now));
  const [message, setMessage] = useState<null | 'start' | 'end'>(null);
  const [copied, setCopied] = useState(false);
  const [silencedFor, setSilencedFor] = useState<number | null>(null);
  const startLunch = useAction<{ kind: 'lunch' }, unknown>('/api/breaks/start');
  const endBreak = useAction<{ resume: boolean }, unknown>('/api/breaks/end');
  const extend = useAction<{ minutes: number }, unknown>('/api/breaks/extend');

  const wd = workday.data?.workday ?? null;
  const open = !!wd && !wd.workday.checkOutAt;
  const eligible = !!s && !!t && open && !t.lunchTaken && !t.break;
  const first = s ? todayAt(now, s.lunchFirstReminder) : Infinity;
  const second = s ? todayAt(now, s.lunchSecondReminder) : Infinity;
  const showHeadsUp = eligible && now >= first && now < second && !flags.headsUp;
  const showPrompt = eligible && now >= second && !flags.prompt;
  const brk = t?.break ?? null;
  const plannedEnd = t?.breakPlannedEnd ?? null;
  const alarmDue = !!brk && plannedEnd !== null && now >= plannedEnd - 60_000 && silencedFor !== plannedEnd;

  // Sounds and system notifications fire once per moment.
  const fired = useRef<Set<string>>(new Set());
  const once = (id: string, fn: () => void) => {
    if (fired.current.has(id)) return;
    fired.current.add(id);
    fn();
  };
  useEffect(() => {
    if (showHeadsUp) once(`heads-${dayKey(now)}`, () => (chime(), notify('Lunch in 10 minutes', `Lunch at ${s?.lunchSecondReminder}.`)));
    if (showPrompt) once(`prompt-${dayKey(now)}`, () => (chime(), notify('Time for lunch', 'Take your lunch break in MonksTracker.')));
  }, [showHeadsUp, showPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  // The return alarm repeats every 15 seconds until you choose.
  useEffect(() => {
    if (!alarmDue) return;
    alarm();
    notify(brk?.kind === 'lunch' ? 'Lunch ends in 1 minute' : 'Break ends in 1 minute', `Ends at ${plannedEnd ? timeOfDay(plannedEnd) : ''}.`);
    const id = setInterval(alarm, 15_000);
    return () => clearInterval(id);
  }, [alarmDue, plannedEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async (kind: 'start' | 'end') => {
    const text = MESSAGES[kind];
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* the text is visible to copy by hand */
    }
    setCopied(true);
    await post('/api/reports', { type: kind === 'start' ? 'lunch_start' : 'lunch_end', workdayId: t?.workdayId ?? null, generatedText: text, finalText: text, via: 'copy' }).catch(() => {});
  };

  const takeLunch = async () => {
    setFlag('prompt');
    await startLunch.mutateAsync({ kind: 'lunch' });
    setCopied(false);
    setMessage('start');
  };

  const off = async () => {
    const wasLunch = brk?.kind === 'lunch';
    setSilencedFor(plannedEnd);
    await endBreak.mutateAsync({ resume: true });
    if (wasLunch) {
      setCopied(false);
      setMessage('end');
    }
  };

  const options = s?.lunchExtendOptions ?? [5, 10, 15];

  return (
    <>
      <AnimatePresence>
        {showHeadsUp && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            className="mt-themed fixed right-6 bottom-6 z-30 flex w-[340px] flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-[0_12px_32px_rgba(10,10,10,0.12)]"
          >
            <div className="flex items-start gap-3">
              <span className="rounded-field bg-lime p-2 text-on-fill">
                <Bell size={18} aria-hidden="true" />
              </span>
              <div>
                <div className="font-head font-bold">Lunch in 10 minutes</div>
                <div className="text-sm text-text-2">Wrap up what you are on. Lunch at {s?.lunchSecondReminder}.</div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              {'Notification' in window && Notification.permission === 'default' && (
                <Button size="sm" onClick={() => void askNotificationPermission()}>
                  Also notify in Windows
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={() => setFlag('headsUp')}>
                OK
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={showPrompt && !alarmDue && !message} onClose={() => setFlag('prompt')} title="Time for lunch" width={460}>
        <p className="m-0 text-sm text-text-2">
          {t?.runningContext ? `Taking lunch pauses ${t.runningContext.taskName ?? t.runningContext.projectName}. You can resume it when you are back.` : 'Your lunch time will be recorded as a break.'}
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setFlag('prompt')}>Cancel</Button>
          <Button variant="primary" onClick={() => void takeLunch()} disabled={startLunch.isPending}>
            Take lunch break
          </Button>
        </div>
        {startLunch.error && <p className="m-0 text-sm text-danger">{startLunch.error.message}</p>}
      </Dialog>

      <Dialog open={alarmDue} onClose={() => setSilencedFor(plannedEnd)} title={brk?.kind === 'lunch' ? 'Lunch ends in 1 minute' : 'Break ends in 1 minute'} width={500}>
        <p className="m-0 text-sm text-text-2">
          Ends at {plannedEnd ? timeOfDay(plannedEnd) : ''}. The alarm repeats until you choose. Extending moves the end and sets a new alarm one minute before it.
        </p>
        <div className="grid grid-cols-4 gap-2">
          <Button variant="primary" onClick={() => void off()} disabled={endBreak.isPending}>
            Off
          </Button>
          {options.map((m) => (
            <Button key={m} onClick={() => extend.mutate({ minutes: m })} disabled={extend.isPending}>
              +{m} min
            </Button>
          ))}
        </div>
        {(extend.error || endBreak.error) && <p className="m-0 text-sm text-danger">{extend.error?.message ?? endBreak.error?.message}</p>}
      </Dialog>

      <Dialog open={message !== null && !alarmDue} onClose={() => setMessage(null)} title={message === 'start' ? 'Enjoy your lunch' : 'Welcome back'} width={460}>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-text-2">Message for the office thread</span>
          <div className="rounded-field border border-line bg-surface-2 px-4 py-3 font-mono text-sm">{message ? MESSAGES[message] : ''}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled title="Arrives in Phase 3">
            Send to Discord
          </Button>
          <Button variant="primary" onClick={() => message && void copy(message)}>
            {copied ? 'Copied · saved to history' : 'Copy message'}
          </Button>
          <Button onClick={() => setMessage(null)}>Close</Button>
        </div>
      </Dialog>
    </>
  );
}
