PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS business_units (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 99,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  business_unit_id INTEGER NOT NULL REFERENCES business_units(id),
  venue TEXT NOT NULL,
  project_type TEXT NOT NULL CHECK (project_type IN ('Capital', 'Development')),
  name TEXT NOT NULL,
  capp_number TEXT,
  initiative_number TEXT,
  project_manager TEXT,
  development_lead TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  phase TEXT,
  scope_description TEXT,
  current_update TEXT,
  previous_update TEXT,
  budget_risk TEXT NOT NULL DEFAULT 'Not Rated',
  schedule_risk TEXT NOT NULL DEFAULT 'Not Rated',
  precon_capp REAL,
  construction_capp REAL,
  add_capp REAL,
  approved_budget REAL,
  anticipated_final_cost REAL,
  original_start_date TEXT,
  current_start_date TEXT,
  original_turnover_date TEXT,
  current_turnover_date TEXT,
  duration_change_days INTEGER,
  reporting_period TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS project_updates (
  id INTEGER PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reporting_period TEXT NOT NULL,
  current_summary TEXT NOT NULL,
  previous_summary TEXT,
  author_name TEXT,
  author_email TEXT,
  author_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  actor_id TEXT,
  actor_email TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_business_unit ON projects(business_unit_id);
CREATE INDEX IF NOT EXISTS idx_projects_status_risk ON projects(status, budget_risk, schedule_risk);
CREATE INDEX IF NOT EXISTS idx_projects_reporting_period ON projects(reporting_period);
CREATE INDEX IF NOT EXISTS idx_updates_project_period ON project_updates(project_id, reporting_period);
CREATE INDEX IF NOT EXISTS idx_updates_created_at ON project_updates(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_key);

PRAGMA optimize;
