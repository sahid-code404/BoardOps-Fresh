from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str, flags: int = 0) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{path}: regex expected one match, found {count}: {pattern[:120]!r}")
    write(path, updated)


# ---------------------------------------------------------------------------
# 2. Meal Counts — explicit Approve / Reject controls for pending leave.
# ---------------------------------------------------------------------------
KITCHEN = "apps/web/src/components/features/kitchen/kitchen-view.tsx"
replace_once(
    KITCHEN,
    '''                    <div className="flex flex-col gap-1.5 shrink-0">\n                      <button\n                        onClick={() => decideLeaveMutation.mutate({ id: leave.id, status: "APPROVED" })}\n                        disabled={leaveActionLoadingId === leave.id}\n                        aria-label="Approve leave"\n                        className="grid place-items-center h-8 w-8 rounded-xl bg-success/15 text-success hover:bg-success/25 transition-colors disabled:opacity-50"\n                      >\n                        <CheckCircle2 className="h-4 w-4" />\n                      </button>\n                      <button\n                        onClick={() => decideLeaveMutation.mutate({ id: leave.id, status: "REJECTED" })}\n                        disabled={leaveActionLoadingId === leave.id}\n                        aria-label="Reject leave"\n                        className="grid place-items-center h-8 w-8 rounded-xl bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors disabled:opacity-50"\n                      >\n                        <Ban className="h-4 w-4" />\n                      </button>\n                    </div>''',
    '''                    <div className="flex flex-col sm:flex-row gap-1.5 shrink-0">\n                      <GlassButton\n                        size="sm"\n                        variant="success"\n                        onClick={() => decideLeaveMutation.mutate({ id: leave.id, status: "APPROVED" })}\n                        disabled={leaveActionLoadingId === leave.id}\n                        className="!h-8 !px-3"\n                      >\n                        <CheckCircle2 className="h-3.5 w-3.5" />\n                        Approve\n                      </GlassButton>\n                      <GlassButton\n                        size="sm"\n                        variant="danger"\n                        onClick={() => decideLeaveMutation.mutate({ id: leave.id, status: "REJECTED" })}\n                        disabled={leaveActionLoadingId === leave.id}\n                        className="!h-8 !px-3"\n                      >\n                        <Ban className="h-3.5 w-3.5" />\n                        Reject\n                      </GlassButton>\n                    </div>''',
)

