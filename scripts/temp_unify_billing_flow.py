from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 exact match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 regex match, found {count}")
    return updated


# ---------------------------------------------------------------------------
# Billing UI: read/manage only. Monthly Closing is the sole generation entry.
# ---------------------------------------------------------------------------
path = "apps/web/src/components/features/billing/billing-view.tsx"
s = read(path)

s = s.replace("  Plus,\n", "")
s = s.replace("  FileText,\n", "")
s = replace_once(
    s,
    "  RotateCcw,\n} from \"lucide-react\";",
    "  RotateCcw,\n  Lock,\n} from \"lucide-react\";",
    "billing Lock import",
)
s = replace_once(
    s,
    'import { cn, toLocalDateKey } from "@/lib/utils";',
    'import { cn } from "@/lib/utils";',
    "remove billing due-date helper import",
)

select_import = '''import {\n  Select,\n  SelectContent,\n  SelectItem,\n  SelectTrigger,\n  SelectValue,\n} from "@/components/ui/select";\n'''
s = replace_once(s, select_import, "", "remove billing Select import")

s = regex_once(
    s,
    r'  const \[generateOpen, setGenerateOpen\] = useState\(false\);.*?  const \[selectedBill, setSelectedBill\] = useState<Bill \| null>\(null\);',
    '  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);',
    "remove billing generation state/readiness",
)

s = regex_once(
    s,
    r'\n  const generateMutation = useMutation\(\{.*?\n  const voidMutation = useMutation\(\{',
    '\n  const voidMutation = useMutation({',
    "remove billing generation mutation",
)

old_admin_action = '''      {/* Compact action bar — centered transparent glass card button */}\n      {isAdmin ? (\n        <StaggerItem>\n          <div className="flex items-center justify-center">\n            <GlassButton\n              variant="ghost"\n              onClick={() => setGenerateOpen(true)}\n              size="lg"\n              className="shrink-0 glass text-primary hover:text-primary font-semibold"\n            >\n              <Plus className="h-5 w-5" />\n              Generate Bills\n            </GlassButton>\n          </div>\n        </StaggerItem>\n      ) : ('''
new_admin_action = '''      {/* Billing is read/manage-only. Monthly Closing owns bill generation. */}\n      {isAdmin ? (\n        <StaggerItem>\n          <div className="flex items-center justify-center">\n            <GlassButton\n              variant="ghost"\n              onClick={() => setView("monthly-closing")}\n              size="lg"\n              className="shrink-0 glass text-primary hover:text-primary font-semibold"\n            >\n              <Lock className="h-5 w-5" />\n              Monthly Closing\n            </GlassButton>\n          </div>\n        </StaggerItem>\n      ) : ('''
s = replace_once(s, old_admin_action, new_admin_action, "replace billing admin action")

s = replace_once(
    s,
    '                    ? "Generate bills for the current period to get started."\n                    : "You have no bills matching the current filters."}',
    '                    ? "Bills are created automatically when a completed month is closed in Monthly Closing."\n                    : "You have no bills matching the current filters."}',
    "billing empty-state explanation",
)

old_empty_button = '''              {isAdmin && (\n                <GlassButton className="mt-2" onClick={() => setGenerateOpen(true)}>\n                  <Wallet className="h-4 w-4" />\n                  Generate Bills\n                </GlassButton>\n              )}'''
new_empty_button = '''              {isAdmin && (\n                <GlassButton className="mt-2" onClick={() => setView("monthly-closing")}>\n                  <Lock className="h-4 w-4" />\n                  Open Monthly Closing\n                </GlassButton>\n              )}'''
s = replace_once(s, old_empty_button, new_empty_button, "billing empty-state action")

s = regex_once(
    s,
    r'\n      \{/\* Generate Bills Dialog — with integrated readiness checklist \*/\}.*?\n      \{/\* Bill detail dialog \*/\}',
    '\n      {/* Bill detail dialog */}',
    "remove billing generation dialogs",
)

for forbidden in ("setGenerateOpen", "generateMutation", "confirmGenerateOpen", "genMonth", "genYear", "genDueDate"):
    if forbidden in s:
        raise SystemExit(f"billing UI still contains generation-only symbol: {forbidden}")
if "Generate Bills" in s:
    raise SystemExit("billing UI still exposes Generate Bills")
if 'setView("monthly-closing")' not in s:
    raise SystemExit("billing UI does not navigate admins to Monthly Closing")
