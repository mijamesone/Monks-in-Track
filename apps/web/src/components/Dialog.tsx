import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A modal built on the native <dialog>: focus is trapped, Esc closes, and the page behind is inert.
 */
export function Dialog({ open, onClose, title, children, width = 560 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
      className="mt-themed m-auto w-[calc(100%-32px)] rounded-frame border border-line bg-surface p-0 text-text backdrop:bg-[var(--mt-overlay)]"
      style={{ maxWidth: width }}
    >
      {open && (
        <div className="flex flex-col gap-5 p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 className="m-0 font-head text-xl font-extrabold tracking-[-0.01em]">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="-m-1 rounded-field p-1 text-text-2 hover:bg-surface-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