# ---------------------------------------------------------------------------
# 3. Payments — real generated-bill overpayment eligibility, immutable pending
# amounts, larger pending amount, and refund amount derived/read-only.
# ---------------------------------------------------------------------------
REFUNDS = "services/api/src/routes/refunds-adjustments.ts"
regex_once(
    REFUNDS,
    r'''  const timeZoneRow = await c\.env\.DB\.prepare\(`SELECT timezone FROM institutions WHERE id = \? LIMIT 1`\)[\s\S]*?  if \(Number\(currentBills\?\.count \?\? 0\) === 0\) return c\.json\(\{ success: true, data: \[\] \}\);\n\n  const residents = await c\.env\.DB\.prepare\(''',
    '''  const residents = await c.env.DB.prepare(''',
)
replace_once(
    REFUNDS,
    '''  const result = [];\n  for (const resident of residents.results) {\n    const credit = await availableCredit(c, principal.institutionId, resident.id);\n    if (credit.availableMinor <= 0) continue;\n    result.push({\n      userId: resident.id,\n      name: resident.name,\n      email: resident.email,\n      room: resident.room,\n      avatarUrl: resident.avatar_url,\n      creditAmount: minorToMajor(credit.availableMinor),\n      breakdown: {\n        totalApproved: minorToMajor(credit.totalApprovedMinor),\n        totalBilled: minorToMajor(credit.totalBilledMinor),\n        totalRefunded: minorToMajor(credit.totalRefundedMinor),\n        reservedRefunds: minorToMajor(credit.reservedMinor),\n      },\n    });\n  }\n  result.sort((a, b) => b.creditAmount - a.creditAmount);''',
    '''  const result = [];\n  for (const resident of residents.results) {\n    // Refund eligibility is bill-specific. A generic deposit/credit balance is\n    // not enough: a completed generated bill must still be net-overpaid.\n    const overpaid = await c.env.DB.prepare(\n      `SELECT b.id, b.period_month, b.period_year,\n              b.paid_amount_minor - b.total_amount_minor AS overpaid_minor\n         FROM bills b\n        WHERE b.institution_id = ? AND b.user_id = ?\n          AND b.deleted_on IS NULL AND b.purged_at IS NULL\n          AND b.generated_at IS NOT NULL\n          AND b.status IN ('GENERATED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')\n          AND b.paid_amount_minor > b.total_amount_minor\n          AND EXISTS (\n            SELECT 1 FROM billing_cycles bc\n             WHERE bc.institution_id = b.institution_id\n               AND bc.period_month = b.period_month\n               AND bc.period_year = b.period_year\n               AND bc.status = 'CLOSED'\n          )\n        ORDER BY (b.paid_amount_minor - b.total_amount_minor) DESC,\n                 b.period_year DESC, b.period_month DESC, b.created_at DESC\n        LIMIT 1`,\n    )\n      .bind(principal.institutionId, resident.id)\n      .first<{ id: string; period_month: number; period_year: number; overpaid_minor: number }>();\n    if (!overpaid || Number(overpaid.overpaid_minor) <= 0) continue;\n\n    const reserved = await c.env.DB.prepare(\n      `SELECT COALESCE(SUM(remaining_amount_minor), 0) AS total\n         FROM refunds\n        WHERE institution_id = ? AND user_id = ? AND bill_id = ?\n          AND status IN ('PENDING', 'PARTIALLY_PAID')`,\n    )\n      .bind(principal.institutionId, resident.id, overpaid.id)\n      .first<{ total: number }>();\n    const refundableMinor = Math.max(0, Number(overpaid.overpaid_minor) - Number(reserved?.total ?? 0));\n    if (refundableMinor <= 0) continue;\n\n    result.push({\n      userId: resident.id,\n      name: resident.name,\n      email: resident.email,\n      room: resident.room,\n      avatarUrl: resident.avatar_url,\n      billId: overpaid.id,\n      billPeriodMonth: overpaid.period_month,\n      billPeriodYear: overpaid.period_year,\n      creditAmount: minorToMajor(refundableMinor),\n    });\n  }\n  result.sort((a, b) => b.creditAmount - a.creditAmount);''',
)

PAYMENTS_API = "services/api/src/routes/payments.ts"
replace_once(
    PAYMENTS_API,
    '''  if (body.amount !== undefined) {\n    if (existing.status === "APPROVED") {\n      return c.json({\n        success: false,\n        error: "Approved payment amounts are immutable. Void the payment and submit a replacement instead.",\n      }, 422);\n    }''',
    '''  if (body.amount !== undefined) {\n    if (existing.status === "PENDING" || existing.status === "APPROVED") {\n      return c.json({\n        success: false,\n        error: "Pending and approved payment amounts are immutable. Reject or void the payment and submit a replacement instead.",\n      }, 422);\n    }''',
)

