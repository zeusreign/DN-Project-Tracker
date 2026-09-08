ALTER TABLE user_directory ADD COLUMN username TEXT;
ALTER TABLE user_directory ADD COLUMN last_login_at TEXT;
ALTER TABLE user_directory ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_directory ADD COLUMN locked_until TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_directory_username
ON user_directory(lower(username))
WHERE username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_directory_name
ON user_directory(last_name, first_name);

CREATE TABLE IF NOT EXISTS development_details (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  source_row INTEGER,
  request_date TEXT,
  requestor TEXT,
  deliverable_due_date TEXT,
  consultants TEXT,
  food_service_design TEXT,
  design_capp TEXT,
  subsidiary_expense_total REAL,
  original_estimate REAL,
  original_estimate_date TEXT,
  current_estimate REAL,
  current_estimate_date TEXT,
  promoted_at TEXT,
  promoted_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_development_details_due_date
ON development_details(deliverable_due_date);

PRAGMA optimize;
