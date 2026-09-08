CREATE TABLE IF NOT EXISTS user_directory (
  id INTEGER PRIMARY KEY,
  user_email TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
  title TEXT,
  department TEXT NOT NULL DEFAULT 'Design & Construction',
  company TEXT NOT NULL DEFAULT 'Delaware North',
  business_unit_scope TEXT NOT NULL DEFAULT 'All',
  location TEXT,
  mobile_phone TEXT,
  account_status TEXT NOT NULL DEFAULT 'pending' CHECK (account_status IN ('pending', 'active', 'suspended')),
  site_access_status TEXT NOT NULL DEFAULT 'pending' CHECK (site_access_status IN ('pending', 'authorized', 'email_required', 'revoked')),
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_directory_email
ON user_directory(lower(user_email))
WHERE user_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_directory_role_status
ON user_directory(role, account_status);

PRAGMA optimize;
