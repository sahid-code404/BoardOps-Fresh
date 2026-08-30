-- Deterministic LOCAL-ONLY Audit / System / Background Tasks fixtures.
-- These records exercise immutable task history and the existing append-only audit authority.
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

INSERT OR IGNORE INTO background_tasks (
  id, institution_id, type, status, progress, payload_json, result_json, error_message,
  retry_count, max_retries, scheduled_for, started_at, finished_at, triggered_by, created_at, updated_at
) VALUES
  (
    'task_session_cleanup_seed', 'inst_boardops_local', 'SESSION_CLEANUP', 'COMPLETED', 100,
    '{"source":"local-seed"}', '{"purgedSessions":0}', NULL,
    0, 0, NULL, '2026-08-30T18:00:00.000Z', '2026-08-30T18:00:01.000Z',
    'usr_admin_local', '2026-08-30T18:00:00.000Z', '2026-08-30T18:00:01.000Z'
  ),
  (
    'task_system_backup_queued_seed', 'inst_boardops_local', 'SYSTEM_BACKUP', 'QUEUED', 0,
    '{"source":"local-seed","purpose":"cancellation-proof"}', NULL, NULL,
    0, 0, NULL, NULL, NULL,
    'usr_admin_local', '2026-08-30T18:05:00.000Z', '2026-08-30T18:05:00.000Z'
  );

INSERT OR IGNORE INTO audit_events (
  id, institution_id, actor_user_id, action, entity_type, entity_id,
  request_id, reason, metadata_json, created_at
) VALUES (
  'audit_system_checkpoint_seed', 'inst_boardops_local', 'usr_admin_local',
  'SYSTEM_CHECKPOINT', 'System', 'system-local', 'seed:audit-system',
  'Deterministic Audit/System checkpoint',
  '{"newValue":{"status":"READY"},"ipAddress":"127.0.0.1","userAgent":"BoardOps local seed"}',
  '2026-08-30T18:10:00.000Z'
);

COMMIT;
