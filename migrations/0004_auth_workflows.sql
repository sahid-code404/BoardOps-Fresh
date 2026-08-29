-- Phase 04 — Registration, verification and password-recovery workflows
-- Immutable migration. Secrets are stored only as salted password-style hashes.
PRAGMA foreign_keys = ON;

CREATE TABLE registration_requests (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  cycle INTEGER NOT NULL CHECK (cycle >= 1),
  status TEXT NOT NULL CHECK (
    status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'RESUBMITTED')
  ),
  fields_json TEXT NOT NULL CHECK (json_valid(fields_json)),
  reason TEXT,
  fields_needing_correction_json TEXT CHECK (
    fields_needing_correction_json IS NULL OR json_valid(fields_needing_correction_json)
  ),
  reviewed_by TEXT,
  reviewed_at TEXT,
  request_ip TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (user_id, cycle)
);

CREATE INDEX registration_requests_institution_status_idx
  ON registration_requests(institution_id, status, created_at DESC);
CREATE INDEX registration_requests_user_cycle_idx
  ON registration_requests(user_id, cycle DESC);
CREATE INDEX registration_requests_request_ip_idx
  ON registration_requests(request_ip, created_at DESC);

CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (
    purpose IN ('EMAIL_VERIFY', 'PASSWORD_RESET_OTP', 'PASSWORD_RESET_TOKEN', 'REGISTRATION_ACCESS')
  ),
  secret_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  request_ip TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX auth_challenges_lookup_idx
  ON auth_challenges(user_id, purpose, consumed_at, expires_at, created_at DESC);
CREATE INDEX auth_challenges_email_idx
  ON auth_challenges(email, purpose, created_at DESC);
CREATE INDEX auth_challenges_request_ip_idx
  ON auth_challenges(request_ip, purpose, created_at DESC);
CREATE INDEX auth_challenges_expiry_idx
  ON auth_challenges(expires_at, consumed_at);
