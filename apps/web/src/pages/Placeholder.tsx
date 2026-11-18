import { EmptyState } from '../components/ui.tsx';

/** Screens that arrive in later milestones show what is coming instead of a blank page. */
export function Placeholder({ title, milestone, children }: { title: string; milestone: string; children: string }) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="m-0 font-head text-[28px] font-extrabold tracking-[-0.02em]">{title}</h1>
      <EmptyState title={`Arrives in ${milestone}`}>{children}</EmptyState>
    </div>
  );
}
