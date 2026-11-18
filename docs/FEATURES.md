# MonksTracker feature inventory

Every feature the app has today, where it currently lives on screen, and whether a browser test checks it.

**Why this exists.** The design phase will move things around (for example, the left sidebar becoming a floating header). The design may change *where* a feature sits and *how it looks*, never *whether it exists*. After each redesigned screen, this list is ticked off and `pnpm e2e` is run.

**Test column.** `e2e: m4` means a step in `e2e/suites/m4-workday.mjs` uses this feature through the real interface. `server` means it is covered by the API tests only (`pnpm test`). `none` means no automated check yet: verify it by hand after a redesign.

Last updated: M5 (Plan board, full Dashboard, hours analytics). This is the complete Phase 1 feature set.

## App frame

| Feature | Where it is now | Test |
|---|---|---|
| Navigation: Dashboard, Plan, Projects, Time, Calendar, Notes, Reports, Settings | Left sidebar | e2e: m2–m5 (by URL and links) |
| Company switcher (All Companies / one company filter) | Left sidebar, top | none |
| Quick add button and the **Q** shortcut | Sidebar bottom; key Q anywhere | e2e: m2 |
| Theme by time of day (light from / dark from), or fixed light/dark | Automatic; set in Settings → Theme | none |
| Offline banner when the local server cannot be reached | Top of content | none |
| Heartbeat every 30 s; "timer kept running while you were away" review bar with Keep it all / Stop at … | Top of timer bar | server |
| Sounds (chime, alarm) and optional Windows notifications | Lunch flow | none (needs a real PC) |

## Timer bar (top of every screen)

| Feature | Where it is now | Test |
|---|---|---|
| Workday chip: "Workday not started" / "Working since 09:07" / "Ended at 18:05" | Timer bar, left | e2e: m4 (indirect) |
| Running timer: project › task, elapsed time, time left or over the estimate | Timer bar | e2e: m3 |
| Pause | Timer bar | none (server: stop) |
| Done (complete the running task); "Finished 20m early / 45m over" message for tasks with an estimate | Timer bar; message bottom left | e2e: gate-phase1; server |
| Revision mode (switch to a revision round and back; "Revision on") | Timer bar → dialog "Revision mode" | e2e: m3 |
| Edit start time ("When did you start?"), refuses overlaps incl. lunch | Timer bar, clock button | e2e: m3; server |
| Open the task in Huly | Timer bar, link icon | none |
| Start lunch / Start a short break | Timer bar, right icons | e2e: m3 (via lunch prompt) |
| On a break: "until 14:41", Back to {task} | Timer bar | e2e: m3 |
| Resume the last stopped task | Timer bar when idle | none |
| Stays on one line at 1440 px, even with Revision on | Timer bar | e2e: m3 |

## Dashboard

| Feature | Where it is now | Test |
|---|---|---|
| Three states: before work, during work, after work | Dashboard | e2e: m4 |
| Before work: Start Workday button, carried-over tasks preview | Dashboard | e2e: m4 |
| During work: active timer card with estimate progress bar and Pause | Dashboard | none |
| Before work: From This Week card, add a task to Today with one click | Dashboard | e2e: m5 |
| Before work: Deadlines, Alerts, Today's meetings (placeholder until Phase 3) | Dashboard | e2e: m5 |
| During work: Quick switch (recent open tasks, one-click timer switch) | Dashboard | e2e: m5 |
| During work: Revisions due (open rounds across projects) | Dashboard | e2e: m5 (present); server |
| During work: Productivity (tracked today, this week, focus done) | Dashboard | e2e: m5 |
| During work: Alerts (overlapping entries, Today over capacity, overdue deadlines, timer over estimate, morning message not copied) | Dashboard | e2e: m5 (morning); server |
| During work: Completed today, Deadlines this week, Quick notes (placeholder until Phase 2) | Dashboard | e2e: m5 (present); server |
| During work: workday card (length, check-in with **Edit**, tracked time) | Dashboard, right card | e2e: m4 (edit in wizard) |
| During work: "Morning message copied at …" / Open, or "not copied yet" / Morning setup | Workday card | e2e: m4 |
| During work: End Workday | Workday card | e2e: m4 |
| Today's focus list: start timer (play), mark done (check), "x of y done" | Dashboard | none (server) |
| Tasks completed on earlier days leave Today's focus | Dashboard | none |
| After work: workday, tracked, lunch and breaks, untracked, balance today and total | Dashboard | e2e: m4 |
| After work: Write / Open evening message | Dashboard | e2e: m4 |
| After work: Reopen workday | Dashboard | e2e: m4 |
| After work: Completed today, For tomorrow (open focus tasks), Today's messages | Dashboard | none (server) |