write(path, s)


# ---------------------------------------------------------------------------
# Monthly Closing UI: make the sole authoritative generation action explicit.
# ---------------------------------------------------------------------------
path = "apps/web/src/components/features/billing/monthly-closing-view.tsx"
s = read(path)
s = replace_once(
    s,
    '{isClosed ? "Cycle Already Closed" : `Close ${MONTHS[selectedMonth]} ${selectedYear}`}',
    '{isClosed ? "Cycle Already Closed" : `Generate Bills & Close ${MONTHS[selectedMonth]} ${selectedYear}`}',
    "monthly closing primary action",
)
s = replace_once(
    s,
    '              Close {MONTHS[selectedMonth]} {selectedYear}',
    '              Generate Bills & Close {MONTHS[selectedMonth]} {selectedYear}',
    "monthly closing dialog title",
)
s = replace_once(
    s,
    '              This will freeze all data into an immutable snapshot, execute the formula engine, generate bills, and settle resident fund accounts. This action is logged.',
    '              This will freeze the month into an immutable snapshot, execute the formula engine, generate resident bills, derive settlement totals, and close the accounting period. This action is logged.',
    "monthly closing dialog explanation",
)
s = replace_once(
    s,
    '              Execute Closing',
    '              Generate Bills & Close Month',
    "monthly closing confirm action",
)
write(path, s)


# ---------------------------------------------------------------------------
# API: keep the legacy endpoint authenticated/RBAC-protected, but prohibit it
# from becoming a second bill-generation authority.
# ---------------------------------------------------------------------------
path = "services/api/src/routes/billing.ts"
s = read(path)
s = regex_once(
    s,
    r'billingRoutes\.post\("/bills", async \(c\) => \{.*?\n\}\);\n\nbillingRoutes\.delete\("/bills", async \(c\) => \{',
    '''billingRoutes.post("/bills", async (c) => {\n  const auth = await principalFor(c);\n  if (auth instanceof Response) return auth;\n\n  return c.json({\n    success: false,\n    error: "Bills are generated only through Monthly Closing. Close the billing period to create bills.",\n  }, 409);\n});\n\nbillingRoutes.delete("/bills", async (c) => {''',
    "disable direct bill generation endpoint",
)
if 'BILLS_GENERATED_FROM_SNAPSHOT' in s:
    raise SystemExit("legacy direct bill-generation mutation still present")
write(path, s)


# ---------------------------------------------------------------------------
# Runtime billing proof: Billing is read/manage-only and direct generation is
# blocked without mutating the existing immutable snapshot/bill evidence.
# ---------------------------------------------------------------------------
path = "tests/runtime-e2e/billing.spec.ts"
s = read(path)
s = replace_once(
    s,
    'test("Billing uses immutable D1 snapshots and preserves bill lifecycle semantics", async ({ page }) => {',
    'test("Billing is read/manage-only and bill generation is owned by Monthly Closing", async ({ page }) => {',
    "billing runtime test title",
)
s = replace_once(
    s,
    '  await expect(page.getByText("Generate Bills", { exact: true }).first()).toBeVisible({ timeout: 8_000 });',
    '  await expect(page.getByRole("button", { name: "Monthly Closing", exact: true })).toBeVisible({ timeout: 8_000 });\n  await expect(page.getByText("Generate Bills", { exact: true })).toHaveCount(0);',
    "billing runtime UI authority",
)

s = regex_once(
    s,
    r'    const julyBefore = await request\("/api/bills\?month=6&year=2026"\);.*?\n\n    const julyDeleted = await request',
    '''    const julyBefore = await request("/api/bills?month=6&year=2026");\n    const juneClosingReadiness = await request("/api/billing-cycles/readiness?month=5&year=2026");\n    const manualGenerate = await request("/api/bills", {\n      method: "POST",\n      body: JSON.stringify({ month: 5, year: 2026, dueDate: "2026-12-10" }),\n    });\n    const juneAfterBlockedGenerate = await request("/api/bills?month=5&year=2026");\n\n    const julyDeleted = await request''',
    "billing runtime direct generation setup",
)

s = regex_once(
    s,
    r'    const closedJulyGenerate = await request\("/api/bills", \{.*?\n    \}\);\n\n    return \{',
    '    return {',
    "remove redundant closed-period manual generation probe",
)

