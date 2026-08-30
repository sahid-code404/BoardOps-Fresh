-- Deterministic LOCAL-ONLY Notifications + Announcements fixture.
-- Applied after all operational/accounting seeds so audience eligibility is final.
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

INSERT OR IGNORE INTO announcements (
  id, institution_id, title, body, type, priority, target_audience,
  is_pinned, status, published_at, expires_at, created_by, created_at, updated_at
) VALUES (
  'announcement_local_welcome',
  'inst_boardops_local',
  'BoardOps local notice',
  'Deterministic local announcement used to verify durable idempotent inbox delivery.',
  'INFO', 'NORMAL', 'ALL', 1, 'PUBLISHED',
  '2026-08-30T12:00:00.000Z', NULL, 'usr_admin_local',
  '2026-08-30T12:00:00.000Z', '2026-08-30T12:00:00.000Z'
);

-- ALL targets only currently ACTIVE, non-deleted users: Admin + Riya.
INSERT OR IGNORE INTO notifications (
  id, institution_id, user_id, title, description, type, priority, route,
  read_at, source_type, source_id, delivery_key, created_at
) VALUES
  (
    'notification_local_welcome_admin', 'inst_boardops_local', 'usr_admin_local',
    'BoardOps local notice',
    'Deterministic local announcement used to verify durable idempotent inbox delivery.',
    'INFO', 'NORMAL', '/notifications', NULL,
    'ANNOUNCEMENT', 'announcement_local_welcome',
    'announcement:announcement_local_welcome:published',
    '2026-08-30T12:00:00.000Z'
  ),
  (
    'notification_local_welcome_riya', 'inst_boardops_local', 'usr_resident_riya_local',
    'BoardOps local notice',
    'Deterministic local announcement used to verify durable idempotent inbox delivery.',
    'INFO', 'NORMAL', '/notifications', NULL,
    'ANNOUNCEMENT', 'announcement_local_welcome',
    'announcement:announcement_local_welcome:published',
    '2026-08-30T12:00:00.000Z'
  );

COMMIT;
