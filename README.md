# MonksTracker

A private, local-first work command centre for one designer working across companies: projects, tasks and subtasks, reliable time tracking, workdays, and ready-to-paste office reports.

The full product specification lives in the shared MonksTracker spec document; this repository implements it.

## Layout

| Path | What it is |
| --- | --- |
| `packages/core` | Pure business rules with no I/O: time totals, timer transitions, workday and balance maths, Huly link parsing, estimate parsing, completion %, Discord report generator, first-run defaults |
| `apps/server` | Local server on 127.0.0.1 with the SQLite database, migrations and the HTTP API |
| `apps/web` | The React app (after the design direction is set) |

## Requirements

- Node.js 22 or newer
- pnpm 10 (`corepack enable` once)

## Commands

```bash
pnpm install
pnpm test        # all unit and integration tests
pnpm typecheck   # strict TypeScript checks
```

## Rules that the code guarantees

- Time entries are the single source of truth; every total is derived and each entry is counted once.
- Only one work, revision or meeting timer can run at a time (enforced by the database, not just the app).
- A running timer stores only its start time, so refreshes, closed browsers and sleep never lose time.
- Breaks and lunch count in the workday, never in tracked work.
- An entry belongs to the workday it started in, even across midnight.