## Start Workday wizard (flow 1)

| Feature | Where it is now | Test |
|---|---|---|
| Check-in saved the moment the wizard opens | Dialog "Start Workday" | e2e: m4 |
| Correct the check-in time | Wizard header, **Edit** | e2e: m4 |
| Step 1 Carry over: unfinished Today tasks, all ticked; unticked move to This Week | Wizard | e2e: m4; server |
| Step 2 Today's focus: reorder by drag or up/down arrows, remove, add from This Week, show Backlog | Wizard | e2e: m4 (arrows, add) |
| Step 3 Blocker (empty = "None") | Wizard | e2e: m4 |
| Step 4 Message: morning report in your format, live from your choices | Wizard | e2e: m4; server |
| "Later" closes the wizard; the workday stays started | Wizard | none |

## End Workday wizard (flow 8)

| Feature | Where it is now | Test |
|---|---|---|
| Running timer: stop at check-out / stop at an earlier time / keep running | Dialog "End Workday", step 1 (only if a timer runs) | e2e: m4 (stop at check-out); server |
| Check-out time (default: the moment you pressed End Workday) | Review step | e2e: m4; server (no future check-out) |
| Numbers: workday, tracked, lunch and breaks, untracked, balance today and total | Review step | e2e: m4 (visible) |
| Completed today / Still in progress (with time) / Not started / Revisions today | Review step | e2e: m4; server |
| Blocker prefilled from the morning | Review step | e2e: m4 |
| Evening message, then **End workday at HH:MM** | Message step | e2e: m4 |

## Message composer (morning and evening)

| Feature | Where it is now | Test |
|---|---|---|
| Change a project's status right in the message (updates the project) | Composer, "Project statuses in this message" | e2e: m4 |
| Merge grouped projects on/off for this message (DM & DevM Blog) | Composer checkbox | server |
| Overtime note in the first line on/off (evening) | Composer checkbox | e2e: m4; server |
| Edit the text freely; "Edited" badge; Back to generated | Composer | e2e: m4 |
| Copy message → clipboard and saved to history (locked) | Composer | e2e: m4 |
| Send to Discord | Composer (disabled until Phase 3) | — |

## Lunch flow (flow 11)

| Feature | Where it is now | Test |
|---|---|---|
| 13:20 heads-up toast ("Lunch in 10 minutes"), Also notify in Windows | Bottom-right toast | none |
| 13:30 prompt: Take lunch break / Cancel | Dialog "Time for lunch" | e2e: m3 |
| "Taking lunch break" / "Back from lunch!" messages, Copy, saved to history | Dialogs "Enjoy your lunch" / "Welcome back" | e2e: m3 (start message) |
| Alarm 1 minute before the end: Off, +5, +10, +15 (saved on the server) | Dialog "Lunch ends in 1 minute" | e2e: m3 (+10); server |
| Off ends lunch and resumes the paused task | Alarm dialog | server |
| Short break uses the break length (10 min default) | Timer bar | server |

## Plan board

| Feature | Where it is now | Test |
|---|---|---|
| Three columns: Backlog, This Week, Today, across projects (company switcher applies) | Plan page | e2e: m5 |
| Card: company colour, parent › name for subtasks, project, status, Huly key, open subtasks, scheduled date, estimate | Plan cards | e2e: m5 |
| Today total against your working hours (9h day − 1h lunch = 8h); amber when over | Plan header | e2e: m5 |
| Drag between columns and reorder (top of Today = first focus) | Plan | e2e: m5 |
| Multi-select and move together | Plan, selection toolbar | e2e: m5 |
| More menu: move to another column, move up/down, schedule for a date, open in Huly | Plan card | e2e: m5 (move down, move column) |
| Moving a task with open subtasks asks whether to move them too | Plan | e2e: m5; server |
| Start timer and mark done from a card | Plan card | none |
| Filter by task, project or Huly key | Plan header | e2e: m5 |
| Add to a column (opens Quick add set to that column) | Bottom of each column | e2e: m5 |
| A failed move puts the board back and says so | Plan | none |

