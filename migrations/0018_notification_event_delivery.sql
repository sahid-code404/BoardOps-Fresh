-- Post-0017 integration — transactional domain-event delivery into the durable inbox.
--
-- Notification delivery is deliberately implemented at the D1 boundary for domain
-- events whose canonical state already lives in D1. The state transition and its
-- inbox evidence therefore participate in the same SQLite transaction. Every
-- delivery carries a stable event key and INSERT OR IGNORE relies on the 0017
-- UNIQUE(institution_id, user_id, delivery_key) constraint as the authoritative
-- replay/concurrency boundary.
--
-- This migration adds no permissions and changes no accounting/meal/user state
-- machine. It only observes successful canonical inserts/transitions.
PRAGMA foreign_keys = ON;

-- Resident leave submission -> all active institution administrators.
CREATE TRIGGER notifications_leave_submitted
AFTER INSERT ON leave_applications
WHEN NEW.status = 'PENDING'
BEGIN
  INSERT OR IGNORE INTO notifications (
    id, institution_id, user_id, title, description, type, priority, route,
    read_at, source_type, source_id, delivery_key, created_at
  )
  SELECT
    'notification:leave:' || NEW.id || ':submitted:' || u.id,
    NEW.institution_id,
    u.id,
    'New leave application',
    COALESCE((SELECT name FROM users WHERE id = NEW.user_id), 'Resident') ||
      ' applied for leave from ' || NEW.start_date || ' to ' || NEW.end_date || '.',
    'INFO', 'NORMAL', '/kitchen', NULL,
    'LEAVE', NEW.id, 'leave:' || NEW.id || ':submitted', NEW.created_at
  FROM users u
  WHERE u.institution_id = NEW.institution_id
    AND u.role IN ('ADMIN', 'SUPER_ADMIN')
    AND u.status = 'ACTIVE'
    AND u.deleted_at IS NULL;
END;

-- Leave approval/rejection -> the applicant.
CREATE TRIGGER notifications_leave_decision
AFTER UPDATE OF status ON leave_applications
WHEN OLD.status <> NEW.status AND NEW.status IN ('APPROVED', 'REJECTED')
BEGIN
  INSERT OR IGNORE INTO notifications (
    id, institution_id, user_id, title, description, type, priority, route,
    read_at, source_type, source_id, delivery_key, created_at
  ) VALUES (
    'notification:leave:' || NEW.id || ':decision:' || NEW.status || ':' || NEW.updated_at,
    NEW.institution_id,
    NEW.user_id,
    CASE NEW.status WHEN 'APPROVED' THEN 'Leave approved' ELSE 'Leave rejected' END,
    CASE NEW.status
      WHEN 'APPROVED' THEN 'Your leave application from ' || NEW.start_date || ' to ' || NEW.end_date || ' has been approved.'
      ELSE 'Your leave application from ' || NEW.start_date || ' to ' || NEW.end_date || ' has been rejected.' ||
           CASE WHEN NEW.admin_notes IS NOT NULL AND trim(NEW.admin_notes) <> '' THEN ' Reason: ' || NEW.admin_notes ELSE '' END
    END,
    CASE NEW.status WHEN 'APPROVED' THEN 'SUCCESS' ELSE 'WARNING' END,
    'NORMAL', '/user-meals', NULL,
    'LEAVE', NEW.id,
    'leave:' || NEW.id || ':decision:' || NEW.status || ':' || NEW.updated_at,
    NEW.updated_at
  );
END;

-- Resident payment submission -> all active institution administrators.
CREATE TRIGGER notifications_payment_submitted
AFTER INSERT ON payments
WHEN NEW.status = 'PENDING' AND NEW.method <> 'REFUND'
BEGIN
  INSERT OR IGNORE INTO notifications (
    id, institution_id, user_id, title, description, type, priority, route,
    read_at, source_type, source_id, delivery_key, created_at
  )
  SELECT
    'notification:payment:' || NEW.id || ':submitted:' || u.id,
    NEW.institution_id,
    u.id,
    'New payment submitted',
    COALESCE((SELECT name FROM users WHERE id = NEW.user_id), 'Resident') ||
      ' submitted a payment of ' || printf('₹%d.%02d', NEW.amount_minor / 100, abs(NEW.amount_minor % 100)) ||
      ' via ' || NEW.method || '.',
    'INFO', 'NORMAL', '/payments', NULL,
    'PAYMENT', NEW.id, 'payment:' || NEW.id || ':submitted', NEW.created_at
  FROM users u
  WHERE u.institution_id = NEW.institution_id
    AND u.role IN ('ADMIN', 'SUPER_ADMIN')
    AND u.status = 'ACTIVE'
    AND u.deleted_at IS NULL;
END;

-- Payment approval/rejection/void -> the resident. A transition timestamp is part
-- of the event identity so a later legitimate reversal/re-approval is a new event,
-- while retries that never perform another state change cannot duplicate delivery.
CREATE TRIGGER notifications_payment_status
AFTER UPDATE OF status ON payments
WHEN OLD.status <> NEW.status
  AND NEW.method <> 'REFUND'
  AND NEW.status IN ('APPROVED', 'REJECTED', 'VOID')
