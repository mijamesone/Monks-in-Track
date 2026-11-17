/**
 * Completion % (spec rule 13, decision J4):
 * finished leaf items ÷ all leaf items, where a leaf is a task with no (non-archived) subtasks.
 * Rejected items are left out of both numbers. Archived items are ignored entirely.
 */

export interface CompletionItem {
  id: string;
  parentId: string | null;
  done: boolean;
  rejected: boolean;
  archived?: boolean;
}

export interface Completion {
  done: number;
  total: number;
  /** 0–100, rounded; null when the project has no countable items. */
  percent: number | null;
}

export function completion(items: readonly CompletionItem[]): Completion {
  const live = items.filter((i) => !i.archived);
  const hasChildren = new Set(live.filter((i) => i.parentId !== null).map((i) => i.parentId!));
  const leaves = live.filter((i) => !hasChildren.has(i.id) && !i.rejected);
  const done = leaves.filter((i) => i.done).length;
  const total = leaves.length;
  return { done, total, percent: total === 0 ? null : Math.round((done / total) * 100) };
}