## Projects

| Feature | Where it is now | Test |
|---|---|---|
| Project list with search, List / Board (by status) views, show archived, completion, Huly link | Projects page | e2e: m2 (list) |
| New project (only a name required; company, category, type, report name, estimate, Huly link optional) | Dialog "New project" | e2e: m2 |
| Project header: company, category, status, completion, tracked, estimate, remaining, Track project time | Project page | e2e: m2 (completion) |
| Tasks tab: add task (Enter keeps the field open), "1h 30m" estimates, pasted Huly links | Project page | e2e: m2 |
| Subtasks: indent / outdent, add subtask, collapse | Task rows | e2e: m2 (indent, collapse) |
| Task row: done checkbox, rename, status, estimate, start timer, archive | Task rows | e2e: m2 (done, estimate) |
| Overview tab: all project fields incl. name in reports and report group | Project page | e2e: m2 (report name) |
| Time tab: entries by day | Project page | none |
| Revisions tab: request a round, change its status | Project page | none (server) |
| Archive project | Project page bottom | none |

## Time screen

| Feature | Where it is now | Test |
|---|---|---|
| Week navigator (previous, this week, next), kind filter | Time page header | e2e: m3 (view) |
| Opened from Reports: that week, only that project, with a chip to show all | Time page header | e2e: m5 |
| Entries grouped by day with day totals; overlaps highlighted | Time page | e2e: m3 |
| Add forgotten time (project, task, kind, revision round, date, start, end, note) | Dialog "Add time" | e2e: m3 |
| Inline 24-hour start/end editing | Entry rows | e2e: m3 |
| Split an entry | Row → dialog "Split entry" | e2e: m3; server |
| Restart a past entry | Row | server |
| Edit (move to another project/task, change kind) | Row → dialog | server |
| Delete with Undo | Row | e2e: m3 |

## Reports

| Feature | Where it is now | Test |
|---|---|---|
| Message history: every copied message, grouped by day, filter by type, Edited badge, Show all, Copy again | Reports page | e2e: m4 |
| Period: day / week (Monday start) / month, previous / next / this period | Reports → Hours | e2e: m5 |
| Filters: company, project, category, tag | Reports → Hours | e2e: m5 (category); server (tag) |
| Totals: workday time, tracked work, lunch and breaks, revision share, completed and still planned, finished tasks over estimate | Reports → Hours | e2e: m5 |
| Tracked work per day (click a day to open that week in Time) | Reports → Hours | e2e: m5 |
| By company, Client vs internal, By project, Top tasks | Reports → Hours | e2e: m5 |
| Clicking a project or task bar opens its time entries in Time | Reports → Time with "Only {project}" | e2e: m5 |
| Kind of work: first-pass work vs revisions vs meetings | Reports → Hours | none (server) |
| Time balance per day and running total | Reports → Hours | e2e: m5 |
| Estimate vs actual for finished tasks | Reports → Hours | server |
| Show table for every chart | Each chart | e2e: m5 (daily chart) |

## Settings

| Feature | Where it is now | Test |
|---|---|---|
| Companies: add, rename, short name, colour | Settings | none (server) |
| Statuses: name, emoji, report text, counts as open/done/rejected, add, delete | Settings | e2e: m2 (report text) |
| Report groups (e.g. DM & DevM Blog) | Settings | server |
| Huly codes → project (BLOG_ → DM Blog) | Settings | server |
| Theme: auto / light / dark, light from, dark from | Settings | none |
| Backups: folder, daily time, keep days, Back up now, list, Restore (saves a copy first) | Settings › Backups | e2e: gate-phase1; server |
| Security: set / change / remove PIN, auto-lock minutes, Lock now; unlock screen | Settings › Security (PIN) | e2e: gate-phase1; server |

## Not built yet (so not in this list)

Command palette (Ctrl+K), right panel, Activity and Notes tabs on projects; Calendar, Notes, focus mode, Pomodoro, celebrations, idle detection (Phase 2); Discord sending, Huly live lookup, Google Calendar, voice notes, Gantt (Phase 3).
