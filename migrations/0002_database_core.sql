-- Phase 03 — Database Core
-- D1 is the authoritative relational store. This migration is immutable once released.
PRAGMA foreign_keys = ON;

CREATE TABLE institutions (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  currency_code TEXT NOT NULL DEFAULT 'INR' CHECK (length(currency_code) = 3),
  locale TEXT NOT NULL DEFAULT 'en-IN',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE accounting_periods (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  period_key TEXT NOT NULL CHECK (length(period_key) = 7 AND substr(period_key, 5, 1) = '-'),
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSING', 'CLOSED')),
  opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closing_started_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  UNIQUE (institution_id, period_key),
  CHECK (starts_on <= ends_on),
  CHECK ((status = 'CLOSED' AND closed_at IS NOT NULL) OR status <> 'CLOSED')
);

CREATE INDEX accounting_periods_institution_status_idx
  ON accounting_periods(institution_id, status, period_key);

-- Identity foundation only. Session/OTP/registration security is owned by Phase 04.
-- `role` is retained as a source-compatibility field until Phase 05 replaces
-- authorization decisions with the canonical role/permission engine.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'USER')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED')),
  institution_user_id TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  avatar_url TEXT,
  room TEXT,
  gender TEXT CHECK (gender IS NULL OR gender IN ('MALE', 'FEMALE', 'OTHER')),
  emergency_contact TEXT,
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  language TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  deletion_reason TEXT,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  UNIQUE (institution_id, institution_user_id)
);

CREATE UNIQUE INDEX users_email_ci_uidx ON users(lower(email));
CREATE UNIQUE INDEX users_institution_phone_uidx
  ON users(institution_id, phone)
  WHERE phone IS NOT NULL;
CREATE INDEX users_institution_status_idx ON users(institution_id, status, role);

CREATE TABLE idempotency_keys (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  actor_user_id TEXT,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'COMPLETED', 'FAILED')),
  response_status INTEGER,
  response_body_json TEXT CHECK (response_body_json IS NULL OR json_valid(response_body_json)),
  resource_type TEXT,
  resource_id TEXT,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE (institution_id, scope, idempotency_key)
);

CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys(expires_at, status);
CREATE INDEX idempotency_keys_actor_idx ON idempotency_keys(actor_user_id, created_at);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  request_id TEXT NOT NULL,
  reason TEXT,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX audit_events_institution_time_idx ON audit_events(institution_id, created_at DESC);
CREATE INDEX audit_events_entity_idx ON audit_events(institution_id, entity_type, entity_id, created_at DESC);
CREATE INDEX audit_events_actor_idx ON audit_events(actor_user_id, created_at DESC);
CREATE INDEX audit_events_request_idx ON audit_events(request_id);

-- Audit history is append-only at the database boundary.
CREATE TRIGGER audit_events_block_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are immutable');
END;

CREATE TRIGGER audit_events_block_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are immutable');
END;

CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT,
  dedupe_key TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TEXT,
  published_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX outbox_events_dedupe_uidx
  ON outbox_events(dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX outbox_events_delivery_idx ON outbox_events(status, available_at, created_at);
CREATE INDEX outbox_events_aggregate_idx ON outbox_events(institution_id, aggregate_type, aggregate_id, created_at);
