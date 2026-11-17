/**
 * HTTP API. JSON in, JSON out, every input validated.
 *
 * Local-only safety:
 *  - The server binds to 127.0.0.1 (see index.ts) and rejects any other Host header (DNS-rebinding guard).
 *  - Every state-changing request must send `X-MonksTracker: 1`. Browsers will not let another website add
 *    that header without a CORS preflight, which this server never approves, so other sites cannot write here.
 *  - With a PIN set, /api requires an unlocked session cookie.
 */
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { MINUTE, RuleError } from '@monkstracker/core';
import { ConflictError, NotFoundError, type Ctx } from './lib/context.ts';
import { Sessions, pinIsSet, setPin, verifyPin } from './lib/auth.ts';
import * as S from './services/structure.ts';
import * as T from './services/time.ts';
import * as W from './services/workday.ts';
import * as R from './services/reports.ts';
import { analytics } from './services/analytics.ts';
import { backupNow } from './services/backup.ts';

const id = z.string().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.number().int().nonnegative();
const bucket = z.enum(['backlog', 'this_week', 'today']);
const kind = z.enum(['work', 'revision', 'meeting', 'break', 'lunch']);
const nullableText = z.string().max(20_000).nullable();

const companyInput = z.object({ name: z.string().min(1).max(120), shortName: z.string().max(20).nullable().optional(), color: z.string().max(32).nullable().optional(), logoPath: z.string().max(500).nullable().optional() });
const projectFields = {
  reportName: z.string().max(200).nullable().optional(),
  reportGroupId: id.nullable().optional(),
  typeId: id.nullable().optional(),
  categoryId: id.optional(),
  statusId: id.optional(),
  priority: z.number().int().min(-10).max(10).optional(),
  startDate: date.nullable().optional(),
  deadline: date.nullable().optional(),
  estimateMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  assignedBy: z.string().max(200).nullable().optional(),
  clientName: z.string().max(200).nullable().optional(),
  hulyUrl: z.string().url().max(1000).nullable().optional(),
  description: nullableText.optional(),
  notes: nullableText.optional(),
};
const projectCreate = z.object({ companyId: id, name: z.string().min(1).max(200), ...projectFields });
const projectPatch = z.object({ companyId: id.optional(), name: z.string().min(1).max(200).optional(), archived: z.boolean().optional(), ...projectFields });
const taskFields = {
  description: nullableText.optional(),
  statusId: id.optional(),
  priority: z.number().int().min(-10).max(10).optional(),
  planBucket: bucket.optional(),
  plannedDate: date.nullable().optional(),
  dueDate: date.nullable().optional(),
  estimateMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  hulyUrl: z.string().url().max(1000).nullable().optional(),
  hulyKey: z.string().max(100).nullable().optional(),
};
const taskCreate = z.object({ projectId: id, parentId: id.nullable().optional(), name: z.string().min(1).max(500), ...taskFields });
const taskPatch = z.object({ name: z.string().min(1).max(500).optional(), sortOrder: z.number().optional(), archived: z.boolean().optional(), ...taskFields });
const target = z.object({ projectId: id.nullable(), taskId: id.nullable(), kind: z.enum(['work', 'revision', 'meeting']).default('work'), revisionRoundId: id.nullable().optional() });

export interface AppOptions {
  /** Hostnames accepted in the Host header. */
  allowedHosts?: string[];
}

