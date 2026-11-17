/**
 * Fills a database with a realistic sample week (your real project names and Huly keys, illustrative hours)
 * so screens can be built and demoed against real-looking data.
 *
 *   MONKSTRACKER_DATA=./sample-data pnpm --filter @monkstracker/server seed:sample
 *
 * Refuses to touch a database that already has projects, unless --force is passed.
 * Everything goes through the normal services, so the sample obeys every rule real data does.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, seedDefaults } from '../db/index.ts';
import type { Ctx } from '../lib/context.ts';
import { makeCtx } from '../lib/context.ts';
import * as S from '../services/structure.ts';
import * as T from '../services/time.ts';
import * as W from '../services/workday.ts';
import * as R from '../services/reports.ts';
import * as C from '../services/catalog.ts';
import { defaultDataDir } from '../lib/paths.ts';

const HULY = 'https://huly.designmonks.co/workbench/designmonks/tracker/';

export function seedSample(ctx: Ctx, clock: { t: number }, today: Date): { projects: number; tasks: number; workdays: number } {
  const at = (day: Date, h: number, m: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
  const cat = S.getCatalog(ctx);
  const company = (n: string) => cat.companies.find((c) => c.name === n)!.id;
  const category = (n: string) => cat.categories.find((c) => c.name === n)!.id;
  const type = (n: string) => cat.projectTypes.find((t) => t.name === n)!.id;
  const status = (k: string) => cat.statuses.find((s) => s.key === k)!.id;

  ctx.db.prepare(`UPDATE companies SET color = ? WHERE name = 'Designmonks'`).run('#7D40FF');
  ctx.db.prepare(`UPDATE companies SET color = ? WHERE name = 'Devmonks'`).run('#1FB268');

  // Projects: start the clock a week back so everything is created before it is used.
  const start = new Date(today);
  start.setDate(start.getDate() - 8);
  clock.t = at(start, 9, 0);
  const dm = S.createProject(ctx, { companyId: company('Designmonks'), name: 'DM Blog', categoryId: category('Internal Work'), typeId: type('Blog Post Design'), statusId: status('in_progress'), hulyUrl: null });
  const devm = S.createProject(ctx, { companyId: company('Devmonks'), name: 'DevM Blog', categoryId: category('Internal Work'), typeId: type('Blog Post Design'), statusId: status('in_progress') });
  const mingle = S.createProject(ctx, { companyId: company('Designmonks'), name: 'Mingle', reportName: '(MP) Mingle', clientName: 'Mingle', assignedBy: 'Marketplace', categoryId: category('Client Work'), typeId: type('UI/UX Design'), statusId: status('in_progress'), estimateMinutes: 30 * 60 });
  const dribbble = S.createProject(ctx, { companyId: company('Designmonks'), name: 'Dribbble Service Page Thumbnail', categoryId: category('Internal Work'), typeId: type('Social Media Design'), statusId: status('todo'), estimateMinutes: 45 });
  const appStore = S.createProject(ctx, { companyId: company('Devmonks'), name: 'App Store Screenshots', categoryId: category('Client Work'), typeId: type('App Store Screenshot Design'), statusId: status('in_review'), estimateMinutes: 6 * 60 });
  C.createReportGroup(ctx, { label: 'DM & DevM Blog', projectIds: [dm.id, devm.id] });
  S.setHulyCode(ctx, 'BLOG_', dm.id);
  S.setHulyCode(ctx, 'DEV_B', devm.id);
  S.setHulyCode(ctx, 'FREEL', mingle.id);

  const fromHuly = (key: string, title: string, bucket: 'backlog' | 'this_week' | 'today' = 'backlog') => {
    const r = S.quickAdd(ctx, { text: `${HULY}${key} ${title}`, planBucket: bucket });
    if (r.status !== 'created') throw new Error(`Could not file ${key}`);
    return (r.tasks[0] ?? r.existing[0])!;
  };
  const agency = fromHuly('BLOG_-653', '10 web agency in NY 1hr 30min');
  const cover = S.createTask(ctx, { projectId: dm.id, parentId: agency.id, name: 'Blog cover 30min' });
  const inner = S.createTask(ctx, { projectId: dm.id, parentId: agency.id, name: 'Inner visuals 45min' });
  S.createTask(ctx, { projectId: dm.id, parentId: agency.id, name: 'Responsive versions 15min' });
  const visuals = fromHuly('BLOG_-671', 'Blog visuals 2hr');
  const caseStudy = fromHuly('BLOG_-672', 'Case study visuals 3hr');
  const devTasks = ['DEV_B-48 AI tools list cover 1hr', 'DEV_B-52 Blog cover 1hr', 'DEV_B-53 Inner visuals 1hr', 'DEV_B-54 Inner visuals 1hr 15min', 'DEV_B-55 Blog cover 1hr'].map((line) => {
    const [key, ...rest] = line.split(' ');
    return fromHuly(key!, rest.join(' '));
  });
  const onboarding = fromHuly('FREEL-548', 'Onboarding screens v2 3hr');
  const thumb = S.createTask(ctx, { projectId: dribbble.id, name: 'Service page thumbnail 45min' });
  const screens = S.createTask(ctx, { projectId: appStore.id, name: 'Screenshot set, 6 sizes 4hr' });
  C.setTags(ctx, { kind: 'task', id: agency.id }, ['agency-list', 'NY']);
  C.setTags(ctx, { kind: 'project', id: mingle.id }, ['marketplace']);
  const round = S.createRevision(ctx, mingle.id, { title: 'Onboarding feedback, round 1', taskId: onboarding.id, requestedBy: 'Client' });

  // Five working days before today.
  const days: Date[] = [];
  for (let back = 7; back >= 1 && days.length < 5; back--) {
    const d = new Date(today);
    d.setDate(d.getDate() - back);
    if (d.getDay() !== 0 && d.getDay() !== 6) days.push(d);
  }
  const work = (projectId: string, taskId: string | null, kind: 'work' | 'revision' = 'work', revisionRoundId: string | null = null) =>
    T.startTimer(ctx, { projectId, taskId, kind, revisionRoundId });

  days.forEach((day, i) => {
    const late = [0, 12, 4, 30, 8][i]!;
    clock.t = at(day, 9, 4);
    W.startWorkday(ctx, { focusTaskIds: i < 2 ? [devTasks[i * 2]!.id, devTasks[i * 2 + 1]!.id, onboarding.id] : [agency.id, onboarding.id], blocker: i === 3 ? 'Mild Fever' : 'None' });
    const morning = R.buildMorningReport(ctx);
    clock.t = at(day, 9, 6);
    R.recordReport(ctx, { type: 'morning', workdayId: morning.workdayId, generatedText: morning.text, finalText: morning.text, via: 'copy' });

    clock.t = at(day, 9, 10);
    work(dm.id, null); // briefing and planning, project-level
    clock.t = at(day, 9, 40);
    if (i < 2) {
      work(devm.id, devTasks[i * 2]!.id);
      clock.t = at(day, 11, 0);
      T.completeTask(ctx, devTasks[i * 2]!.id);
      work(devm.id, devTasks[i * 2 + 1]!.id);
      clock.t = at(day, 12, 10);
      T.completeTask(ctx, devTasks[i * 2 + 1]!.id);
      work(mingle.id, onboarding.id);
    } else if (i === 2) {
      work(dm.id, cover.id);
      clock.t = at(day, 10, 15);
      T.completeTask(ctx, cover.id);
      work(dm.id, inner.id);
      clock.t = at(day, 12, 0);
      work(mingle.id, onboarding.id, 'revision', round.id);
    } else {
      work(dm.id, visuals.id);
      clock.t = at(day, 12, 0);
      work(mingle.id, onboarding.id);
    }
    clock.t = at(day, 13, 31);
    T.startBreak(ctx, 'lunch');
    clock.t = at(day, 14, 31 + (i === 1 ? 10 : 0));
    T.endBreak(ctx, { resume: true });
    clock.t = at(day, 16, 30);
    if (i === 4) work(devm.id, devTasks[4]!.id);
    else if (i === 2) work(dribbble.id, thumb.id);
    else work(appStore.id, screens.id);
    clock.t = at(day, 17, 50 + late);
    T.stopTimer(ctx);
    if (i === 2) S.updateRevision(ctx, round.id, { status: 'done' });
    clock.t = at(day, 18, 4 + late);
    W.endWorkday(ctx, {});
    const evening = R.buildEveningReport(ctx, { workdayId: morning.workdayId });
    clock.t = at(day, 18, 6 + late);
    R.recordReport(ctx, { type: 'evening', workdayId: morning.workdayId, generatedText: evening.text, finalText: evening.text, via: 'copy' });
  });

  // Today: nothing started yet (dashboard shows "Before work"), with a planned Today.
  clock.t = at(today, 8, 50);
  for (const t of [agency, onboarding, caseStudy]) S.updateTask(ctx, t.id, { planBucket: 'today' });
  for (const t of [visuals, thumb]) S.updateTask(ctx, t.id, { planBucket: 'this_week' });

  const count = (sql: string) => (ctx.db.prepare(sql).get() as { n: number }).n;
  return { projects: count(`SELECT COUNT(*) AS n FROM projects`), tasks: count(`SELECT COUNT(*) AS n FROM tasks`), workdays: count(`SELECT COUNT(*) AS n FROM workdays`) };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed-sample.ts')) {
  const dir = defaultDataDir();
  mkdirSync(dir, { recursive: true });
  const db = openDatabase(join(dir, 'monkstracker.sqlite'));
  const clock = { t: Date.now() };
  const ctx = makeCtx(db, () => clock.t);
  seedDefaults(db, clock.t);
  const has = (db.prepare(`SELECT COUNT(*) AS n FROM projects`).get() as { n: number }).n;
  if (has && !process.argv.includes('--force')) {
    console.error(`This database already has ${has} projects. Refusing to add sample data. Use a different MONKSTRACKER_DATA folder.`);
    process.exit(1);
  }
  const result = seedSample(ctx, clock, new Date());
  console.log(`Sample data added to ${dir}:`, result);
  db.close();
}
