-- Phase 00 infrastructure-only migration.
-- Business/domain tables begin in Phase 03 after the source audit and schema design are approved.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS _runtime_probe (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  initialized_at TEXT NOT NULL
);