s = replace_once(
    s,
    '''      juneClosingReadiness,\n      juneGenerated,\n      juneAfter,\n      juneRegenerated,\n      juneVoided,''',
    '''      juneClosingReadiness,\n      manualGenerate,\n      juneAfterBlockedGenerate,''',
    "billing runtime result fields",
)
s = s.replace("      closedJulyGenerate,\n", "")

s = regex_once(
    s,
    r'  // `/billing-cycles/readiness` is the Monthly Closing contract now\..*?\n  expect\(result\.julyDeleted\.status\)\.toBe\(200\);',
    '''  // `/billing-cycles/readiness` belongs to Monthly Closing. The Billing\n  // surface cannot publish the seeded June snapshot directly anymore.\n  expect(result.juneClosingReadiness.status).toBe(200);\n  expect(result.juneClosingReadiness.body).toMatchObject({ success: true, data: { canClose: false } });\n  expect(result.juneClosingReadiness.body.data.items).toEqual(\n    expect.arrayContaining([\n      expect.objectContaining({ key: "cycle", status: "error" }),\n      expect.objectContaining({ key: "snapshot", status: "error" }),\n    ]),\n  );\n\n  expect(result.manualGenerate.status).toBe(409);\n  expect(result.manualGenerate.body).toMatchObject({\n    success: false,\n    error: "Bills are generated only through Monthly Closing. Close the billing period to create bills.",\n  });\n  expect(result.juneAfterBlockedGenerate.status).toBe(200);\n  expect(result.juneAfterBlockedGenerate.body.data).toHaveLength(0);\n\n  expect(result.julyDeleted.status).toBe(200);''',
    "billing runtime authority assertions",
)

s = regex_once(
    s,
    r'\n  expect\(result\.closedJulyGenerate\.status\)\.toBe\(422\);\n  expect\(result\.closedJulyGenerate\.body\)\.toMatchObject\(\{ success: false \}\);',
    '',
    "remove legacy closed generation assertion",
)

for forbidden in ("juneGenerated", "juneRegenerated", "juneVoided", "closedJulyGenerate"):
    if forbidden in s:
        raise SystemExit(f"billing runtime still contains legacy generation probe: {forbidden}")
write(path, s)


# ---------------------------------------------------------------------------
# Monthly Closing browser tests follow the new explicit labels.
# ---------------------------------------------------------------------------
path = "tests/runtime-e2e/monthly-closing.spec.ts"
s = read(path)
s = replace_once(
    s,
    '  await expect(page.getByRole("button", { name: /Close May 2026/u })).toBeVisible({ timeout: 8_000 });',
    '  await expect(page.getByRole("button", { name: /Generate Bills & Close May 2026/u })).toBeVisible({ timeout: 8_000 });',
    "monthly closing runtime action label",
)
write(path, s)

path = "tests/e2e/monthly-closing-visual.spec.ts"
s = read(path)
s = replace_once(
    s,
    '  const closeButton = page.getByRole("button", { name: /^Close [A-Z][a-z]+ \\d{4}$/u });',
    '  const closeButton = page.getByRole("button", { name: /^Generate Bills & Close [A-Z][a-z]+ \\d{4}$/u });',
    "monthly closing visual primary action",
)
s = replace_once(
    s,
    '  await expect(dialog.getByRole("heading", { name: /^Close [A-Z][a-z]+ \\d{4}$/u })).toBeVisible();',
    '  await expect(dialog.getByRole("heading", { name: /^Generate Bills & Close [A-Z][a-z]+ \\d{4}$/u })).toBeVisible();',
    "monthly closing visual dialog title",
)
s = replace_once(
    s,
    '  await expect(dialog.getByText(/freeze all data into an immutable snapshot/u)).toBeVisible();\n  await expect(dialog.getByText(/execute the formula engine, generate bills, and settle resident fund accounts/u)).toBeVisible();',
    '  await expect(dialog.getByText(/freeze the month into an immutable snapshot/u)).toBeVisible();\n  await expect(dialog.getByText(/generate resident bills, derive settlement totals, and close the accounting period/u)).toBeVisible();',
    "monthly closing visual explanation",
)
s = replace_once(
    s,
    '  await expect(dialog.getByRole("button", { name: "Execute Closing", exact: true })).toBeVisible();',
    '  await expect(dialog.getByRole("button", { name: "Generate Bills & Close Month", exact: true })).toBeVisible();',
    "monthly closing visual confirm action",
)
write(path, s)

print("Unified billing flow patch applied successfully")