PAYMENTS_UI = "apps/web/src/components/features/billing/payments-view.tsx"
replace_once(
    PAYMENTS_UI,
    '''    room: string | null;\n    creditAmount: number;\n  }>>([]);''',
    '''    room: string | null;\n    billId: string;\n    billPeriodMonth: number;\n    billPeriodYear: number;\n    creditAmount: number;\n  }>>([]);''',
)
replace_once(
    PAYMENTS_UI,
    '''  const [refundTarget, setRefundTarget] = useState<{ userId: string; name: string; creditAmount: number } | null>(null);''',
    '''  const [refundTarget, setRefundTarget] = useState<{ userId: string; name: string; billId: string; creditAmount: number } | null>(null);''',
)
replace_once(
    PAYMENTS_UI,
    '''      await api.post("/payments/refund", {\n        userId: refundTarget.userId,\n        amount: parseFloat(refundAmount),\n        notes: refundNotes || undefined,\n      });''',
    '''      await api.post("/payments/refund", {\n        userId: refundTarget.userId,\n        billId: refundTarget.billId,\n        amount: refundTarget.creditAmount,\n        notes: refundNotes || undefined,\n      });''',
)
replace_once(
    PAYMENTS_UI,
    '''      {isAdmin && (\n        <StaggerItem>''',
    '''      {isAdmin && refundCreditUsers.length > 0 && (\n        <StaggerItem>''',
)
replace_once(
    PAYMENTS_UI,
    '''            onClick={isAdmin ? fetchRefundUsers : undefined}''',
    '''            onClick={isAdmin && refundCreditUsers.length > 0 ? fetchRefundUsers : undefined}''',
)
replace_once(
    PAYMENTS_UI,
    '''              <p>No users with refundable credit right now.</p>\n              <p className="text-[11px]">Refunds are only available after bill generation for the current month.</p>''',
    '''              <p>No generated bill has unsettled overpayment right now.</p>\n              <p className="text-[11px]">Refunds appear only after a billing cycle is completed and remain until the bill overpayment is settled.</p>''',
)
replace_once(
    PAYMENTS_UI,
    '''                    setRefundTarget({ userId: u.userId, name: u.name, creditAmount: u.creditAmount });''',
    '''                    setRefundTarget({ userId: u.userId, name: u.name, billId: u.billId, creditAmount: u.creditAmount });''',
)
replace_once(
    PAYMENTS_UI,
    '''                    <p className="text-[10px] text-muted-foreground">credit</p>''',
    '''                    <p className="text-[10px] text-muted-foreground">unsettled overpayment</p>''',
)
replace_once(
    PAYMENTS_UI,
    '''              Available credit: <span className="font-medium text-success">₹{Math.round(refundTarget?.creditAmount || 0).toLocaleString("en-IN")}</span>''',
    '''              Unsettled bill overpayment: <span className="font-medium text-success">₹{Math.round(refundTarget?.creditAmount || 0).toLocaleString("en-IN")}</span>''',
)
replace_once(
    PAYMENTS_UI,
    '''              onChange={(e) => setRefundAmount(e.target.value)}\n              icon={<IndianRupee className="h-4 w-4" />}''',
    '''              readOnly\n              hint="Derived from the generated bill and cannot be edited."\n              icon={<IndianRupee className="h-4 w-4" />}''',
)
replace_once(
    PAYMENTS_UI,
    '''        <p className="font-bold tabular-nums">{formatINR(payment.amount)}</p>''',
    '''        <p className="text-lg font-bold tabular-nums">{formatINR(payment.amount)}</p>''',
)
replace_once(
    PAYMENTS_UI,
    '''  // Cannot edit amount on APPROVED + bill-linked payments — backend will\n  // reject with 422. Lock the field and explain why; admin must void + resubmit.\n  const amountLocked = payment?.status === "APPROVED" && !!payment?.billId;''',
    '''  // Pending amounts are submission evidence and cannot be rewritten during\n  // approval. Approved amounts remain immutable as well.\n  const amountLocked = payment?.status === "PENDING" || payment?.status === "APPROVED";''',
)
replace_once(
    PAYMENTS_UI,
    '''            amountLocked\n              ? "Amount locked — this approved payment is linked to a bill. Void it and submit a new payment to change the amount."\n              : undefined''',
    '''            amountLocked\n              ? payment?.status === "PENDING"\n                ? "Pending amount is fixed. Reject the payment and submit a replacement to change it."\n                : "Approved amount is fixed. Void the payment and submit a replacement to change it."\n              : undefined''',
)

