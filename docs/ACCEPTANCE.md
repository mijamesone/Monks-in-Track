# Phase 1 acceptance gate

The 24 acceptance criteria from the spec (section H), each with its result and the test that proves it.
Run everything yourself with `pnpm test` (unit and integration) and `pnpm build && pnpm e2e` (browser).

**Result: 24 of 24 pass in automated tests.** Three of them also need one check on your own Windows PC, because this was tested on a Linux machine: real PC sleep, a Windows backup folder, and the app with the internet off. They are marked *Confirm on your PC*.

Test locations: `api` = `apps/server/test/api.test.ts`, `gate` = `apps/server/test/gate.test.ts`, `core/…` = `packages/core/test/…`, `e2e:<suite>` = `e2e/suites/<suite>.mjs`.

## Structure

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | A project can be saved with only a name and a company; every other field can be filled later. | Pass | api: "creates a project from just a name and a company"; e2e:m2-projects "create a project with only a name" |
| 2 | Selecting Designmonks in the company switcher filters Projects, Plan, Dashboard, Time and Reports. | Pass | e2e:gate-phase1 "the company switcher filters Projects, Plan, Time, Dashboard and Reports"; m5 "Company filter" for the Dashboard cards. Fixed during the gate: Reports did not follow the switcher after the first load. |
| 3 | Pasting a `BLOG_-653` Huly link into quick add creates a task under DM Blog with key BLOG_-653, once BLOG_ is mapped. | Pass | api: "pasted Huly links file themselves by project code"; e2e:m2-projects "quick add (Q) files a known Huly code into its project" |
| 4 | Completion % equals finished leaf items divided by all leaf items, and updates the moment a task is ticked. | Pass | core/parsers "counts finished leaves over all leaves"; e2e:m2-projects "completing the subtask updates completion" |
| 5 | Archiving a project with tracked time keeps its hours in Reports. | Pass | api: "keeps archived projects in analytics" |

## Time engine

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 6 | Starting a timer while another runs ends the first at the exact second the second starts; two entries never run. | Pass | core/timer "switching closes the old entry at the exact instant the new one starts"; api: "the database itself refuses a second running timer" |
| 7 | 1h project-level + 1h Task 1 + 30m Task 2 + 45m on a subtask of Task 2 = 3h 15m; Task 2 shows 1h 15m. | Pass | core/time "project total is 3h 15m with 1h direct", "task 2 shows 1h 15m"; api: "totals add up … (3h 15m example)" |
| 8 | Refreshing, closing Chrome for 10 minutes, or sleeping the PC for an hour loses no time and never double counts. | Pass · *Confirm on your PC* (sleep) | A running timer is only its start time on the server. api: "survives a refresh or restart"; e2e:gate-phase1 "a running timer survives closing the browser, with no time lost". Real Windows sleep has not been tried. |
| 9 | After sleep or a closed browser, the next open shows the forgotten-timer review for the unattended stretch. | Pass | core/timer "flags a heartbeat gap longer than 5 minutes"; api: "after sleep, asks what to do with the unattended stretch and can discard it" |
| 10 | A timer running over 3 hours without interaction is flagged. | Pass | core/timer "flags 3 hours without interaction even when the page stayed open"; api: "flags a timer running 3 hours without interaction" |
| 11 | Editing an entry's start, end or owner updates every total and report immediately. | Pass | api: "edits update totals immediately"; m3: "moves an entry to another project and its totals follow". Reports are generated from the entries each time, so they follow too. |
| 12 | An entry with its end before its start cannot be saved. | Pass | core/time "rejects an end before the start"; m3: "refuses … an entry that ends before it starts" |
| 13 | A task with an estimate shows the countdown, then overtime, then "finished X early" or "X over" at completion. | Pass | e2e:gate-phase1 "the timer counts down against the estimate, then shows the time over it" and "finishing a task with an estimate says how it went"; gate: "says finished X early or X over the estimate". **Built during the gate** (the finish message was missing). |

