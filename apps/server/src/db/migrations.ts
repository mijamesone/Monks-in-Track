/**
 * Versioned schema migrations, applied in order and tracked with PRAGMA user_version.
 * Never edit a migration that has shipped; add a new one.
 *
 * Conventions: ids are TEXT (UUID), instants are INTEGER epoch milliseconds,
 * calendar dates are TEXT YYYY-MM-DD in local time, booleans are INTEGER 0/1.
 */
export const MIGRATIONS: readonly string[] = [
  /* 1 — initial schema (spec section E) */ `
  CREATE TABLE companies (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    short_name  TEXT,
    color       TEXT,
    logo_path   TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE categories (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    report_order INTEGER NOT NULL,
    archived_at  INTEGER
  );

  CREATE TABLE project_types (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER
  );

  CREATE TABLE statuses (
    id          TEXT PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    color       TEXT,
    emoji       TEXT NOT NULL DEFAULT '',
    report_text TEXT NOT NULL DEFAULT '',
    is_done     INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
    is_rejected INTEGER NOT NULL DEFAULT 0 CHECK (is_rejected IN (0, 1)),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    CHECK (NOT (is_done = 1 AND is_rejected = 1))
  );

  CREATE TABLE tags (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT
  );

  CREATE TABLE report_groups (
    id    TEXT PRIMARY KEY,
    label TEXT NOT NULL
  );

  CREATE TABLE projects (
    id               TEXT PRIMARY KEY,
    company_id       TEXT NOT NULL REFERENCES companies(id),
    name             TEXT NOT NULL,
    report_name      TEXT,
    report_group_id  TEXT REFERENCES report_groups(id) ON DELETE SET NULL,
    type_id          TEXT REFERENCES project_types(id),
    category_id      TEXT NOT NULL REFERENCES categories(id),
    status_id        TEXT NOT NULL REFERENCES statuses(id),
    priority         INTEGER NOT NULL DEFAULT 0,
    start_date       TEXT,
    deadline         TEXT,
    estimate_minutes INTEGER CHECK (estimate_minutes IS NULL OR estimate_minutes >= 0),
    assigned_by      TEXT,
    client_name      TEXT,
    huly_url         TEXT,
    description      TEXT,
    notes            TEXT,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    archived_at      INTEGER
  );
  CREATE INDEX projects_company ON projects(company_id);

  CREATE TABLE project_tags (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tag_id     TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, tag_id)
  );

  -- Huly project codes (BLOG_, DEV_B, FREEL) mapped to the MonksTracker project that pasted links file into.
  CREATE TABLE huly_codes (
    code       TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
  );

  CREATE TABLE tasks (
    id               TEXT PRIMARY KEY,
    project_id       TEXT NOT NULL REFERENCES projects(id),
    parent_id        TEXT REFERENCES tasks(id),
    name             TEXT NOT NULL,
    description      TEXT,
    status_id        TEXT NOT NULL REFERENCES statuses(id),
    priority         INTEGER NOT NULL DEFAULT 0,
    plan_bucket      TEXT NOT NULL DEFAULT 'backlog' CHECK (plan_bucket IN ('backlog', 'this_week', 'today')),
    planned_date     TEXT,
    due_date         TEXT,
    estimate_minutes INTEGER CHECK (estimate_minutes IS NULL OR estimate_minutes >= 0),
    huly_url         TEXT,
    huly_key         TEXT,
    sort_order       REAL NOT NULL DEFAULT 0,
    completed_at     INTEGER,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    archived_at      INTEGER,
    CHECK (parent_id IS NULL OR parent_id <> id)
  );
  CREATE INDEX tasks_project ON tasks(project_id);
  CREATE INDEX tasks_parent ON tasks(parent_id);
  CREATE INDEX tasks_bucket ON tasks(plan_bucket, sort_order);
  CREATE INDEX tasks_huly_key ON tasks(huly_key);

  CREATE TABLE task_tags (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id)
  );

  CREATE TABLE revision_rounds (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id),
    task_id      TEXT REFERENCES tasks(id),
    number       INTEGER NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT,
    requested_by TEXT,
    requested_at INTEGER NOT NULL,
    status       TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'in_progress', 'done')),
    completed_at INTEGER,
    created_at   INTEGER NOT NULL,
    UNIQUE (project_id, number)
  );

  CREATE TABLE workdays (
    id               TEXT PRIMARY KEY,
    date             TEXT NOT NULL UNIQUE,
    check_in_at      INTEGER NOT NULL,
    check_out_at     INTEGER,
    expected_minutes INTEGER NOT NULL,
    morning_blocker  TEXT,
    evening_blocker  TEXT,
    CHECK (check_out_at IS NULL OR check_out_at > check_in_at)
  );

  CREATE TABLE time_entries (
    id                TEXT PRIMARY KEY,
    project_id        TEXT REFERENCES projects(id),
    task_id           TEXT REFERENCES tasks(id),
    kind              TEXT NOT NULL CHECK (kind IN ('work', 'revision', 'meeting', 'break', 'lunch')),
    revision_round_id TEXT REFERENCES revision_rounds(id),
    meeting_id        TEXT,
    workday_id        TEXT REFERENCES workdays(id),
    started_at        INTEGER NOT NULL,
    ended_at          INTEGER,
    source            TEXT NOT NULL DEFAULT 'timer' CHECK (source IN ('timer', 'manual', 'pomodoro', 'review')),
    note              TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    CHECK (ended_at IS NULL OR ended_at > started_at),
    CHECK (kind NOT IN ('break', 'lunch') OR (project_id IS NULL AND task_id IS NULL)),
    CHECK (kind NOT IN ('work', 'revision') OR project_id IS NOT NULL),
    CHECK (task_id IS NULL OR project_id IS NOT NULL),
    CHECK ((kind = 'revision') = (revision_round_id IS NOT NULL))
  );
  CREATE INDEX entries_start ON time_entries(started_at);
  CREATE INDEX entries_project ON time_entries(project_id);
  CREATE INDEX entries_task ON time_entries(task_id);
  CREATE INDEX entries_workday ON time_entries(workday_id);
  -- Rule 3: at most one running work/revision/meeting timer, enforced by the database itself.
  CREATE UNIQUE INDEX one_running_timer ON time_entries((1)) WHERE ended_at IS NULL AND kind IN ('work', 'revision', 'meeting');
  -- And at most one running break or lunch.
  CREATE UNIQUE INDEX one_running_break ON time_entries((1)) WHERE ended_at IS NULL AND kind IN ('break', 'lunch');

  CREATE TABLE balance_entries (
    id         TEXT PRIMARY KEY,
    date       TEXT NOT NULL,
    minutes    INTEGER NOT NULL,
    reason     TEXT NOT NULL CHECK (reason IN ('workday', 'alter_leave_used', 'manual')),
    workday_id TEXT REFERENCES workdays(id),
    note       TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX balance_one_per_workday ON balance_entries(workday_id) WHERE reason = 'workday';

  CREATE TABLE leave_days (
    id       TEXT PRIMARY KEY,
    date     TEXT NOT NULL UNIQUE,
    type     TEXT NOT NULL CHECK (type IN ('sick', 'annual', 'alter', 'earned')),
    half_day INTEGER NOT NULL DEFAULT 0 CHECK (half_day IN (0, 1)),
    note     TEXT
  );

  CREATE TABLE reports (
    id                 TEXT PRIMARY KEY,
    workday_id         TEXT REFERENCES workdays(id),
    type               TEXT NOT NULL CHECK (type IN ('morning', 'evening', 'lunch_start', 'lunch_end')),
    generated_text     TEXT NOT NULL,
    final_text         TEXT NOT NULL,
    copied_at          INTEGER,
    sent_at            INTEGER,
    discord_message_id TEXT,
    locked             INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
    created_at         INTEGER NOT NULL
  );
  CREATE INDEX reports_workday ON reports(workday_id);

  CREATE TABLE notes (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL DEFAULT '',
    project_id TEXT REFERENCES projects(id),
    task_id    TEXT REFERENCES tasks(id),
    source     TEXT NOT NULL DEFAULT 'typed' CHECK (source IN ('typed', 'voice')),
    audio_path TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Small runtime facts such as the last heartbeat from the open app.
  CREATE TABLE app_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE activity (
    id        TEXT PRIMARY KEY,
    entity    TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action    TEXT NOT NULL,
    before    TEXT,
    after     TEXT,
    at        INTEGER NOT NULL
  );
  CREATE INDEX activity_entity ON activity(entity, entity_id, at);
  `,
];
