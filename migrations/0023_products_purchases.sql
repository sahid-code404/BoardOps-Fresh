-- Products / Purchases — canonical procurement catalog and immutable purchase evidence.
-- Purchases are institution-scoped, integer-money records. Each approved purchase
-- owns one linked Expense row; that Expense row is the single lifecycle authority
-- for delete/restore so procurement never creates a second mutable accounting state.
PRAGMA foreign_keys = ON;

CREATE TABLE units (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('WEIGHT','VOLUME','QUANTITY','OTHER')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (length(trim(name)) BETWEEN 1 AND 32),
  UNIQUE (institution_id, name)
);

CREATE INDEX units_institution_active_idx
  ON units(institution_id, is_active, category, name);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  category TEXT NOT NULL,
  default_unit_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  archived_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (default_unit_id) REFERENCES units(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (length(trim(name)) BETWEEN 2 AND 160),
  CHECK (length(trim(slug)) BETWEEN 2 AND 180),
  CHECK (length(trim(category)) BETWEEN 2 AND 64),
  CHECK ((is_active = 0 AND archived_at IS NOT NULL) OR (is_active = 1 AND archived_at IS NULL)),
  UNIQUE (institution_id, slug)
);

CREATE INDEX products_institution_active_idx
  ON products(institution_id, is_active, category, name);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  vendor TEXT NOT NULL,
  purchase_date TEXT NOT NULL,
  total_amount_minor INTEGER NOT NULL CHECK (total_amount_minor > 0),
  currency_code TEXT NOT NULL DEFAULT 'INR' CHECK (length(currency_code) = 3),
  item_count INTEGER NOT NULL CHECK (item_count > 0 AND item_count <= 100),
  receipt_url TEXT,
  notes TEXT,
  expense_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (length(trim(vendor)) BETWEEN 2 AND 200),
  CHECK (length(purchase_date) = 10),
  CHECK (receipt_url IS NULL OR length(receipt_url) <= 2000),
  CHECK (notes IS NULL OR length(notes) <= 4000)
);

CREATE UNIQUE INDEX purchases_idempotency_idx
  ON purchases(institution_id, created_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX purchases_institution_date_idx
  ON purchases(institution_id, purchase_date DESC, created_at DESC);
CREATE INDEX purchases_expense_idx
  ON purchases(institution_id, expense_id);

CREATE TABLE purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  institution_id TEXT NOT NULL,
  product_id TEXT,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit TEXT NOT NULL,
  rate_minor INTEGER NOT NULL CHECK (rate_minor > 0),
  total_minor INTEGER NOT NULL CHECK (total_minor > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CHECK (length(trim(product_name)) BETWEEN 2 AND 160),
  CHECK (length(trim(category)) BETWEEN 2 AND 64),
  CHECK (length(trim(unit)) BETWEEN 1 AND 32)
);

CREATE INDEX purchase_items_purchase_idx
  ON purchase_items(purchase_id, id);
CREATE INDEX purchase_items_product_idx
  ON purchase_items(institution_id, product_id)
  WHERE product_id IS NOT NULL;
CREATE INDEX purchase_items_category_idx
  ON purchase_items(institution_id, category, purchase_id);

CREATE TRIGGER purchases_integer_money_insert
BEFORE INSERT ON purchases
WHEN typeof(NEW.total_amount_minor) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'purchases.total_amount_minor must be integer minor units');
END;

CREATE TRIGGER purchase_items_integer_money_insert
BEFORE INSERT ON purchase_items
WHEN typeof(NEW.quantity_milli) <> 'integer'
  OR typeof(NEW.rate_minor) <> 'integer'
  OR typeof(NEW.total_minor) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'purchase items require integer scaled quantity and minor-unit money');
END;

CREATE TRIGGER purchases_require_matching_expense
BEFORE INSERT ON purchases
WHEN NOT EXISTS (
  SELECT 1
  FROM expenses e
  WHERE e.id = NEW.expense_id
    AND e.institution_id = NEW.institution_id
    AND e.status = 'APPROVED'
    AND e.purged_at IS NULL
    AND e.category = 'PURCHASE'
    AND e.amount_minor = NEW.total_amount_minor
    AND e.currency_code = NEW.currency_code
    AND COALESCE(e.paid_to, '') = NEW.vendor
    AND substr(e.expense_date, 1, 10) = NEW.purchase_date
)
BEGIN
  SELECT RAISE(ABORT, 'purchase must reference matching approved expense evidence');