# ---------------------------------------------------------------------------
# 4. User Management — exclude pending members from Total Users, expose the
# existing last-admin invariant in the UI, and make Resident 360 resident-only.
# ---------------------------------------------------------------------------
USERS_UI = "apps/web/src/components/features/users/users-view.tsx"
replace_once(
    USERS_UI,
    '''  const kpis = useMemo(() => {\n    // Total Users includes everyone (admins + residents, excluding deleted)\n    const total = users.filter((u) => !u.deletedAt).length;''',
    '''  const kpis = useMemo(() => {\n    // Pending registrations are not institution members yet, regardless of the\n    // role requested/assigned during review.\n    const total = users.filter((u) => !u.deletedAt && u.status !== "PENDING" && u.status !== "ARCHIVED").length;''',
)
replace_once(
    USERS_UI,
    '''  }, [users]);\n\n  const filteredUsers = useMemo(() => {''',
    '''  }, [users]);\n\n  const activeAdminCount = useMemo(\n    () => users.filter(\n      (u) => !u.deletedAt && u.status === "ACTIVE" && (u.role === "ADMIN" || u.role === "SUPER_ADMIN"),\n    ).length,\n    [users],\n  );\n  const lastAdminRoleLocked = !!assignRole\n    && assignRole.status === "ACTIVE"\n    && (assignRole.role === "ADMIN" || assignRole.role === "SUPER_ADMIN")\n    && activeAdminCount <= 1;\n\n  const filteredUsers = useMemo(() => {''',
)
replace_once(
    USERS_UI,
    '''  const submitAssignRole = useCallback(() => {\n    if (!assignRole) return;\n    actionMutation.mutate({''',
    '''  const submitAssignRole = useCallback(() => {\n    if (!assignRole) return;\n    if (lastAdminRoleLocked && newRole !== "ADMIN" && newRole !== "SUPER_ADMIN") {\n      toast.error("Assign another active administrator before changing this admin role");\n      return;\n    }\n    actionMutation.mutate({''',
)
replace_once(
    USERS_UI,
    '''  }, [assignRole, newRole, assignReason, actionMutation]);''',
    '''  }, [assignRole, newRole, assignReason, actionMutation, lastAdminRoleLocked]);''',
)
replace_once(
    USERS_UI,
    '''          <KpiCard label="Total Users" value={kpis.total} icon={UsersIcon} color="primary" sub="All members" />''',
    '''          <KpiCard label="Total Users" value={kpis.total} icon={UsersIcon} color="primary" sub="Approved members" />''',
)
replace_once(
    USERS_UI,
    '''                    onView360={setView360Target}''',
    '''                    onView360={u.role === "USER" ? setView360Target : undefined}''',
)
replace_once(
    USERS_UI,
    '''              <Select value={newRole} onValueChange={(v) => setNewRole(v as Role)}>''',
    '''              <Select\n                value={newRole}\n                onValueChange={(v) => setNewRole(v as Role)}\n                disabled={lastAdminRoleLocked}\n              >''',
)
replace_once(
    USERS_UI,
    '''            <GlassTextarea\n              label="Reason (optional)"''',
    '''            {lastAdminRoleLocked && (\n              <div className="rounded-2xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning flex items-start gap-2">\n                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />\n                <span>This is the only active administrator. Assign another active admin before changing this role.</span>\n              </div>\n            )}\n            {newRole === "ADMIN" && assignRole?.role === "USER" && (\n              <div className="rounded-2xl border border-primary/25 bg-primary/8 p-3 text-xs text-muted-foreground">\n                Admins do not have resident fund accounts and are excluded from Resident 360 financial/meal domains. Existing resident financial history remains historical and is not converted into an admin balance.\n              </div>\n            )}\n            <GlassTextarea\n              label="Reason (optional)"''',
)
replace_once(
    USERS_UI,
    '''            <GlassButton variant="primary" size="md" onClick={submitAssignRole} loading={actionMutation.isPending}>''',
    '''            <GlassButton\n              variant="primary"\n              size="md"\n              onClick={submitAssignRole}\n              loading={actionMutation.isPending}\n              disabled={lastAdminRoleLocked && newRole !== "ADMIN" && newRole !== "SUPER_ADMIN"}\n            >''',
)

# ---------------------------------------------------------------------------
# 6. Expenses — Expenses-only active surface, proof upload in private R2,
# mandatory quantity, and mandatory edit reason.
# ---------------------------------------------------------------------------
EXPENSE_HUB = "apps/web/src/components/features/billing/expenses-hub-view.tsx"
write(
    EXPENSE_HUB,
    '''"use client";\n\nimport { ExpensesView } from "@/components/features/billing/expenses-view";\n\nexport function ExpensesHubView() {\n  return <ExpensesView />;\n}\n''',
)

NAV = "apps/web/src/components/layout/nav-config.ts"
replace_once(NAV, '  expenses: "Expenses & Procurement",', '  expenses: "Expenses",')

EXPENSE_MIGRATION = "migrations/0027_expense_proof_and_edit_reason.sql"
write(
    EXPENSE_MIGRATION,
    '''-- Expense proof metadata. Proof bytes live in the private FILES R2 bucket.\nPRAGMA foreign_keys = ON;\n\nALTER TABLE expenses ADD COLUMN proof_key TEXT;\nALTER TABLE expenses ADD COLUMN proof_name TEXT;\nALTER TABLE expenses ADD COLUMN proof_content_type TEXT;\nALTER TABLE expenses ADD COLUMN proof_size INTEGER\n  CHECK (proof_size IS NULL OR (typeof(proof_size) = 'integer' AND proof_size > 0));\n\nCREATE INDEX expenses_proof_idx\n  ON expenses(institution_id, proof_key)\n  WHERE proof_key IS NOT NULL;\n''',
)

