-- Deterministic LOCAL-ONLY payment data.
-- Applied after billing seed. On upgrade, migration 0010 backfills pre-existing
-- bill paid balances. On a clean reset the fixture bill is seeded after the
-- migrations, so this file creates the equivalent canonical historical evidence.
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

INSERT INTO payments (
  id, institution_id, user_id, bill_id, amount_minor, method, status,
  reference, notes, approved_by, approved_at, created_at, updated_at
) VALUES (
  'bill_arjun_2026_07_local:migrated-paid-balance',
  'inst_boardops_local',
  'usr_resident_arjun_local',
  'bill_arjun_2026_07_local',
  500000,
  'BANK_TRANSFER',
  'APPROVED',
  'MIGRATED_BILL_PAID_BALANCE',
  'Canonical historical evidence for the seeded July bill paid balance',
  'usr_admin_local',
  '2026-08-01T00:15:00.000Z',
  '2026-08-01T00:15:00.000Z',
  '2026-08-01T00:15:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  bill_id = excluded.bill_id,
  amount_minor = excluded.amount_minor,
  method = excluded.method,
  status = 'APPROVED',
  reference = excluded.reference,
  notes = excluded.notes,
  approved_by = excluded.approved_by,
  approved_at = excluded.approved_at,
  effective_month = NULL,
  effective_year = NULL,
  status_before_delete = NULL,
  deleted_on = NULL,
  deletion_scheduled_for = NULL,
  deleted_by = NULL,
  deletion_reason = NULL,
  purged_at = NULL,
  updated_at = excluded.updated_at;

-- Pending linked payment used by the real-runtime approval/reversal lifecycle.
-- It is created in August so the current Payments month renders useful data.
INSERT INTO payments (
  id, institution_id, user_id, bill_id, amount_minor, method, status,
  reference, notes, idempotency_key, created_at, updated_at
) VALUES (
  'payment_arjun_pending_local',
  'inst_boardops_local',
  'usr_resident_arjun_local',
  'bill_arjun_2026_07_local',
  250000,
  'UPI',
  'PENDING',
  'LOCAL-PENDING-2500',
  'Deterministic local pending payment for approval/reversal tests',
  'seed-payment-arjun-pending-v1',
  '2026-08-15T06:30:00.000Z',
  '2026-08-15T06:30:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  bill_id = excluded.bill_id,
  amount_minor = excluded.amount_minor,
  method = excluded.method,
  status = 'PENDING',
  reference = excluded.reference,
  notes = excluded.notes,
  idempotency_key = excluded.idempotency_key,
  approved_by = NULL,
  approved_at = NULL,
  effective_month = NULL,
  effective_year = NULL,
  status_before_delete = NULL,
  deleted_on = NULL,
  deletion_scheduled_for = NULL,
  deleted_by = NULL,
  deletion_reason = NULL,
  purged_at = NULL,
  updated_at = excluded.updated_at;

COMMIT;
