-- Phase 04 — Authentication core
-- Secure server-managed sessions. Raw session tokens are never stored in D1.
PRAGMA foreign_keys = ON;

CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_digest TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX user_sessions_user_active_idx
  ON user_sessions(user_id, revoked_at, expires_at);
CREATE INDEX user_sessions_expiry_idx
  ON user_sessions(expires_at, revoked_at);

CREATE TABLE login_history (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  attempted_email TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  ip_address TEXT,
  user_agent TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX login_history_user_time_idx
  ON login_history(user_id, created_at DESC);
CREATE INDEX login_history_ip_failures_idx
  ON login_history(ip_address, success, created_at DESC);
CREATE INDEX login_history_email_time_idx
  ON login_history(attempted_email, created_at DESC);
