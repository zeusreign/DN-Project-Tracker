ALTER TABLE projects ADD COLUMN source_sort_order INTEGER NOT NULL DEFAULT 9999;
ALTER TABLE projects ADD COLUMN section_name TEXT;
ALTER TABLE projects ADD COLUMN source_sheet TEXT;

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_roles (
  id INTEGER PRIMARY KEY,
  user_email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'viewer')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_source_sort_order
ON projects(source_sort_order);

CREATE INDEX IF NOT EXISTS idx_user_roles_role
ON user_roles(role);

PRAGMA optimize;
