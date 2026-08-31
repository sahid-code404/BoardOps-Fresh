-- Expense proof metadata. Proof bytes live in the private FILES R2 bucket.
PRAGMA foreign_keys = ON;

ALTER TABLE expenses ADD COLUMN proof_key TEXT;
ALTER TABLE expenses ADD COLUMN proof_name TEXT;
ALTER TABLE expenses ADD COLUMN proof_content_type TEXT;
ALTER TABLE expenses ADD COLUMN proof_size INTEGER
  CHECK (proof_size IS NULL OR (typeof(proof_size) = 'integer' AND proof_size > 0));

CREATE INDEX expenses_proof_idx
  ON expenses(institution_id, proof_key)
  WHERE proof_key IS NOT NULL;