## Workday and reports

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 14 | Start Workday saves the check-in time, offers yesterday's unfinished Today tasks, and produces the morning report. | Pass | e2e:m4-workday (Start Workday steps); api: "carries unfinished Today tasks over" |
| 15 | The morning report matches the Appendix format: "Started my day", "Today's Focus", Client Work first, emoji before the status word, focus-task Huly links, blocker line. | Pass | core/report "has the Today's Focus line …"; api: "builds the morning report in your format"; e2e:m4-workday "the morning message reflects focus and blocker" |
| 16 | When DM Blog and DevM Blog share a status, the report shows one line "DM & DevM Blog" with both projects' task links. | Pass | core/report "reproduces your real DM & DevM Blog Done message"; m4: "a merge override in the preview keeps DM Blog and DevM Blog apart" |
| 17 | End Workday with a running timer asks what to do before finishing. | Pass | api: "ending with a running timer asks first"; e2e:m4-workday "End Workday asks what to do with the running timer" |
| 18 | The evening report lists projects touched today with the Huly links of tasks worked on today, and suggests the overtime note when the balance changed. | Pass | api: "builds the evening report from worked and completed tasks"; m4: "the evening preview uses the planned check-out time for the overtime note" |
| 19 | Workday duration, tracked work and breaks are shown separately and add up correctly. | Pass | core/workday "separates duration, tracked work, breaks and untracked time"; e2e:m4-workday review numbers |
| 20 | A session from 23:30 to 01:10 belongs to the earlier workday. | Pass | api: "a 23:30–01:10 session belongs to the earlier workday"; core/time midnight test |
| 21 | Copy places the edited text on the clipboard, and the report is stored and locked in history. | Pass | e2e:m4-workday "edit the message, copy it, and the edited text is saved to history"; api: "locks the copied text in history" |

## Analytics and data

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 22 | Reports show daily, weekly (Monday start) and monthly hours by company, project, task and category, matching the Time screen to the minute. | Pass | api: "analytics match the Time screen to the minute"; m5: "adds top tasks, a daily series …"; e2e:m5-dashboard-reports (week, month, filters) |
| 23 | A daily backup file appears in the chosen folder, and restoring it brings back all data. | Pass · *Confirm on your PC* (Windows folder path) | settings-lists: "is due once per day … even if the PC was off"; gate: "restores a backup exactly, keeps a safety copy …"; e2e:gate-phase1 backup and restore steps. **Built during the gate**: Settings › Backups (choose folder, back up now, restore) and restore itself were missing. |
| 24 | The app opens without login prompts other than the PIN, and works with the internet disconnected. | Pass · *Confirm on your PC* (internet off) | e2e:gate-phase1 "the app makes no request outside this computer"; PIN: gate "sets a PIN, locks the API, unlocks with it, and removes it"; e2e:gate-phase1 PIN steps. **Built during the gate**: Settings › Security and the unlock screen were missing. |

## Found and fixed during the gate

- Completing a task with an estimate now says "Finished 20m early" or "Finished 45m over the estimate".
- Settings › Backups: choose the folder, daily time and how long to keep; Back up now; list and Restore. A restore first saves a copy of your current data, so it can be undone.
- Restore runs as one transaction and checks the file first: either everything is restored or nothing changes.
- Two backups made in the same second no longer overwrite each other (this would have lost the "undo restore" copy).
- Settings › Security: set, change and remove a PIN, auto-lock time, Lock now; an unlock screen instead of a "cannot reach the server" error.
- Reports now follow the company switcher when it changes.
- The company switcher has a proper accessible name ("Company").

## Still to check on your PC (not part of the 24, but needed for real use)

- Install with `MonksTracker-Setup.exe` (`docs/SETUP-WINDOWS.md`), and check it starts with Windows in the tray. The installer was built and the app tested on Linux; it has not been run on Windows yet.
- Lunch chime, alarm and Windows notifications.
- A full real workday, then your list of fixes (the spec's last gate step).