END;

CREATE TRIGGER purchases_content_immutable
BEFORE UPDATE ON purchases
BEGIN
  SELECT RAISE(ABORT, 'purchase evidence is immutable');
END;

CREATE TRIGGER purchases_block_hard_delete
BEFORE DELETE ON purchases
BEGIN
  SELECT RAISE(ABORT, 'purchase evidence cannot be hard-deleted');
END;

CREATE TRIGGER purchase_items_block_update
BEFORE UPDATE ON purchase_items
BEGIN
  SELECT RAISE(ABORT, 'purchase item evidence is immutable');
END;

CREATE TRIGGER purchase_items_block_delete
BEFORE DELETE ON purchase_items
BEGIN
  SELECT RAISE(ABORT, 'purchase item evidence cannot be hard-deleted');
END;

CREATE TRIGGER purchase_items_scope_guard
BEFORE INSERT ON purchase_items
WHEN NOT EXISTS (
  SELECT 1 FROM purchases p
  WHERE p.id = NEW.purchase_id AND p.institution_id = NEW.institution_id
)
OR (
  NEW.product_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM products pr
    WHERE pr.id = NEW.product_id AND pr.institution_id = NEW.institution_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'purchase item must remain institution-scoped');
END;

CREATE TRIGGER purchase_items_count_guard
BEFORE INSERT ON purchase_items
WHEN (
  SELECT COUNT(*) FROM purchase_items WHERE purchase_id = NEW.purchase_id
) >= (
  SELECT item_count FROM purchases WHERE id = NEW.purchase_id
)
BEGIN
  SELECT RAISE(ABORT, 'purchase already has its declared item count');
END;

CREATE TRIGGER purchase_items_total_guard
AFTER INSERT ON purchase_items
WHEN (
  SELECT COUNT(*) FROM purchase_items WHERE purchase_id = NEW.purchase_id
) = (
  SELECT item_count FROM purchases WHERE id = NEW.purchase_id
)
AND (
  SELECT COALESCE(SUM(total_minor), 0) FROM purchase_items WHERE purchase_id = NEW.purchase_id
) <> (
  SELECT total_amount_minor FROM purchases WHERE id = NEW.purchase_id
)
BEGIN
  SELECT RAISE(ABORT, 'purchase item totals must equal purchase total');
END;

CREATE TRIGGER products_block_delete
BEFORE DELETE ON products
BEGIN
  SELECT RAISE(ABORT, 'products must be archived, not deleted');
END;

CREATE TRIGGER units_block_delete
BEFORE DELETE ON units
BEGIN
  SELECT RAISE(ABORT, 'units must be deactivated, not deleted');
END;

INSERT INTO permissions (id, permission_key, feature, action, description) VALUES
  ('perm_products_read', 'products.read', 'products', 'read', 'Read product and unit catalog'),
  ('perm_products_write', 'products.write', 'products', 'write', 'Create, update and archive product/unit catalog'),
  ('perm_purchases_read', 'purchases.read', 'purchases', 'read', 'Read institution purchase evidence'),
  ('perm_purchases_create', 'purchases.create', 'purchases', 'create', 'Create an immutable purchase and linked expense'),
  ('perm_purchases_delete', 'purchases.delete', 'purchases', 'delete', 'Schedule linked purchase expense for deletion'),
  ('perm_purchases_restore', 'purchases.restore', 'purchases', 'restore', 'Restore linked purchase expense from recovery queue');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'products.read','products.write','purchases.read','purchases.create','purchases.delete','purchases.restore'
)
WHERE r.role_key IN ('ADMIN', 'SUPER_ADMIN');

CREATE TRIGGER roles_bootstrap_products_purchases_admin
AFTER INSERT ON roles
WHEN NEW.role_key IN ('ADMIN', 'SUPER_ADMIN')
BEGIN
  INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT NEW.id, p.id
  FROM permissions p
  WHERE p.permission_key IN (
    'products.read','products.write','purchases.read','purchases.create','purchases.delete','purchases.restore'
  );
END;
