-- Deterministic LOCAL-ONLY payment data.
-- Applied after billing seed. Migration 0010 has already backfilled the July
-- bill's historical ₹5,000 paid balance into canonical payment evidence.
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

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
