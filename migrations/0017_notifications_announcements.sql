-- Notifications + Announcements — durable inbox evidence and idempotent delivery
PRAGMA foreign_keys = ON;

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 200),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 5 AND 5000),
  type TEXT NOT NULL DEFAULT 'INFO'
    CHECK (type IN ('INFO','WARNING','MAINTENANCE','EVENT')),
  priority TEXT NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('NORMAL','HIGH','URGENT')),
  target_audience TEXT NOT NULL DEFAULT 'ALL'
    CHECK (target_audience IN ('ALL','RESIDENTS','ADMINS')),
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0,1)),
  status TEXT NOT NULL DEFAULT 'PUBLISHED'
    CHECK (status IN ('DRAFT','SCHEDULED','PUBLISHED','EXPIRED','ARCHIVED')),
  published_at TEXT,
  expires_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK ((status = 'PUBLISHED' AND published_at IS NOT NULL) OR status <> 'PUBLISHED')
);

CREATE INDEX announcements_status_time_idx
  ON announcements(institution_id, status, published_at DESC, created_at DESC);
CREATE INDEX announcements_audience_status_idx
  ON announcements(institution_id, target_audience, status);
CREATE INDEX announcements_pinned_idx
  ON announcements(institution_id, is_pinned DESC, published_at DESC);

-- Published delivery-bearing content is historical communication evidence.
CREATE TRIGGER announcements_published_content_immutable
BEFORE UPDATE OF title, body, type, priority, target_audience ON announcements
WHEN OLD.published_at IS NOT NULL
  AND (
    NEW.title <> OLD.title OR NEW.body <> OLD.body OR NEW.type <> OLD.type
    OR NEW.priority <> OLD.priority OR NEW.target_audience <> OLD.target_audience
  )
BEGIN
  SELECT RAISE(ABORT, 'published announcement delivery content is immutable; archive and create a correction');
END;

CREATE TRIGGER announcements_published_time_immutable
BEFORE UPDATE OF published_at ON announcements
WHEN OLD.published_at IS NOT NULL AND NEW.published_at IS NOT OLD.published_at
BEGIN
  SELECT RAISE(ABORT, 'announcement published_at is immutable');
END;

CREATE TRIGGER announcements_block_delete
BEFORE DELETE ON announcements
BEGIN
  SELECT RAISE(ABORT, 'announcements are durable history; archive instead');
END;

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  type TEXT NOT NULL DEFAULT 'INFO'
    CHECK (type IN ('INFO','SUCCESS','WARNING','DANGER')),
  priority TEXT NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  route TEXT,
  read_at TEXT,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  delivery_key TEXT NOT NULL CHECK (length(trim(delivery_key)) BETWEEN 1 AND 240),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE (institution_id, user_id, delivery_key)
);

CREATE INDEX notifications_user_read_time_idx
  ON notifications(institution_id, user_id, read_at, created_at DESC);
CREATE INDEX notifications_source_idx
  ON notifications(institution_id, source_type, source_id);

-- Only read state may change after delivery. This makes inbox delivery durable
-- evidence and prevents a retry/update from rewriting what a recipient saw.
CREATE TRIGGER notifications_content_immutable
BEFORE UPDATE OF institution_id, user_id, title, description, type, priority,
                 route, source_type, source_id, delivery_key, created_at ON notifications
BEGIN
  SELECT RAISE(ABORT, 'notification delivery content is immutable');
END;

CREATE TRIGGER notifications_block_delete
BEFORE DELETE ON notifications
BEGIN
  SELECT RAISE(ABORT, 'notifications are durable inbox history and cannot be hard-deleted');
END;

INSERT INTO permissions (id, permission_key, feature, action, description) VALUES
  ('perm_notifications_mark_read_self', 'notifications.mark_read_self', 'notifications', 'mark_read_self', 'Mark own notification delivery as read'),
  ('perm_announcements_read', 'announcements.read', 'announcements', 'read', 'Read announcements visible to the authenticated audience'),
  ('perm_announcements_create', 'announcements.create', 'announcements', 'create', 'Create and publish institution announcements'),
  ('perm_announcements_update', 'announcements.update', 'announcements', 'update', 'Update mutable announcement metadata or publish a draft'),
  ('perm_announcements_archive', 'announcements.archive', 'announcements', 'archive', 'Archive an announcement without deleting history');

-- Every authenticated role can read audience-appropriate announcements and
-- mutate only its own notification read state.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'notifications.mark_read_self', 'announcements.read'
);

-- Announcement publication is administrator-only.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'announcements.create', 'announcements.update', 'announcements.archive'
)
WHERE r.role_key IN ('ADMIN','SUPER_ADMIN');

CREATE TRIGGER roles_bootstrap_notifications_all
AFTER INSERT ON roles
BEGIN
  INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT NEW.id, p.id
  FROM permissions p
  WHERE p.permission_key IN ('notifications.mark_read_self','announcements.read');
END;

CREATE TRIGGER roles_bootstrap_announcements_admin
AFTER INSERT ON roles
WHEN NEW.role_key IN ('ADMIN','SUPER_ADMIN')
BEGIN
  INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT NEW.id, p.id
  FROM permissions p
  WHERE p.permission_key IN ('announcements.create','announcements.update','announcements.archive');
END;
