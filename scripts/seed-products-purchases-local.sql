-- Deterministic LOCAL-ONLY Products / Purchases catalog fixtures.
-- Purchases themselves are exercised transactionally by the verifier/runtime test
-- so existing canonical expense/fund totals remain unchanged.
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

INSERT INTO units (
  id, institution_id, name, category, is_active, created_by, created_at, updated_at
) VALUES
  ('unit_kg_local', 'inst_boardops_local', 'kg', 'WEIGHT', 1, 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'),
  ('unit_litre_local', 'inst_boardops_local', 'litre', 'VOLUME', 1, 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'),
  ('unit_piece_local', 'inst_boardops_local', 'piece', 'QUANTITY', 1, 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'),
  ('unit_packet_local', 'inst_boardops_local', 'packet', 'QUANTITY', 1, 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  category = excluded.category,
  is_active = excluded.is_active,
  updated_at = excluded.updated_at;

INSERT INTO products (
  id, institution_id, name, slug, category, default_unit_id,
  is_active, archived_at, created_by, created_at, updated_at
) VALUES
  ('product_rice_local', 'inst_boardops_local', 'Rice', 'rice', 'GRAINS', 'unit_kg_local', 1, NULL, 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'),
  ('product_oil_local', 'inst_boardops_local', 'Cooking Oil', 'cooking-oil', 'OIL', 'unit_litre_local', 1, NULL, 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'),
  ('product_eggs_local', 'inst_boardops_local', 'Eggs', 'eggs', 'PROTEIN', 'unit_piece_local', 1, NULL, 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  slug = excluded.slug,
  category = excluded.category,
  default_unit_id = excluded.default_unit_id,
  is_active = excluded.is_active,
  archived_at = excluded.archived_at,
  updated_at = excluded.updated_at;

COMMIT;
