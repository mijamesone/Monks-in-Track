/**
 * Huly link parsing (spec section E, "Huly link parsing").
 *
 * https://huly.designmonks.co/workbench/designmonks/tracker/BLOG_-653
 *   → workspace "designmonks", project code "BLOG_", number 653, identifier "BLOG_-653".
 * The project code is everything before the LAST dash, because codes can themselves contain dashes.
 */

export interface HulyLink {
  url: string;
  origin: string;
  workspace: string;
  identifier: string;
  projectCode: string;
  number: number;
}

const CODE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

export function parseHulyUrl(input: string): HulyLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const wb = parts.indexOf('workbench');
  if (wb === -1 || parts.length < wb + 4 || parts[wb + 2] !== 'tracker') return null;
  const workspace = decodeURIComponent(parts[wb + 1]!);
  const identifier = decodeURIComponent(parts[wb + 3]!);
  const dash = identifier.lastIndexOf('-');
  if (dash <= 0) return null;
  const projectCode = identifier.slice(0, dash);
  const numText = identifier.slice(dash + 1);
  if (!CODE.test(projectCode) || !/^\d+$/.test(numText)) return null;
  return {
    url: `${url.origin}/workbench/${parts[wb + 1]}/tracker/${parts[wb + 3]}`,
    origin: url.origin,
    workspace,
    identifier,
    projectCode,
    number: Number(numText),
  };
}

/** Every Huly link found in pasted text (e.g. several links pasted at once), in order, without duplicates. */
export function extractHulyLinks(text: string): HulyLink[] {
  const found: HulyLink[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s<>()"']+/g)) {
    const link = parseHulyUrl(match[0].replace(/[.,;:]+$/, ''));
    if (link && !seen.has(link.identifier)) {
      seen.add(link.identifier);
      found.push(link);
    }
  }
  return found;
}

/** Builds a task URL from a stored identifier, using the workspace's base. */
export function hulyTaskUrl(origin: string, workspace: string, identifier: string): string {
  return `${origin.replace(/\/+$/, '')}/workbench/${encodeURIComponent(workspace)}/tracker/${encodeURIComponent(identifier)}`;
}