BEGIN
  INSERT OR IGNORE INTO notifications (
    id, institution_id, user_id, title, description, type, priority, route,
    read_at, source_type, source_id, delivery_key, created_at
  ) VALUES (
    'notification:payment:' || NEW.id || ':status:' || NEW.status || ':' || NEW.updated_at,
    NEW.institution_id,
    NEW.user_id,
    CASE NEW.status
      WHEN 'APPROVED' THEN 'Payment approved'
      WHEN 'REJECTED' THEN 'Payment rejected'
      ELSE 'Payment voided'
    END,
    'Your payment of ' || printf('₹%d.%02d', NEW.amount_minor / 100, abs(NEW.amount_minor % 100)) ||
      ' via ' || NEW.method || ' has been ' || lower(NEW.status) || '.',
    CASE NEW.status WHEN 'APPROVED' THEN 'SUCCESS' ELSE 'WARNING' END,
    'HIGH', '/billing', NULL,
    'PAYMENT', NEW.id,
    'payment:' || NEW.id || ':status:' || NEW.status || ':' || NEW.updated_at,
    NEW.updated_at
  );
END;

-- Administrative locked-meal override -> the affected resident.
CREATE TRIGGER notifications_meal_override
AFTER INSERT ON meal_overrides
BEGIN
  INSERT OR IGNORE INTO notifications (
    id, institution_id, user_id, title, description, type, priority, route,
    read_at, source_type, source_id, delivery_key, created_at
  ) VALUES (
    'notification:meal-override:' || NEW.id,
    NEW.institution_id,
    NEW.user_id,
    'Meal modified by Administrator',
    COALESCE((SELECT display_name FROM meal_configurations WHERE id = NEW.meal_id), 'Meal') ||
      ' on ' || NEW.service_date || ' was changed (' || NEW.action || '). Reason: ' || NEW.reason,
    'WARNING', 'HIGH', '/user-meals', NULL,
    'MEAL_OVERRIDE', NEW.id, 'meal-override:' || NEW.id, NEW.created_at
  );
END;

-- Durable refund obligation created -> resident.
CREATE TRIGGER notifications_refund_created
AFTER INSERT ON refunds
WHEN NEW.status = 'PENDING'
BEGIN
  INSERT OR IGNORE INTO notifications (
    id, institution_id, user_id, title, description, type, priority, route,
    read_at, source_type, source_id, delivery_key, created_at
  ) VALUES (
    'notification:refund:' || NEW.id || ':created',
    NEW.institution_id,
    NEW.user_id,
    'Refund initiated',
    'Your refund of ' || printf('₹%d.%02d', NEW.amount_minor / 100, abs(NEW.amount_minor % 100)) ||
      ' (' || NEW.refund_number || ') has been initiated and is pending processing.',
    'INFO', 'HIGH', '/payments', NULL,
    'REFUND', NEW.id, 'refund:' || NEW.id || ':created', NEW.created_at
  );
END;

-- Each immutable payout transaction -> resident. Transaction id is the event id,
-- so a replay rejected/ignored by the refund idempotency boundary cannot fan out.
CREATE TRIGGER notifications_refund_transaction
AFTER INSERT ON refund_transactions
BEGIN
  INSERT OR IGNORE INTO notifications (
    id, institution_id, user_id, title, description, type, priority, route,
    read_at, source_type, source_id, delivery_key, created_at
  )
  SELECT
    'notification:refund-transaction:' || NEW.id,
    NEW.institution_id,
    r.user_id,
    'Refund payment recorded',
    'A refund payment of ' || printf('₹%d.%02d', NEW.amount_minor / 100, abs(NEW.amount_minor % 100)) ||
      ' was recorded for ' || r.refund_number || '.',
    'SUCCESS', 'HIGH', '/payments', NULL,
    'REFUND', r.id, 'refund-transaction:' || NEW.id, NEW.created_at
  FROM refunds r
  WHERE r.id = NEW.refund_id AND r.institution_id = NEW.institution_id;
END;

-- Refund cancellation -> resident.
CREATE TRIGGER notifications_refund_cancelled
AFTER UPDATE OF status ON refunds
WHEN OLD.status <> NEW.status AND NEW.status = 'CANCELLED'
BEGIN
  INSERT OR IGNORE INTO notifications (
    id, institution_id, user_id, title, description, type, priority, route,
    read_at, source_type, source_id, delivery_key, created_at
  ) VALUES (
    'notification:refund:' || NEW.id || ':cancelled:' || NEW.updated_at,
    NEW.institution_id,
    NEW.user_id,
    'Refund cancelled',
    'Your refund ' || NEW.refund_number || ' has been cancelled.' ||
      CASE WHEN NEW.reason IS NOT NULL AND trim(NEW.reason) <> '' THEN ' Reason: ' || NEW.reason ELSE '' END,
    'WARNING', 'HIGH', '/payments', NULL,
    'REFUND', NEW.id, 'refund:' || NEW.id || ':status:CANCELLED:' || NEW.updated_at, NEW.updated_at
  );
END;

