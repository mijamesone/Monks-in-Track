import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ToastTone } from '../lib/toast.ts';

interface Item {
  id: number;
  text: string;
  tone: ToastTone;
}

/** Shows toasts from toast(); each stays 5 seconds. Bottom left, so it never covers the lunch reminder. */
export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const { text, tone } = (e as CustomEvent<{ text: string; tone: ToastTone }>).detail;
      const id = ++n;
      setItems((cur) => [...cur.slice(-2), { id, text, tone }]);
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== id)), 5000);
    };
    window.addEventListener('mt:toast', on);
    return () => window.removeEventListener('mt:toast', on);
  }, []);
  const Icon = { success: CheckCircle2, info: Info, error: XCircle };
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-6 left-6 z-40 flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {items.map((t) => {
          const I = Icon[t.tone];
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ type: 'spring', stiffness: 300, damping: 24 }}
              className="mt-themed pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-card border border-line bg-surface px-4 py-3 text-sm font-semibold text-text shadow-[0_12px_32px_rgba(10,10,10,0.12)]"
            >
              <I size={17} aria-hidden="true" className={t.tone === 'success' ? 'text-mint' : t.tone === 'error' ? 'text-danger' : 'text-accent'} />
              {t.text}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