EXPENSES_API = "services/api/src/routes/expenses.ts"
replace_once(
    EXPENSES_API,
    '''  updated_at: string;\n};''',
    '''  updated_at: string;\n  proof_key: string | null;\n  proof_name: string | null;\n  proof_content_type: string | null;\n  proof_size: number | null;\n};''',
)
replace_once(
    EXPENSES_API,
    '''export const expenseRoutes = new Hono<AppEnv>();''',
    '''const EXPENSE_PROOF_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);\nconst MAX_EXPENSE_PROOF_BYTES = 8 * 1024 * 1024;\n\nexport const expenseRoutes = new Hono<AppEnv>();''',
)
replace_once(
    EXPENSES_API,
    '''    user: row.creator_name ? { name: row.creator_name } : null,\n  };''',
    '''    user: row.creator_name ? { name: row.creator_name } : null,\n    proof: row.proof_key ? {\n      name: row.proof_name,\n      contentType: row.proof_content_type,\n      size: row.proof_size,\n      url: `/api/expenses/${row.id}/proof`,\n    } : null,\n  };''',
)
replace_once(
    EXPENSES_API,
    '''  const quantity = typeof body.quantity === "number" ? body.quantity : 1;''',
    '''  const quantity = typeof body.quantity === "number" ? body.quantity : Number.NaN;''',
)
replace_once(
    EXPENSES_API,
    '''  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return "Quantity must be positive";''',
    '''  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return "Quantity is required and must be positive";''',
)
replace_once(
    EXPENSES_API,
    '''  const parsed = parseExpenseInput(body);\n  if (typeof parsed === "string") return c.json({ success: false, error: parsed }, 422);\n\n  const institution = await institutionContext(c, principal.institutionId);\n  const oldPeriodError''',
    '''  const parsed = parseExpenseInput(body);\n  if (typeof parsed === "string") return c.json({ success: false, error: parsed }, 422);\n  const editReason = normalizeOptionalText(body.reason, 1000);\n  if (!editReason || editReason.length < 3) {\n    return c.json({ success: false, error: "Edit reason is required and must be at least 3 characters" }, 422);\n  }\n\n  const institution = await institutionContext(c, principal.institutionId);\n  const oldPeriodError''',
)
replace_once(
    EXPENSES_API,
    '''         status, replaces_expense_id, created_by, created_at, updated_at\n       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?, ?)`,''',
    '''         status, replaces_expense_id, created_by, proof_key, proof_name,\n         proof_content_type, proof_size, created_at, updated_at\n       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?, ?, ?, ?, ?, ?)`,''',
)
replace_once(
    EXPENSES_API,
    '''      parsed.description, parsed.expenseDate, parsed.paidTo, idempotencyKey,\n      existing.id, principal.id, now, now,\n    ),''',
    '''      parsed.description, parsed.expenseDate, parsed.paidTo, idempotencyKey,\n      existing.id, principal.id, existing.proof_key, existing.proof_name,\n      existing.proof_content_type, existing.proof_size, now, now,\n    ),''',
)
replace_once(
    EXPENSES_API,
    '''  await audit(c, principal, "EXPENSE_REPLACE", existing.id, null, {''',
    '''  await audit(c, principal, "EXPENSE_REPLACE", existing.id, editReason, {''',
)
# Add private proof upload/read routes before DELETE so GET /:id/proof and POST /:id/proof are canonical.
marker = '''expenseRoutes.delete("/expenses/:id", async (c) => {'''
proof_routes = '''expenseRoutes.post("/expenses/:id/proof", async (c) => {\n  const principal = await principalFor(c);\n  if (principal instanceof Response) return principal;\n  const existing = await loadExpense(c, principal, c.req.param("id"));\n  if (!existing || existing.purged_at) return c.json({ success: false, error: "Expense not found" }, 404);\n  if (existing.status !== "APPROVED") {\n    return c.json({ success: false, error: "Proof can only be attached to an active approved expense" }, 422);\n  }\n\n  let formData: FormData;\n  try {\n    formData = await c.req.formData();\n  } catch {\n    return c.json({ success: false, error: "Invalid expense proof upload" }, 400);\n  }\n  const proof = formData.get("proof");\n  if (!(proof instanceof File)) return c.json({ success: false, error: "Choose a proof file to upload" }, 400);\n  if (!EXPENSE_PROOF_TYPES.has(proof.type)) {\n    return c.json({ success: false, error: "Proof must be JPEG, PNG, WebP, or PDF" }, 415);\n  }\n  if (proof.size <= 0 || proof.size > MAX_EXPENSE_PROOF_BYTES) {\n    return c.json({ success: false, error: "Proof must be smaller than 8 MB" }, 413);\n  }\n\n  const now = new Date().toISOString();\n  const key = `expense-proofs/${principal.institutionId}/${existing.id}/${crypto.randomUUID()}`;\n  await c.env.FILES.put(key, await proof.arrayBuffer(), {\n    httpMetadata: { contentType: proof.type, cacheControl: "private, max-age=300" },\n  });\n  if (existing.proof_key && existing.proof_key !== key) {\n    await c.env.FILES.delete(existing.proof_key);\n  }\n  await c.env.DB.prepare(\n    `UPDATE expenses\n        SET proof_key = ?, proof_name = ?, proof_content_type = ?, proof_size = ?, updated_at = ?\n      WHERE id = ? AND institution_id = ?`,\n  )\n    .bind(key, proof.name.slice(0, 255), proof.type, proof.size, now, existing.id, principal.institutionId)\n    .run();\n  await audit(c, principal, "EXPENSE_PROOF_UPLOADED", existing.id, null, {\n    objectKey: key, contentType: proof.type, size: proof.size,\n  });\n  const updated = await loadExpense(c, principal, existing.id);\n  return c.json({ success: true, data: expenseResponse(updated!) });\n});\n\nexpenseRoutes.get("/expenses/:id/proof", async (c) => {\n  const principal = await principalFor(c);\n  if (principal instanceof Response) return principal;\n  const existing = await loadExpense(c, principal, c.req.param("id"));\n  if (!existing || existing.purged_at || !existing.proof_key) {\n    return c.json({ success: false, error: "Expense proof not found" }, 404);\n  }\n  const object = await c.env.FILES.get(existing.proof_key);\n  if (!object) return c.json({ success: false, error: "Expense proof not found" }, 404);\n  const headers = new Headers();\n  object.writeHttpMetadata(headers);\n  headers.set("Cache-Control", "private, max-age=300");\n  headers.set("Content-Disposition", `inline; filename="${(existing.proof_name || "expense-proof").replace(/[\\\"\\r\\n]/g, "_")}"`);\n  headers.set("X-Content-Type-Options", "nosniff");\n  return new Response(object.body, { headers });\n});\n\n'''
replace_once(EXPENSES_API, marker, proof_routes + marker)

