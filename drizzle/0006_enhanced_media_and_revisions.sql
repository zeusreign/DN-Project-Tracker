CREATE TABLE IF NOT EXISTS project_photos (
 id TEXT PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
 kind TEXT NOT NULL CHECK(kind IN ('cover','progress')), reporting_period TEXT,
 caption TEXT NOT NULL DEFAULT '', object_key TEXT NOT NULL, mime TEXT NOT NULL,
 actor_email TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_project_photos ON project_photos(project_id,kind,reporting_period);
CREATE TABLE IF NOT EXISTS activity_revisions (
 id TEXT PRIMARY KEY, update_id INTEGER NOT NULL REFERENCES project_updates(id),
 previous_text TEXT NOT NULL, revised_text TEXT NOT NULL, actor_email TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