-- Registration review outcome -> applicant. Initial PENDING_REVIEW/RESUBMITTED
-- inserts are intentionally not notifications; only an administrator decision is.
CREATE TRIGGER notifications_registration_review
AFTER UPDATE OF status ON registration_requests
WHEN OLD.status <> NEW.status AND NEW.status IN ('CHANGES_REQUESTED', 'APPROVED', 'REJECTED')
BEGIN
  INSERT OR IGNORE INTO notifications (
    id, institution_id, user_id, title, description, type, priority, route,
    read_at, source_type, source_id, delivery_key, created_at
  ) VALUES (
    'notification:registration:' || NEW.id || ':status:' || NEW.status || ':' || NEW.updated_at,
    NEW.institution_id,
    NEW.user_id,
    CASE NEW.status
      WHEN 'CHANGES_REQUESTED' THEN 'Changes requested for your registration'
      WHEN 'APPROVED' THEN 'Account Approved'
      ELSE 'Registration rejected'
    END,
    CASE NEW.status
      WHEN 'CHANGES_REQUESTED' THEN COALESCE(NEW.reason, 'Please review and correct the requested registration details.')
      WHEN 'APPROVED' THEN 'Your account has been approved. Welcome to BoardOps!'
      ELSE COALESCE(NEW.reason, 'Your registration has been rejected.')
    END,
    CASE NEW.status WHEN 'APPROVED' THEN 'SUCCESS' WHEN 'REJECTED' THEN 'DANGER' ELSE 'WARNING' END,
    'HIGH', NULL, NULL,
    'REGISTRATION', NEW.id,
    'registration:' || NEW.id || ':status:' || NEW.status || ':' || NEW.updated_at,
    NEW.updated_at
  );
END;

-- Non-registration account lifecycle updates -> affected user. Pending-account
-- approval/rejection is owned above by the RegistrationRequest transition to avoid
-- duplicate user-facing deliveries.
CREATE TRIGGER notifications_user_status
AFTER UPDATE OF status ON users
WHEN OLD.status <> NEW.status
  AND OLD.status <> 'PENDING'
  AND NEW.status IN ('ACTIVE', 'SUSPENDED', 'INACTIVE', 'ARCHIVED')
BEGIN
  INSERT OR IGNORE INTO notifications (
    id, institution_id, user_id, title, description, type, priority, route,
    read_at, source_type, source_id, delivery_key, created_at
  ) VALUES (
    'notification:user:' || NEW.id || ':status:' || NEW.status || ':' || NEW.updated_at,
    NEW.institution_id,
    NEW.id,
    CASE
      WHEN NEW.status = 'ACTIVE' AND OLD.status = 'ARCHIVED' THEN 'Account Restored'
      WHEN NEW.status = 'ACTIVE' THEN 'Account Activated'
      WHEN NEW.status = 'SUSPENDED' THEN 'Account Suspended'
      WHEN NEW.status = 'INACTIVE' THEN 'Account Deactivated'
      WHEN NEW.status = 'ARCHIVED' AND NEW.deleted_at IS NOT NULL THEN 'Account Scheduled for Deletion'
      ELSE 'Account Archived'
    END,
    CASE
      WHEN NEW.status = 'ACTIVE' AND OLD.status = 'ARCHIVED' THEN 'Your account has been restored.'
      WHEN NEW.status = 'ACTIVE' THEN 'Your account is now active.'
      WHEN NEW.status = 'SUSPENDED' THEN 'Your account has been suspended. Contact administration.'
      WHEN NEW.status = 'INACTIVE' THEN 'Your account has been deactivated.'
      WHEN NEW.status = 'ARCHIVED' AND NEW.deleted_at IS NOT NULL THEN
        'Your account has been scheduled for deletion.' || CASE WHEN NEW.deletion_reason IS NOT NULL THEN ' Reason: ' || NEW.deletion_reason ELSE '' END
      ELSE 'Your account has been archived.'
    END,
    CASE WHEN NEW.status = 'ACTIVE' THEN 'SUCCESS' WHEN NEW.status = 'SUSPENDED' THEN 'DANGER' ELSE 'WARNING' END,
    'HIGH', '/profile', NULL,
    'USER', NEW.id,
    'user:' || NEW.id || ':status:' || NEW.status || ':' || NEW.updated_at,
    NEW.updated_at
  );
END;

-- Role changes are independent from status and remain visible to the affected user.
CREATE TRIGGER notifications_user_role
AFTER UPDATE OF role ON users
WHEN OLD.role <> NEW.role
BEGIN
  INSERT OR IGNORE INTO notifications (
    id, institution_id, user_id, title, description, type, priority, route,
    read_at, source_type, source_id, delivery_key, created_at
  ) VALUES (
    'notification:user:' || NEW.id || ':role:' || NEW.role || ':' || NEW.updated_at,
    NEW.institution_id,
    NEW.id,
    'Role Updated',
    'Your role is now ' || NEW.role || '.',
    'INFO', 'HIGH', '/profile', NULL,
    'USER', NEW.id,
    'user:' || NEW.id || ':role:' || NEW.role || ':' || NEW.updated_at,
    NEW.updated_at
  );
END;
