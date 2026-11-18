/** Short messages at the edge of the screen: toast('Saved'). Shown by <Toaster /> in the app shell. */
export type ToastTone = 'success' | 'info' | 'error';

export function toast(text: string, tone: ToastTone = 'info') {
  window.dispatchEvent(new CustomEvent('mt:toast', { detail: { text, tone } }));
}

/** Server replies that complete a task carry a note such as "Finished 20m early" (acceptance criterion). */
export function announce(result: unknown) {
  const note = (result as { completionNote?: unknown } | null)?.completionNote;
  if (typeof note === 'string' && note) toast(note, 'success');
}
