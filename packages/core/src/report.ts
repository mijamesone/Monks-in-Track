/**
 * Discord report generator (spec Appendix A1).
 *
 * Reproduces the real messages, e.g.
 *
 *   Ending my day (Worked 30 mins extra today, will adjust on another office day.)
 *
 *   Client Work
 *   (MP) Mingle 🔃 In progress
 *   https://huly.designmonks.co/workbench/designmonks/tracker/FREEL-548
 *
 *   Internal Work
 *   DM & DevM Blog ✅ Done
 *   https://…/BLOG_-653
 *   https://…/DEV_B-52
 *
 *   Blocker: None
 */

export interface ReportCategory {
  id: string;
  name: string;
  order: number;
}

export interface ReportStatus {
  id: string;
  emoji: string;
  /** Empty string = no status shown on the line (e.g. To Do). */
  reportText: string;
}

export interface ReportGroup {
  id: string;
  label: string;
}

export interface ReportProject {
  id: string;
  reportName: string;
  categoryId: string;
  statusId: string;
  groupId: string | null;
  /** Used when the project has no task links for this report. */
  hulyUrl: string | null;
  /** Task links to list under this project, already chosen by the caller (focus tasks or worked-on tasks). */
  taskLinks: string[];
}

export interface ReportInput {
  /** Projects in the order they should appear within their category. */
  projects: readonly ReportProject[];
  categories: readonly ReportCategory[];
  statuses: readonly ReportStatus[];
  groups: readonly ReportGroup[];
  blocker: string;
  /** Merge projects of the same report group that share a status. Default true. */
  mergeGroups?: boolean;
}

export interface MorningInput extends ReportInput {
  /** Decision R7: include the "Today's Focus" line. Default true. */
  includeFocusLine?: boolean;
}

export interface EveningInput extends ReportInput {
  /** The bracketed note, e.g. from overtimeNote(). */
  headerNote?: string | null;
  /** Optional Revisions section (decision J5: off by default). */
  revisions?: readonly { line: string; links: readonly string[] }[] | null;
}

interface Line {
  name: string;
  statusId: string;
  links: string[];
}

function statusSuffix(statusId: string, statuses: readonly ReportStatus[]): string {
  const s = statuses.find((x) => x.id === statusId);
  if (!s || !s.reportText) return '';
  return [s.emoji, s.reportText].filter(Boolean).join(' ');
}

function linesFor(projects: readonly ReportProject[], groups: readonly ReportGroup[], merge: boolean): Line[] {
  const out: Line[] = [];
  const mergedAt = new Map<string, number>();
  // Count members per (group, status) so a lone member keeps its own name.
  const bucketSize = new Map<string, number>();
  for (const p of projects) {
    if (!p.groupId) continue;
    const key = `${p.groupId}|${p.statusId}`;
    bucketSize.set(key, (bucketSize.get(key) ?? 0) + 1);
  }
  for (const p of projects) {
    const links = p.taskLinks.length ? [...p.taskLinks] : p.hulyUrl ? [p.hulyUrl] : [];
    const key = p.groupId ? `${p.groupId}|${p.statusId}` : null;
    if (merge && key && (bucketSize.get(key) ?? 0) > 1) {
      const at = mergedAt.get(key);
      if (at !== undefined) {
        const line = out[at]!;
        for (const l of links) if (!line.links.includes(l)) line.links.push(l);
        continue;
      }
      const label = groups.find((g) => g.id === p.groupId)?.label ?? p.reportName;
      mergedAt.set(key, out.length);
      out.push({ name: label, statusId: p.statusId, links });
      continue;
    }
    out.push({ name: p.reportName, statusId: p.statusId, links });
  }
  return out;
}

function body(input: ReportInput): string[] {
  const merge = input.mergeGroups ?? true;
  const lines: string[] = [];
  const categories = [...input.categories].sort((a, b) => a.order - b.order);
  for (const cat of categories) {
    const projects = input.projects.filter((p) => p.categoryId === cat.id);
    if (!projects.length) continue;
    lines.push(cat.name);
    for (const l of linesFor(projects, input.groups, merge)) {
      const suffix = statusSuffix(l.statusId, input.statuses);
      lines.push(suffix ? `${l.name} ${suffix}` : l.name);
      lines.push(...l.links);
    }
    lines.push('');
  }
  return lines;
}

function blockerLine(blocker: string): string {
  const b = blocker.trim();
  return `Blocker: ${b || 'None'}`;
}

export function generateMorningReport(input: MorningInput): string {
  const lines = ['Started my day', ''];
  if (input.includeFocusLine ?? true) lines.push("Today's Focus", '');
  lines.push(...body(input));
  lines.push(blockerLine(input.blocker));
  return lines.join('\n');
}

export function generateEveningReport(input: EveningInput): string {
  const note = input.headerNote?.trim();
  const lines = [note ? `Ending my day (${note})` : 'Ending my day', ''];
  lines.push(...body(input));
  if (input.revisions && input.revisions.length) {
    lines.push('Revisions');
    for (const r of input.revisions) lines.push(r.line, ...r.links);
    lines.push('');
  }
  lines.push(blockerLine(input.blocker));
  return lines.join('\n');
}

/** Short status messages for the lunch flow (decision J6). */
export const LUNCH_MESSAGES = {
  start: 'Taking lunch break',
  end: 'Back from lunch!',
} as const;
