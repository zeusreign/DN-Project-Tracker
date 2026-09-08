ALTER TABLE user_directory ADD COLUMN password_hash TEXT;
ALTER TABLE user_directory ADD COLUMN password_salt TEXT;
ALTER TABLE user_directory ADD COLUMN password_iterations INTEGER;
ALTER TABLE user_directory ADD COLUMN password_algorithm TEXT;
ALTER TABLE user_directory ADD COLUMN password_changed_at TEXT;
ALTER TABLE user_directory ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS login_sessions (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES user_directory(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_login_sessions_user_expires
ON login_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS login_events (
  id INTEGER PRIMARY KEY,
  user_directory_id INTEGER REFERENCES user_directory(id) ON DELETE SET NULL,
  username_attempted TEXT,
  event_type TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_login_events_created
ON login_events(created_at DESC);

PRAGMA optimize;
