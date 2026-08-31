from pathlib import Path
import re

ROOT = Path('.')


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text)


def replace_exact(path: str, old: str, new: str, count: int = 1) -> None:
    text = read(path)
    actual = text.count(old)
    if actual < count:
        raise SystemExit(f'{path}: expected at least {count} occurrence(s), found {actual}: {old[:100]!r}')
    text = text.replace(old, new, count)
    write(path, text)


def replace_all(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise SystemExit(f'{path}: missing expected fragment: {old[:100]!r}')
    write(path, text.replace(old, new))


def regex_once(path: str, pattern: str, repl: str, flags: int = 0) -> None:
    text = read(path)
    updated, n = re.subn(pattern, repl, text, count=1, flags=flags)
    if n != 1:
        raise SystemExit(f'{path}: regex expected 1 match, got {n}: {pattern[:120]!r}')
    write(path, updated)


# -----------------------------------------------------------------------------
# 2. Meal Counts — explicit Approve / Reject buttons instead of icon-only actions
# -----------------------------------------------------------------------------
replace_exact(
    'apps/web/src/components/features/kitchen/kitchen-view.tsx',
    '''                        <div className="flex flex-col gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => decideLeaveMutation.mutate({ id: l.id, status: "APPROVED" })}
                            disabled={isLoading}
                            aria-label="Approve leave"
                            className="grid place-items-center h-8 w-8 rounded-xl bg-success/15 text-success hover:bg-success/25 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => decideLeaveMutation.mutate({ id: l.id, status: "REJECTED" })}
                            disabled={isLoading}
                            aria-label="Reject leave"
                            className="grid place-items-center h-8 w-8 rounded-xl bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors disabled:opacity-50"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        </div>''',
    '''                        <div className="flex flex-col sm:flex-row gap-1.5 shrink-0">
                          <GlassButton
                            type="button"
                            size="sm"
                            variant="success"
                            onClick={() => decideLeaveMutation.mutate({ id: l.id, status: "APPROVED" })}
                            disabled={isLoading}
                            aria-label="Approve leave"
                            className="!h-8 !px-3"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Approve
                          </GlassButton>
                          <GlassButton
                            type="button"
                            size="sm"
                            variant="danger"
                            onClick={() => decideLeaveMutation.mutate({ id: l.id, status: "REJECTED" })}
                            disabled={isLoading}
                            aria-label="Reject leave"
                            className="!h-8 !px-3"
                          >
                            <Ban className="h-3.5 w-3.5" />
                            Reject
                          </GlassButton>
                        </div>'''
)

# -----------------------------------------------------------------------------
# 3. Payments — refund eligibility, larger pending amount, immutable pending amount
# -----------------------------------------------------------------------------
refund_path = 'services/api/src/routes/refunds-adjustments.ts'
regex_once(
    refund_path,
    r'''\n  const timeZoneRow = await c\.env\.DB\.prepare\(`SELECT timezone FROM institutions WHERE id = \? LIMIT 1`\)[\s\S]*?  if \(Number\(currentBills\?\.count \?\? 0\) === 0\) return c\.json\(\{ success: true, data: \[\] \}\);\n''',
    '\n',
)
replace_exact(
    refund_path,
    '''    const credit = await availableCredit(c, principal.institutionId, resident.id);
    if (credit.availableMinor <= 0) continue;
    result.push({
      userId: resident.id,''',
    '''    const credit = await availableCredit(c, principal.institutionId, resident.id);
    if (credit.availableMinor <= 0) continue;
    const overpaid = await overpaidBill(c, principal.institutionId, resident.id, 1);
    if (!overpaid) continue;
    result.push({
      userId: resident.id,
      billId: overpaid.id,'''
)
replace_all(
    refund_path,
    '''  } else {
    billId = (await overpaidBill(c, principal.institutionId, userId, amountMinor))?.id ?? null;
  }

  const headerKey = c.req.header("Idempotency-Key")?.trim().slice(0, 200) || null;''',
    '''  } else {
    billId = (await overpaidBill(c, principal.institutionId, userId, amountMinor))?.id ?? null;
  }
  if (!billId) {
    return c.json({ success: false, error: "Refunds are available only for overpayment on a generated bill" }, 422);
  }

  const headerKey = c.req.header("Idempotency-Key")?.trim().slice(0, 200) || null;'''
)
replace_all(
    refund_path,
    '''  } else {
    billId = (await overpaidBill(c, principal.institutionId, userId, amountMinor))?.id ?? null;
  }

  const methodRaw = optionalText(body.method, 32);''',
    '''  } else {
    billId = (await overpaidBill(c, principal.institutionId, userId, amountMinor))?.id ?? null;
  }
  if (!billId) {
    return c.json({ success: false, error: "Refunds are available only for overpayment on a generated bill" }, 422);
  }

  const methodRaw = optionalText(body.method, 32);'''
)

payments_ui = 'apps/web/src/components/features/billing/payments-view.tsx'
replace_exact(
    payments_ui,
    '''      {/* Pay Refund — admin only, centered glass card button */}
      {isAdmin && (''',
    '''      {/* Pay Refund — only after generated-bill overpayment exists */}
      {isAdmin && refundCreditUsers.length > 0 && ('''
)
replace_exact(
    payments_ui,
    '''        <p className="font-bold tabular-nums">{formatINR(payment.amount)}</p>''',
    '''        <p className="text-lg font-bold tabular-nums">{formatINR(payment.amount)}</p>'''
)
replace_exact(
    payments_ui,
    '''  const amountLocked = payment?.status === "APPROVED" && !!payment?.billId;''',
    '''  const amountLocked = payment?.status === "PENDING" || payment?.status === "APPROVED";'''
)
replace_exact(
    payments_ui,
    '''            amountLocked
              ? "Amount locked — this approved payment is linked to a bill. Void it and submit a new payment to change the amount."
              : undefined''',
    '''            amountLocked
              ? "Amount locked — submitted payment amounts are immutable. Reject or void this payment and submit a replacement to change the amount."
              : undefined'''
)
replace_exact(
    payments_ui,
    '''              <p className="text-[11px]">Refunds are only available after bill generation for the current month.</p>''',
    '''              <p className="text-[11px]">Refunds appear only after a generated bill has a real overpayment and remain available until that overpayment is settled.</p>'''
)

# -----------------------------------------------------------------------------
# 4. User management — KPI semantics, last-admin UX, resident-only 360 finance
# -----------------------------------------------------------------------------
users_ui = 'apps/web/src/components/features/users/users-view.tsx'
replace_exact(
    users_ui,
    '''    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["users", { search, status }], ctx.prev);
      toast.error("Action failed");
    },''',
    '''    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["users", { search, status }], ctx.prev);
      toast.error(e.message || "Action failed");
    },'''
)
replace_exact(
    users_ui,
    '''  const kpis = useMemo(() => {
    // Total Users includes everyone (admins + residents, excluding deleted)
    const total = users.filter((u) => !u.deletedAt).length;
    // Active/Pending/Suspended exclude admins — these are resident-facing metrics
    const residents = users.filter((u) => u.role !== "ADMIN" && u.role !== "SUPER_ADMIN");
    const active = residents.filter((u) => u.status === "ACTIVE" && !u.deletedAt).length;
    const pending = residents.filter((u) => u.status === "PENDING").length;
    const suspended = residents.filter((u) => u.status === "SUSPENDED").length;
    const inQueue = residents.filter((u) => u.deletedAt).length;
    return { total, active, pending, suspended, inQueue };
  }, [users]);''',
    '''  const kpis = useMemo(() => {
    // Total Users means accepted resident accounts only: administrators and
    // pending registrations are deliberately excluded from the membership KPI.
    const residents = users.filter((u) => u.role !== "ADMIN" && u.role !== "SUPER_ADMIN");
    const total = residents.filter((u) => u.status !== "PENDING" && !u.deletedAt).length;
    const active = residents.filter((u) => u.status === "ACTIVE" && !u.deletedAt).length;
    const pending = residents.filter((u) => u.status === "PENDING" && !u.deletedAt).length;
    const suspended = residents.filter((u) => u.status === "SUSPENDED" && !u.deletedAt).length;
    const inQueue = residents.filter((u) => u.deletedAt).length;
    return { total, active, pending, suspended, inQueue };
  }, [users]);

  const activeAdminCount = useMemo(
    () => users.filter(
      (u) => (u.role === "ADMIN" || u.role === "SUPER_ADMIN") && u.status === "ACTIVE" && !u.deletedAt,
    ).length,
    [users],
  );
  const wouldRemoveLastAdmin = !!assignRole
    && (assignRole.role === "ADMIN" || assignRole.role === "SUPER_ADMIN")
    && newRole !== "ADMIN"
    && newRole !== "SUPER_ADMIN"
    && activeAdminCount <= 1;'''
)
replace_exact(
    users_ui,
    '''  const submitAssignRole = useCallback(() => {
    if (!assignRole) return;
    actionMutation.mutate({''',
    '''  const submitAssignRole = useCallback(() => {
    if (!assignRole) return;
    if (wouldRemoveLastAdmin) {
      toast.error("Assign another active administrator before changing the last administrator's role");
      return;
    }
    actionMutation.mutate({'''
)
replace_exact(
    users_ui,
    '''  }, [assignRole, newRole, assignReason, actionMutation]);''',
    '''  }, [assignRole, newRole, assignReason, actionMutation, wouldRemoveLastAdmin]);'''
)
replace_exact(
    users_ui,
    '''            <GlassTextarea
              label="Reason (optional)"
              rows={2}
              placeholder="Why is this role being assigned?"
              value={assignReason}
              onChange={(e) => setAssignReason(e.target.value)}
            />''',
    '''            {newRole === "ADMIN" && assignRole?.role === "USER" && (
              <div className="glass-soft rounded-2xl p-3 border border-warning/25">
                <p className="text-xs font-medium text-warning">Administrator finance exclusion</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Administrators do not have a resident Fund Account or Resident 360° finance view. Existing resident financial history remains preserved, but it is excluded while the account has an administrator role.
                </p>
              </div>
            )}
            {wouldRemoveLastAdmin && (
              <div className="glass-soft rounded-2xl p-3 border border-destructive/25">
                <p className="text-xs font-medium text-destructive">Last administrator cannot be demoted</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Assign another active administrator first, then change this role.
                </p>
              </div>
            )}
            <GlassTextarea
              label="Reason (optional)"
              rows={2}
              placeholder="Why is this role being assigned?"
              value={assignReason}
              onChange={(e) => setAssignReason(e.target.value)}
            />'''
)
replace_exact(
    users_ui,
    '''            <GlassButton variant="primary" size="md" onClick={submitAssignRole} loading={actionMutation.isPending}>''',
    '''            <GlassButton variant="primary" size="md" onClick={submitAssignRole} loading={actionMutation.isPending} disabled={wouldRemoveLastAdmin}>'''
)
replace_exact(
    users_ui,
    '''            {onView360 && (''',
    '''            {onView360 && user.role === "USER" && ('''
)

replace_exact(
    'services/api/src/routes/user-360.ts',
    '''  if (!user) return c.json({ success: false, error: "User not found" }, 404);

  const current = currentPeriodInTimeZone(user.institution_timezone || "UTC");''',
    '''  if (!user) return c.json({ success: false, error: "User not found" }, 404);
  if (user.role !== "USER") {
    return c.json({
      success: false,
      error: "Resident 360° finance is available only for resident accounts; administrators do not have a Fund Account",
    }, 422);
  }

  const current = currentPeriodInTimeZone(user.institution_timezone || "UTC");'''
)

# -----------------------------------------------------------------------------
# 6. Expenses — no hidden quantity default, proof upload, edit reason mandatory
# -----------------------------------------------------------------------------
migration = ROOT / 'migrations/0027_admin_workflow_rules.sql'
if migration.exists():
    raise SystemExit('migrations/0027_admin_workflow_rules.sql already exists')
migration.write_text('''-- Admin workflow refinements: meal pricing/deletion queue + expense proof evidence.\nPRAGMA foreign_keys = ON;\n\nALTER TABLE meal_configurations ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'FORMULA'\n  CHECK (pricing_mode IN ('FORMULA', 'FIXED'));\nALTER TABLE meal_configurations ADD COLUMN fixed_price_minor INTEGER\n  CHECK (fixed_price_minor IS NULL OR fixed_price_minor > 0);\nALTER TABLE meal_configurations ADD COLUMN deletion_requested_at TEXT;\nALTER TABLE meal_configurations ADD COLUMN deletion_eligible_month INTEGER\n  CHECK (deletion_eligible_month IS NULL OR deletion_eligible_month BETWEEN 0 AND 11);\nALTER TABLE meal_configurations ADD COLUMN deletion_eligible_year INTEGER\n  CHECK (deletion_eligible_year IS NULL OR deletion_eligible_year >= 2000);\nALTER TABLE meal_configurations ADD COLUMN deletion_requested_by TEXT;\nALTER TABLE meal_configurations ADD COLUMN deletion_finalized_at TEXT;\n\nCREATE INDEX meal_configurations_deletion_queue_idx\n  ON meal_configurations(institution_id, deletion_finalized_at, deletion_eligible_year, deletion_eligible_month)\n  WHERE deletion_requested_at IS NOT NULL;\n\nCREATE TABLE expense_proofs (\n  id TEXT PRIMARY KEY,\n  institution_id TEXT NOT NULL,\n  expense_id TEXT NOT NULL,\n  object_key TEXT NOT NULL,\n  original_name TEXT NOT NULL,\n  content_type TEXT NOT NULL,\n  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),\n  uploaded_by TEXT NOT NULL,\n  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,\n  FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE RESTRICT,\n  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT,\n  UNIQUE (institution_id, expense_id)\n);\n\nCREATE INDEX expense_proofs_institution_expense_idx\n  ON expense_proofs(institution_id, expense_id);\n''')

expenses_api = 'services/api/src/routes/expenses.ts'
replace_exact(
    expenses_api,
    '''type ExpenseWithCreatorRow = ExpenseRow & {
  creator_name: string | null;
};''',
    '''type ExpenseWithCreatorRow = ExpenseRow & {
  creator_name: string | null;
  has_proof: number;
};

type ExpenseProofRow = {
  id: string;
  institution_id: string;
  expense_id: string;
  object_key: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
};'''
)
replace_exact(
    expenses_api,
    '''  const quantity = typeof body.quantity === "number" ? body.quantity : 1;''',
    '''  const quantity = typeof body.quantity === "number" ? body.quantity : Number.NaN;'''
)
replace_exact(
    expenses_api,
    '''    user: row.creator_name ? { name: row.creator_name } : null,
  };''',
    '''    user: row.creator_name ? { name: row.creator_name } : null,
    hasProof: row.has_proof === 1,
    proofUrl: row.has_proof === 1 ? `/api/expenses/${row.id}/proof` : null,
  };'''
)
replace_all(
    expenses_api,
    '''SELECT e.*, u.name AS creator_name
       FROM expenses e''',
    '''SELECT e.*, u.name AS creator_name,
            EXISTS(
              SELECT 1 FROM expense_proofs ep
               WHERE ep.institution_id = e.institution_id
                 AND (ep.expense_id = e.id OR ep.expense_id = e.replaces_expense_id)
            ) AS has_proof
       FROM expenses e'''
)
# Add proof resolver after idempotency loader.
replace_exact(
    expenses_api,
    '''async function audit(
  c: Context<AppEnv>,''',
    '''async function loadExpenseProof(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  expense: ExpenseWithCreatorRow,
): Promise<ExpenseProofRow | null> {
  return c.env.DB.prepare(
    `SELECT * FROM expense_proofs
      WHERE institution_id = ? AND expense_id IN (?, ?)
      ORDER BY CASE WHEN expense_id = ? THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1`,
  )
    .bind(principal.institutionId, expense.id, expense.replaces_expense_id ?? expense.id, expense.id)
    .first<ExpenseProofRow>();
}

async function audit(
  c: Context<AppEnv>,'''
)
# Replacement edits require an explicit reason and audit it.
replace_exact(
    expenses_api,
    '''  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const parsed = parseExpenseInput(body);''',
    '''  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const editReason = normalizeOptionalText(body.reason, 1000);
  if (!editReason || editReason.length < 5) {
    return c.json({ success: false, error: "A reason of at least 5 characters is required to edit an expense" }, 422);
  }
  const parsed = parseExpenseInput(body);''',
    count=1,
)
# The first occurrence above is POST, not PUT; undo by moving requirement to the PUT block if necessary.
text = read(expenses_api)
post_marker = 'expenseRoutes.post("/expenses", async (c) => {'
put_marker = 'expenseRoutes.put("/expenses/:id", async (c) => {'
post_idx = text.index(post_marker)
put_idx = text.index(put_marker)
required_fragment = '''  const editReason = normalizeOptionalText(body.reason, 1000);\n  if (!editReason || editReason.length < 5) {\n    return c.json({ success: false, error: "A reason of at least 5 characters is required to edit an expense" }, 422);\n  }\n'''
# If the exact replacement landed in POST, remove it there and insert after PUT's body read.
if post_idx < text.find(required_fragment) < put_idx:
    text = text.replace(required_fragment, '', 1)
    put_idx = text.index(put_marker)
    put_body = '''  const body = await readObjectBody(c);\n  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);\n'''
    loc = text.index(put_body, put_idx) + len(put_body)
    text = text[:loc] + required_fragment + text[loc:]
    write(expenses_api, text)
replace_exact(
    expenses_api,
    '''  await audit(c, principal, "EXPENSE_REPLACE", existing.id, null, {''',
    '''  await audit(c, principal, "EXPENSE_REPLACE", existing.id, editReason, {'''
)
# Proof upload/read endpoints are stored privately in R2 and never public.
replace_exact(
    expenses_api,
    '''expenseRoutes.delete("/expenses/:id", async (c) => {''',
    '''expenseRoutes.post("/expenses/:id/proof", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const expense = await loadExpense(c, principal, c.req.param("id"));
  if (!expense || expense.purged_at || expense.status === "DELETED") {
    return c.json({ success: false, error: "Expense not found" }, 404);
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ success: false, error: "Invalid expense proof upload" }, 400);
  }
  const proof = formData.get("proof");
  if (!(proof instanceof File)) return c.json({ success: false, error: "Choose a file or photo proof" }, 400);
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  if (!allowed.has(proof.type)) return c.json({ success: false, error: "Proof must be JPEG, PNG, WebP, or PDF" }, 415);
  if (proof.size <= 0 || proof.size > 8 * 1024 * 1024) {
    return c.json({ success: false, error: "Proof must be smaller than 8 MB" }, 413);
  }

  const previous = await loadExpenseProof(c, principal, expense);
  const key = `expense-proofs/${principal.institutionId}/${expense.id}/${crypto.randomUUID()}`;
  await c.env.FILES.put(key, await proof.arrayBuffer(), {
    httpMetadata: { contentType: proof.type, cacheControl: "private, max-age=300" },
  });
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO expense_proofs
      (id, institution_id, expense_id, object_key, original_name, content_type,
       size_bytes, uploaded_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(institution_id, expense_id) DO UPDATE SET
       object_key = excluded.object_key,
       original_name = excluded.original_name,
       content_type = excluded.content_type,
       size_bytes = excluded.size_bytes,
       uploaded_by = excluded.uploaded_by,
       updated_at = excluded.updated_at`,
  ).bind(
    crypto.randomUUID(), principal.institutionId, expense.id, key,
    proof.name.slice(0, 240) || "expense-proof", proof.type, proof.size,
    principal.id, now, now,
  ).run();
  if (previous && previous.expense_id === expense.id && previous.object_key !== key) {
    await c.env.FILES.delete(previous.object_key);
  }
  await audit(c, principal, "EXPENSE_PROOF_UPSERT", expense.id, null, {
    objectKey: key,
    contentType: proof.type,
    size: proof.size,
  });
  return c.json({ success: true, data: { hasProof: true, proofUrl: `/api/expenses/${expense.id}/proof` } });
});

expenseRoutes.get("/expenses/:id/proof", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const expense = await loadExpense(c, principal, c.req.param("id"));
  if (!expense || expense.purged_at || (principal.role === "USER" && expense.status !== "APPROVED")) {
    return c.json({ success: false, error: "Expense not found" }, 404);
  }
  const proof = await loadExpenseProof(c, principal, expense);
  if (!proof) return c.json({ success: false, error: "Expense proof not found" }, 404);
  const object = await c.env.FILES.get(proof.object_key);
  if (!object) return c.json({ success: false, error: "Expense proof object is unavailable" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("Content-Disposition", `inline; filename="${proof.original_name.replace(/["\\r\\n]/gu, "_")}"`);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
});

expenseRoutes.delete("/expenses/:id", async (c) => {'''
)

# RBAC proof endpoints.
rbac = 'services/api/src/middleware/rbac.ts'
replace_exact(
    rbac,
    '''  if (method === "GET" && /^\\/api\\/expenses\\/[^/]+$/u.test(path)) {
    return PERMISSIONS.EXPENSES_READ;
  }''',
    '''  if (method === "GET" && /^\\/api\\/expenses\\/[^/]+\\/proof$/u.test(path)) {
    return PERMISSIONS.EXPENSES_READ;
  }
  if (method === "POST" && /^\\/api\\/expenses\\/[^/]+\\/proof$/u.test(path)) {
    return PERMISSIONS.EXPENSES_REPLACE;
  }
  if (method === "GET" && /^\\/api\\/expenses\\/[^/]+$/u.test(path)) {
    return PERMISSIONS.EXPENSES_READ;
  }'''
)

# Readiness + backup include the new institution-owned proof table.
replace_exact(
    'services/api/src/index.ts',
    '''  "expenses",
  "units",''',
    '''  "expenses",
  "expense_proofs",
  "units",'''
)
replace_exact(
    'services/api/src/system/backup.ts',
    '''  { name: "expenses", scope: "institution-column" },
  { name: "refund_transactions", scope: "institution-column" },''',
    '''  { name: "expenses", scope: "institution-column" },
  { name: "expense_proofs", scope: "institution-column" },
  { name: "refund_transactions", scope: "institution-column" },'''
)

# Expense UI upload + mandatory edit reason.
expenses_ui = 'apps/web/src/components/features/billing/expenses-view.tsx'
replace_exact(
    expenses_ui,
    '''  Clock,
} from "lucide-react";''',
    '''  Clock,
  Paperclip,
} from "lucide-react";'''
)
replace_exact(
    expenses_ui,
    '''  user: { name: string } | null;
};''',
    '''  user: { name: string } | null;
  hasProof?: boolean;
  proofUrl?: string | null;
};'''
)
replace_exact(
    expenses_ui,
    '''  description?: string;
  expenseDate: string;
};''',
    '''  description?: string;
  expenseDate: string;
  reason?: string;
};'''
)
replace_exact(
    expenses_ui,
    '''  const addMutation = useMutation({
    mutationFn: (payload: ExpensePayload) =>
      api.post<ApiResponse<Expense>>("/expenses", payload),''',
    '''  const addMutation = useMutation({
    mutationFn: async ({ payload, proof }: { payload: ExpensePayload; proof?: File | null }) => {
      const created = await api.post<ApiResponse<Expense>>("/expenses", payload);
      if (proof) {
        const form = new FormData();
        form.set("proof", proof);
        await api.postForm(`/expenses/${created.data.id}/proof`, form);
      }
      return created;
    },'''
)
replace_exact(
    expenses_ui,
    '''  const editMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ExpensePayload }) =>
      api.put<ApiResponse<Expense>>(`/expenses/${id}`, payload),''',
    '''  const editMutation = useMutation({
    mutationFn: async ({ id, payload, proof }: { id: string; payload: ExpensePayload; proof?: File | null }) => {
      const updated = await api.put<ApiResponse<Expense>>(`/expenses/${id}`, payload);
      if (proof) {
        const form = new FormData();
        form.set("proof", proof);
        await api.postForm(`/expenses/${updated.data.id}/proof`, form);
      }
      return updated;
    },'''
)
replace_exact(
    expenses_ui,
    '''  const handleSubmit = useCallback((payload: ExpensePayload, id?: string) => {
    if (id) {
      editMutation.mutate({ id, payload });
    } else {
      addMutation.mutate(payload);
    }
  }, [addMutation, editMutation]);''',
    '''  const handleSubmit = useCallback((payload: ExpensePayload, id?: string, proof?: File | null) => {
    if (id) {
      editMutation.mutate({ id, payload, proof });
    } else {
      addMutation.mutate({ payload, proof });
    }
  }, [addMutation, editMutation]);'''
)
# Proof badge in row transaction strip.
replace_exact(
    expenses_ui,
    '''                <div className="flex items-baseline gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Cost</span>
                  <span className="text-base font-bold tabular-nums">{formatINR(expense.amount)}</span>
                </div>''',
    '''                <div className="flex items-baseline gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Cost</span>
                  <span className="text-base font-bold tabular-nums">{formatINR(expense.amount)}</span>
                </div>
                {expense.hasProof && (
                  <a
                    href={`/api/expenses/${expense.id}/proof`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    <Paperclip className="h-3 w-3" /> Proof
                  </a>
                )}'''
)
# Form callback signatures.
replace_all(
    expenses_ui,
    '''  onSubmit: (payload: ExpensePayload, id?: string) => void;''',
    '''  onSubmit: (payload: ExpensePayload, id?: string, proof?: File | null) => void;'''
)
# State + validation + payload.
replace_exact(
    expenses_ui,
    '''  const [description, setDescription] = useState(expense?.description ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});''',
    '''  const [description, setDescription] = useState(expense?.description ?? "");
  const [editReason, setEditReason] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});'''
)
replace_exact(
    expenses_ui,
    '''    const qty = quantity ? parseFloat(quantity) : 0;
    if (quantity && (!qty || qty <= 0)) next.quantity = "Enter a valid quantity";''',
    '''    const qty = quantity ? parseFloat(quantity) : 0;
    if (!quantity || !qty || qty <= 0) next.quantity = "Quantity is required";
    if (isEdit && editReason.trim().length < 5) next.editReason = "Reason is required (min 5 characters)";'''
)
replace_exact(
    expenses_ui,
    '''        description: description.trim() || undefined,
      },
      isEdit ? expense!.id : undefined
    );''',
    '''        description: description.trim() || undefined,
        reason: isEdit ? editReason.trim() : undefined,
      },
      isEdit ? expense!.id : undefined,
      proof
    );'''
)
# Insert proof picker and edit reason before Notes.
replace_exact(
    expenses_ui,
    '''        <GlassTextarea
          label="Notes (optional)"''',
    '''        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground ml-1">
            File / photo proof (optional)
          </label>
          <label className="flex items-center gap-2 h-11 px-3 rounded-2xl glass-soft cursor-pointer hover:ring-1 hover:ring-primary/30">
            <Paperclip className="h-4 w-4 text-primary" />
            <span className="text-sm truncate flex-1">{proof?.name || (expense?.hasProof ? "Replace existing proof" : "Choose JPEG, PNG, WebP or PDF")}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="sr-only"
              onChange={(e) => setProof(e.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-[10px] text-muted-foreground ml-1">Maximum 8 MB. Stored privately.</p>
        </div>

        {isEdit && (
          <GlassTextarea
            label="Reason for edit (required)"
            placeholder="Why is this expense being corrected?"
            value={editReason}
            onChange={(e) => setEditReason(e.target.value)}
            error={errors.editReason}
            rows={2}
          />
        )}

        <GlassTextarea
          label="Notes (optional)"'''
)

# User-visible procurement wording removed; legacy schema remains only as historical data.
replace_exact(
    'apps/web/src/components/layout/nav-config.ts',
    '''  expenses: "Expenses & Procurement",''',
    '''  expenses: "Expenses",'''
)

# Runtime tests: replacement edits now require a reason, and refund copy no longer mentions current month.
replace_exact(
    'tests/runtime-e2e/expenses.spec.ts',
    '''        description: "Replacement accounting proof",
      }),''',
    '''        description: "Replacement accounting proof",
        reason: "Correcting the runtime expense amount",
      }),'''
)
replace_exact(
    'tests/runtime-e2e/payments.spec.ts',
    '''  expect(result.refundCandidates.body).toMatchObject({ success: true });
  expect(Array.isArray(result.refundCandidates.body.data)).toBe(true);''',
    '''  expect(result.refundCandidates.body).toMatchObject({ success: true });
  expect(Array.isArray(result.refundCandidates.body.data)).toBe(true);
  expect(result.refundCandidates.body.data.every((row: { billId?: string }) => typeof row.billId === "string" && row.billId.length > 0)).toBe(true);'''
)

print('batch1 transformations applied')
