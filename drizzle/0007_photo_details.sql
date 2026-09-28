-- Additive photo metadata; apply after 0006 before deploying this release.
ALTER TABLE project_photos ADD COLUMN date_taken TEXT;
ALTER TABLE project_photos ADD COLUMN taken_by TEXT NOT NULL DEFAULT '';
ALTER TABLE project_photos ADD COLUMN area TEXT NOT NULL DEFAULT '';
ALTER TABLE project_photos ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE project_photos ADD COLUMN include_in_report INTEGER NOT NULL DEFAULT 1;
ALTER TABLE project_photos ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE project_photos ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE project_photos ADD COLUMN photo_number TEXT;
CREATE UNIQUE INDEX idx_photo_number ON project_photos(photo_number) WHERE photo_number IS NOT NULL;
CREATE TABLE photo_number_sequences(prefix TEXT PRIMARY KEY, last_number INTEGER NOT NULL CHECK(last_number BETWEEN 1 AND 99));
ALTER TABLE project_photos ADD COLUMN deleted_at TEXT;