RBAC = "services/api/src/middleware/rbac.ts"
replace_once(
    RBAC,
    '''  if (method === "PUT" && /^\\/api\\/expenses\\/[^/]+$/u.test(path)) {\n    return PERMISSIONS.EXPENSES_REPLACE;\n  }''',
    '''  if (method === "POST" && /^\\/api\\/expenses\\/[^/]+\\/proof$/u.test(path)) {\n    return PERMISSIONS.EXPENSES_REPLACE;\n  }\n  if (method === "GET" && /^\\/api\\/expenses\\/[^/]+\\/proof$/u.test(path)) {\n    return PERMISSIONS.EXPENSES_READ;\n  }\n  if (method === "PUT" && /^\\/api\\/expenses\\/[^/]+$/u.test(path)) {\n    return PERMISSIONS.EXPENSES_REPLACE;\n  }''',
)

EXPENSES_UI = "apps/web/src/components/features/billing/expenses-view.tsx"
replace_once(
    EXPENSES_UI,
    '''  Clock,\n} from "lucide-react";''',
    '''  Clock,\n  Paperclip,\n  ExternalLink,\n} from "lucide-react";''',
)
replace_once(
    EXPENSES_UI,
    '''  user: { name: string } | null;\n};''',
    '''  user: { name: string } | null;\n  proof: { name: string | null; contentType: string | null; size: number | null; url: string } | null;\n};''',
)
replace_once(
    EXPENSES_UI,
    '''  description?: string;\n  expenseDate: string;\n};''',
    '''  description?: string;\n  expenseDate: string;\n  reason?: string;\n};''',
)
# Mutations upload optional proof after the canonical expense/replacement write.
replace_once(
    EXPENSES_UI,
    '''  const addMutation = useMutation({\n    mutationFn: (payload: ExpensePayload) =>\n      api.post<ApiResponse<Expense>>("/expenses", payload),''',
    '''  const addMutation = useMutation({\n    mutationFn: async ({ payload, proof }: { payload: ExpensePayload; proof: File | null }) => {\n      const created = await api.post<ApiResponse<Expense>>("/expenses", payload);\n      if (proof) {\n        const form = new FormData();\n        form.append("proof", proof);\n        await api.postForm<ApiResponse<Expense>>(`/expenses/${created.data.id}/proof`, form);\n      }\n      return created;\n    },''',
)
replace_once(
    EXPENSES_UI,
    '''  const editMutation = useMutation({\n    mutationFn: ({ id, payload }: { id: string; payload: ExpensePayload }) =>\n      api.put<ApiResponse<Expense>>(`/expenses/${id}`, payload),''',
    '''  const editMutation = useMutation({\n    mutationFn: async ({ id, payload, proof }: { id: string; payload: ExpensePayload; proof: File | null }) => {\n      const updated = await api.put<ApiResponse<Expense>>(`/expenses/${id}`, payload);\n      if (proof) {\n        const form = new FormData();\n        form.append("proof", proof);\n        await api.postForm<ApiResponse<Expense>>(`/expenses/${updated.data.id}/proof`, form);\n      }\n      return updated;\n    },''',
)
replace_once(
    EXPENSES_UI,
    '''  const handleSubmit = useCallback((payload: ExpensePayload, id?: string) => {\n    if (id) {\n      editMutation.mutate({ id, payload });\n    } else {\n      addMutation.mutate(payload);\n    }\n  }, [addMutation, editMutation]);''',
    '''  const handleSubmit = useCallback((payload: ExpensePayload, id?: string, proof: File | null = null) => {\n    if (id) {\n      editMutation.mutate({ id, payload, proof });\n    } else {\n      addMutation.mutate({ payload, proof });\n    }\n  }, [addMutation, editMutation]);''',
)
replace_once(
    EXPENSES_UI,
    '''  onSubmit: (payload: ExpensePayload, id?: string) => void;''',
    '''  onSubmit: (payload: ExpensePayload, id?: string, proof?: File | null) => void;''',
)
# There are two identical onSubmit declarations (sheet + body); patch the second too.
replace_once(
    EXPENSES_UI,
    '''  onSubmit: (payload: ExpensePayload, id?: string) => void;''',
    '''  onSubmit: (payload: ExpensePayload, id?: string, proof?: File | null) => void;''',
)
replace_once(
    EXPENSES_UI,
    '''  const [description, setDescription] = useState(expense?.description ?? "");\n  const [errors, setErrors] = useState<Record<string, string>>({});''',
    '''  const [description, setDescription] = useState(expense?.description ?? "");\n  const [editReason, setEditReason] = useState("");\n  const [proofFile, setProofFile] = useState<File | null>(null);\n  const [errors, setErrors] = useState<Record<string, string>>({});''',
)
replace_once(
    EXPENSES_UI,
    '''    const qty = quantity ? parseFloat(quantity) : 0;\n    if (quantity && (!qty || qty <= 0)) next.quantity = "Enter a valid quantity";''',
    '''    const qty = quantity ? parseFloat(quantity) : 0;\n    if (!quantity || !qty || qty <= 0) next.quantity = "Quantity is required";\n    if (isEdit && editReason.trim().length < 3) next.editReason = "Edit reason is required (min 3 characters)";''',
)
replace_once(
    EXPENSES_UI,
    '''        quantity: qty || 0,\n        unit: finalUnit,\n        expenseDate: new Date(date).toISOString(),\n        description: description.trim() || undefined,\n      },\n      isEdit ? expense!.id : undefined\n    );''',
    '''        quantity: qty,\n        unit: finalUnit,\n        expenseDate: new Date(date).toISOString(),\n        description: description.trim() || undefined,\n        reason: isEdit ? editReason.trim() : undefined,\n      },\n      isEdit ? expense!.id : undefined,\n      proofFile,\n    );''',
)
replace_once(
    EXPENSES_UI,
    '''        <GlassTextarea\n          label="Notes (optional)"\n          placeholder="Add any notes about this expense…"\n          value={description}\n          onChange={(e) => setDescription(e.target.value)}\n          rows={3}\n        />''',
    '''        <div className="space-y-1.5">\n          <label className="text-xs font-medium text-muted-foreground ml-1">Proof (photo or PDF)</label>\n          <label className="flex items-center gap-2 rounded-2xl glass-soft px-3 py-3 cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all">\n            <Paperclip className="h-4 w-4 text-primary" />\n            <span className="text-sm truncate">{proofFile?.name || expense?.proof?.name || "Choose proof file"}</span>\n            <input\n              type="file"\n              className="sr-only"\n              accept="image/jpeg,image/png,image/webp,application/pdf"\n              onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}\n            />\n          </label>\n          <p className="text-[11px] text-muted-foreground ml-1">JPEG, PNG, WebP, or PDF · max 8 MB</p>\n        </div>\n\n        {isEdit && (\n          <GlassTextarea\n            label="Reason for edit"\n            placeholder="Why are you correcting this expense?"\n            value={editReason}\n            onChange={(e) => setEditReason(e.target.value)}\n            rows={2}\n            error={errors.editReason}\n          />\n        )}\n\n        <GlassTextarea\n          label="Notes (optional)"\n          placeholder="Add any notes about this expense…"\n          value={description}\n          onChange={(e) => setDescription(e.target.value)}\n          rows={3}\n        />''',
)
# Show proof link on each expense row.
replace_once(
    EXPENSES_UI,
    '''                {expense.description && (\n                  <span className="truncate max-w-[200px]">\n                    · {expense.description}\n                  </span>\n                )}\n              </div>''',
    '''                {expense.description && (\n                  <span className="truncate max-w-[200px]">\n                    · {expense.description}\n                  </span>\n                )}\n                {expense.proof && (\n                  <a\n                    href={expense.proof.url}\n                    target="_blank"\n                    rel="noreferrer"\n                    className="inline-flex items-center gap-1 text-primary hover:underline"\n                  >\n                    <Paperclip className="h-3 w-3" /> Proof <ExternalLink className="h-3 w-3" />\n                  </a>\n                )}\n              </div>''',
)