export function createApp(ctx: Ctx, opts: AppOptions = {}) {
  const app = new Hono();
  const hosts = new Set(opts.allowedHosts ?? ['127.0.0.1', 'localhost']);
  const sessions = new Sessions(() => S.getSettings(ctx).autoLockMinutes * MINUTE);

  app.onError((err, c) => {
    if (err instanceof z.ZodError) return c.json({ error: { code: 'invalid_input', message: 'Some fields are invalid.', issues: err.issues } }, 400);
    if (err instanceof RuleError) return c.json({ error: { code: err.code, message: err.message } }, 422);
    if (err instanceof ConflictError) return c.json({ error: { code: err.code, message: err.message } }, 409);
    if (err instanceof NotFoundError) return c.json({ error: { code: 'not_found', message: err.message } }, 404);
    const sqliteCode = (err as { code?: string }).code;
    if (sqliteCode?.startsWith('SQLITE_CONSTRAINT')) return c.json({ error: { code: 'constraint', message: 'That change breaks a data rule.' } }, 409);
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'Something went wrong. Nothing was saved.' } }, 500);
  });

  app.use('*', async (c, next) => {
    const host = (c.req.header('host') ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!hosts.has(host)) return c.json({ error: { code: 'bad_host', message: 'Unknown host.' } }, 403);
    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD' && c.req.header('x-monkstracker') !== '1') {
      return c.json({ error: { code: 'missing_header', message: 'Requests that change data must send X-MonksTracker: 1.' } }, 403);
    }
    await next();
  });

  // ── health and lock ──
  app.get('/api/health', (c) => c.json({ ok: true, pinSet: pinIsSet(ctx) }));
  app.post('/api/auth/unlock', async (c) => {
    const { pin } = z.object({ pin: z.string().max(16) }).parse(await c.req.json());
    if (!verifyPin(ctx, pin)) return c.json({ error: { code: 'pin_wrong', message: 'Wrong PIN.' } }, 401);
    setCookie(c, 'mt_session', sessions.issue(ctx.now()), { httpOnly: true, sameSite: 'Strict', path: '/' });
    return c.json({ unlocked: true });
  });
  app.post('/api/auth/lock', (c) => {
    sessions.revoke(getCookie(c, 'mt_session'));
    deleteCookie(c, 'mt_session', { path: '/' });
    return c.json({ locked: true });
  });
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health' || c.req.path.startsWith('/api/auth/')) return next();
    if (pinIsSet(ctx) && !sessions.check(getCookie(c, 'mt_session'), ctx.now())) {
      return c.json({ error: { code: 'locked', message: 'MonksTracker is locked. Enter your PIN.' } }, 401);
    }
    await next();
  });
  app.post('/api/auth/pin', async (c) => {
    if (pinIsSet(ctx) && !sessions.check(getCookie(c, 'mt_session'), ctx.now())) return c.json({ error: { code: 'locked', message: 'Unlock first.' } }, 401);
    const body = z.object({ pin: z.string(), currentPin: z.string().optional() }).parse(await c.req.json());
    setPin(ctx, body.pin, body.currentPin);
    return c.json({ pinSet: true });
  });

  const body = async <T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> => schema.parse(await c.req.json().catch(() => ({})));

  // ── catalog and settings ──
  app.get('/api/catalog', (c) => c.json(S.getCatalog(ctx)));
  app.patch('/api/settings', async (c) => c.json(S.updateSettings(ctx, (await body(c, z.record(z.string(), z.unknown()))) as never)));

  // ── companies ──
  app.post('/api/companies', async (c) => c.json(S.createCompany(ctx, await body(c, companyInput)), 201));
  app.patch('/api/companies/:id', async (c) => c.json(S.updateCompany(ctx, c.req.param('id'), await body(c, companyInput.partial().extend({ archived: z.boolean().optional() })))));

  // ── projects ──
  app.get('/api/projects', (c) => c.json(S.listProjects(ctx, { companyId: c.req.query('companyId'), includeArchived: c.req.query('archived') === '1' })));
  app.post('/api/projects', async (c) => c.json(S.createProject(ctx, await body(c, projectCreate)), 201));
  app.get('/api/projects/:id', (c) => c.json(S.getProject(ctx, c.req.param('id'))));
  app.patch('/api/projects/:id', async (c) => c.json(S.updateProject(ctx, c.req.param('id'), await body(c, projectPatch))));
  app.get('/api/projects/:id/tasks', (c) => c.json(S.listProjectTasks(ctx, c.req.param('id'))));
  app.get('/api/projects/:id/revisions', (c) => c.json(S.listRevisions(ctx, c.req.param('id'))));
  app.post('/api/projects/:id/revisions', async (c) =>
    c.json(S.createRevision(ctx, c.req.param('id'), await body(c, z.object({ title: z.string().min(1).max(300), description: nullableText.optional(), taskId: id.nullable().optional(), requestedBy: z.string().max(200).nullable().optional(), requestedAt: instant.optional() }))), 201),
  );
  app.patch('/api/revisions/:id', async (c) =>
    c.json(S.updateRevision(ctx, c.req.param('id'), await body(c, z.object({ title: z.string().min(1).max(300).optional(), description: nullableText.optional(), status: z.enum(['requested', 'in_progress', 'done']).optional() })))),
  );
  app.put('/api/huly-codes/:code', async (c) => c.json(S.setHulyCode(ctx, c.req.param('code'), (await body(c, z.object({ projectId: id.nullable() }))).projectId)));

  // ── tasks ──
  app.get('/api/plan/:bucket', (c) => c.json(S.listBucket(ctx, bucket.parse(c.req.param('bucket')), c.req.query('companyId'))));
  app.post('/api/tasks', async (c) => c.json(S.createTask(ctx, await body(c, taskCreate)), 201));
  app.patch('/api/tasks/:id', async (c) => c.json(S.updateTask(ctx, c.req.param('id'), await body(c, taskPatch))));
  app.post('/api/tasks/:id/move', async (c) => c.json(S.moveTask(ctx, c.req.param('id'), await body(c, z.object({ projectId: id, parentId: id.nullable() })))));
  app.post('/api/tasks/:id/complete', async (c) => c.json(T.completeTask(ctx, c.req.param('id'), await body(c, z.object({ completeSubtasks: z.boolean().optional() })))));
  app.get('/api/tasks/:id/open-subtasks', (c) => c.json(S.openSubtaskIds(ctx, c.req.param('id'))));
  app.post('/api/quick-add', async (c) =>
    c.json(S.quickAdd(ctx, await body(c, z.object({ text: z.string().min(1).max(5000), projectId: id.optional(), planBucket: bucket.optional(), parentId: id.nullable().optional() })))),
  );

  // ── timer ──
  app.get('/api/timer', (c) => c.json({ running: T.runningTimer(ctx), break: T.runningBreak(ctx), review: T.timerReview(ctx), now: ctx.now() }));
  app.post('/api/timer/start', async (c) => {
    const b = await body(c, target.extend({ startWorkday: z.boolean().optional() }));
    const { startWorkday, ...t } = b;
    return c.json(T.startTimer(ctx, t, { startWorkday }), 201);
  });
  app.post('/api/timer/stop', (c) => c.json(T.stopTimer(ctx)));
  app.post('/api/timer/discard', (c) => c.json(T.discardTimer(ctx)));
  app.patch('/api/timer/start-time', async (c) => c.json(T.adjustRunningStart(ctx, (await body(c, z.object({ startedAt: instant }))).startedAt)));
  app.post('/api/timer/review', async (c) =>
    c.json(T.resolveTimerReview(ctx, await body(c, z.discriminatedUnion('action', [z.object({ action: z.literal('keep_all') }), z.object({ action: z.literal('discard_unattended') }), z.object({ action: z.literal('keep_until'), until: instant })])))),
  );
  app.post('/api/heartbeat', async (c) => c.json(T.heartbeat(ctx, (await body(c, z.object({ interaction: z.boolean().optional() }))).interaction ?? false)));
  app.post('/api/breaks/start', async (c) => c.json(T.startBreak(ctx, (await body(c, z.object({ kind: z.enum(['break', 'lunch']) }))).kind), 201));
  app.post('/api/breaks/end', async (c) => c.json(T.endBreak(ctx, await body(c, z.object({ resume: z.boolean().optional() })))));

  // ── entries ──
  app.get('/api/entries', (c) => {
    const q = z.object({ from: z.coerce.number().int(), to: z.coerce.number().int(), projectId: id.optional(), kind: kind.optional() }).parse(c.req.query());
    return c.json(T.listEntries(ctx, q));
  });
  app.post('/api/entries', async (c) =>
    c.json(T.addManualEntry(ctx, await body(c, z.object({ projectId: id.nullable(), taskId: id.nullable(), kind, revisionRoundId: id.nullable().optional(), startedAt: instant, endedAt: instant, note: z.string().max(2000).nullable().optional() }))), 201),
  );
  app.patch('/api/entries/:id', async (c) =>
    c.json(T.updateEntry(ctx, c.req.param('id'), await body(c, z.object({ projectId: id.nullable().optional(), taskId: id.nullable().optional(), kind: kind.optional(), revisionRoundId: id.nullable().optional(), startedAt: instant.optional(), endedAt: instant.nullable().optional(), note: z.string().max(2000).nullable().optional() })))),
  );
  app.delete('/api/entries/:id', (c) => c.json(T.deleteEntry(ctx, c.req.param('id'))));
  app.post('/api/entries/:id/split', async (c) => c.json(T.splitEntry(ctx, c.req.param('id'), (await body(c, z.object({ at: instant }))).at)));
  app.post('/api/entries/:id/restart', async (c) => c.json(T.restartEntry(ctx, c.req.param('id'), await body(c, z.object({ startWorkday: z.boolean().optional() }))), 201));

  // ── workday ──
  app.get('/api/workday', (c) => {
    const wd = W.currentWorkday(ctx);
    return c.json({ workday: wd ? W.workdaySummary(ctx, wd.id) : null, carryOver: wd ? [] : W.carryOverSuggestions(ctx) });
  });
  app.post('/api/workday/start', async (c) =>
    c.json(W.startWorkday(ctx, await body(c, z.object({ checkInAt: instant.optional(), dropTaskIds: z.array(id).optional(), focusTaskIds: z.array(id).optional(), blocker: z.string().max(500).nullable().optional() }))), 201),
  );
  app.patch('/api/workday/:id/check-in', async (c) => c.json(W.editCheckIn(ctx, c.req.param('id'), (await body(c, z.object({ checkInAt: instant }))).checkInAt)));
  app.post('/api/workday/end', async (c) =>
    c.json(
      W.endWorkday(
        ctx,
        await body(
          c,
          z.object({
            running: z.discriminatedUnion('action', [z.object({ action: z.literal('stop_now') }), z.object({ action: z.literal('stop_at'), at: instant }), z.object({ action: z.literal('keep') })]).optional(),
            blocker: z.string().max(500).nullable().optional(),
          }),
        ),
      ),
    ),
  );
  app.post('/api/workday/:id/reopen', (c) => c.json(W.reopenWorkday(ctx, c.req.param('id'))));

  // ── reports ──
  const reportType = z.enum(['morning', 'evening', 'lunch_start', 'lunch_end']);
  app.post('/api/reports/generate', async (c) => {
    const b = await body(c, z.object({ type: reportType, workdayId: id.optional(), blocker: z.string().max(500).optional() }));
    return c.json(R.buildReport(ctx, b.type, b));
  });
  app.post('/api/reports', async (c) =>
    c.json(R.recordReport(ctx, await body(c, z.object({ type: reportType, workdayId: id.nullable(), generatedText: z.string().max(50_000), finalText: z.string().max(50_000), via: z.enum(['copy', 'discord']) }))), 201),
  );
  app.get('/api/reports', (c) => c.json(R.reportHistory(ctx, Number(c.req.query('limit') ?? 50))));

  // ── analytics and backup ──
  app.get('/api/analytics', (c) => {
    const q = z.object({ from: z.coerce.number().int(), to: z.coerce.number().int(), companyId: id.optional(), projectId: id.optional(), categoryId: id.optional() }).parse(c.req.query());
    return c.json(analytics(ctx, q));
  });
  app.post('/api/backup', async (c) => c.json(await backupNow(ctx)));

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404));
  return app;
}
