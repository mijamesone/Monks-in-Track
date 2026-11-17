import { createApp } from '../src/app.ts';
import { openDatabase, seedDefaults, type DB } from '../src/db/index.ts';
import { makeCtx, type Ctx } from '../src/lib/context.ts';

export const MIN = 60_000;
export const HR = 60 * MIN;

/** A local instant: at(17, 9, 4) = 17 Nov 2026 09:04 in the test time zone. */
export const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();

export interface Harness {
  db: DB;
  ctx: Ctx;
  clock: { t: number };
  set(t: number): void;
  advance(ms: number): void;
  get<T = any>(path: string): Promise<{ status: number; body: T }>;
  send<T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T; headers: Headers }>;
  /** A second app instance on the same database, as after a browser refresh or server restart. */
  restart(): void;
  catalog(): Promise<any>;
}

export function harness(start = at(17, 9, 0), db: DB = openDatabase(':memory:')): Harness {
  const clock = { t: start };
  const ctx = makeCtx(db, () => clock.t);
  seedDefaults(db, clock.t);
  let app = createApp(ctx);
  const base = { host: '127.0.0.1:4545' };
  const h: Harness = {
    db,
    ctx,
    clock,
    set: (t) => void (clock.t = t),
    advance: (ms) => void (clock.t += ms),
    async get(path) {
      const res = await app.request(path, { headers: base });
      return { status: res.status, body: (await res.json()) as any };
    },
    async send(method, path, body, headers = {}) {
      const res = await app.request(path, {
        method,
        headers: { ...base, 'content-type': 'application/json', 'x-monkstracker': '1', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as any, headers: res.headers };
    },
    restart() {
      app = createApp(ctx);
    },
    async catalog() {
      return (await h.get('/api/catalog')).body;
    },
  };
  return h;
}

/** Creates DM Blog, DevM Blog (grouped) and (MP) Mingle as in the real reports. */
export async function seedRealProjects(h: Harness) {
  const cat = await h.catalog();
  const company = (name: string) => cat.companies.find((c: any) => c.name === name).id;
  const category = (name: string) => cat.categories.find((c: any) => c.name === name).id;
  const status = (key: string) => cat.statuses.find((s: any) => s.key === key).id;
  const group = h.ctx.id();
  h.db.prepare(`INSERT INTO report_groups (id, label) VALUES (?, ?)`).run(group, 'DM & DevM Blog');
  const mk = async (body: any) => (await h.send('POST', '/api/projects', body)).body;
  const dm = await mk({ companyId: company('Designmonks'), name: 'DM Blog', reportGroupId: group, categoryId: category('Internal Work'), statusId: status('in_progress') });
  const devm = await mk({ companyId: company('Devmonks'), name: 'DevM Blog', reportGroupId: group, categoryId: category('Internal Work'), statusId: status('in_progress') });
  const mingle = await mk({ companyId: company('Designmonks'), name: 'Mingle', reportName: '(MP) Mingle', categoryId: category('Client Work'), statusId: status('in_progress') });
  await h.send('PUT', '/api/huly-codes/BLOG_', { projectId: dm.id });
  await h.send('PUT', '/api/huly-codes/DEV_B', { projectId: devm.id });
  await h.send('PUT', '/api/huly-codes/FREEL', { projectId: mingle.id });
  return { dm, devm, mingle, status, category, company, group };
}

export const HULY = 'https://huly.designmonks.co/workbench/designmonks/tracker/';