# ---------------------------------------------------------------------------
# Runtime checks updated for the new immutable/edit-reason behavior.
# ---------------------------------------------------------------------------
EXPENSE_TEST = "tests/runtime-e2e/expenses.spec.ts"
replace_once(
    EXPENSE_TEST,
    '''        description: "Replacement accounting proof",\n      }),''',
    '''        description: "Replacement accounting proof",\n        reason: "Correct runtime expense amount",\n      }),''',
)

PAYMENTS_TEST = "tests/runtime-e2e/payments.spec.ts"
replace_once(
    PAYMENTS_TEST,
    '''    const approved = await request("/api/payments/payment_arjun_pending_local", {''',
    '''    const pendingAmountEdit = await request("/api/payments/payment_arjun_pending_local", {\n      method: "PUT",\n      body: JSON.stringify({ action: "EDIT", amount: 2600 }),\n    });\n\n    const approved = await request("/api/payments/payment_arjun_pending_local", {''',
)
replace_once(
    PAYMENTS_TEST,
    '''      adminSubmitDenied,\n      approved,''',
    '''      adminSubmitDenied,\n      pendingAmountEdit,\n      approved,''',
)
replace_once(
    PAYMENTS_TEST,
    '''  expect(result.approved.status).toBe(200);''',
    '''  expect(result.pendingAmountEdit.status).toBe(422);\n  expect(String(result.pendingAmountEdit.body.error)).toContain("Pending and approved payment amounts are immutable");\n\n  expect(result.approved.status).toBe(200);''',
)
replace_once(
    PAYMENTS_TEST,
    '''  expect(String(result.approvedAmountEdit.body.error)).toContain("Approved payment amounts are immutable");''',
    '''  expect(String(result.approvedAmountEdit.body.error)).toContain("Pending and approved payment amounts are immutable");''',
)

# Clean up the one-shot patcher/workflow from the resulting feature commit.
for transient in [
    ROOT / "scripts/apply-admin-workflow-batch1.py",
    ROOT / ".github/workflows/apply-admin-workflow-batch1.yml",
]:
    if transient.exists():
        transient.unlink()

print("[BoardOps] admin workflow batch one patch applied")
