# Feature parity matrix

| Source feature | Source area | New module | UI preserved | Logic preserved | Logic fixed | Tests | Status |
|---|---|---|---|---|---|---|---|
| Authentication/registration/OTP/recovery | auth UI + `/api/auth/*` | auth | Required | Required | security/session internals | planned | AUDITED |
| Dashboard | dashboard view/API | dashboard | Required | Required | query efficiency | planned | AUDITED |
| Meal configuration | meals config | meals | Required | Required | invariants as found | planned | AUDITED |
| Resident meals/leave/guest | user meals + meal APIs | meals | Required | Required | invariants as found | planned | AUDITED |
| Kitchen/counts | kitchen | meals/kitchen | Required | Required | query efficiency | planned | AUDITED |
| Residents/users | users | residents/users | Required | Required | permission model | planned | AUDITED |
| Products/purchases | billing feature | purchases | Required | Required | accounting immutability | planned | AUDITED |
| Expenses | expenses view/API | expenses | Required | Required | integer money + immutability | planned | AUDITED |
| Payments | payments view/API | payments | Required | Required | integer money + idempotency + immutability | planned | AUDITED |
| Funds | funds/resident ledger | funds | Required | Required | ledger authority | planned | AUDITED |
| Refunds/adjustments | finance APIs | accounting | Required | Required | reversal/adjustment rules | planned | AUDITED |
| Variables/formulas | formula engine/API | formulas | Required | Parser semantics where valid | block invalid fallback | planned | AUDITED |
| Billing cycles/snapshots/bills | billing/closing | billing | Required | Workflow intent | immutable snapshot-only billing | planned | AUDITED |
| Monthly closing | monthly-closing | monthly-closing | Required | User workflow | durable state machine | planned | AUDITED |
| Notifications/announcements | notifications | notifications | Required | Required | delivery idempotency | planned | AUDITED |
| Reports/exports | reports/system | reports | Required | Required | lazy/background work | planned | AUDITED |
| Settings/policies/holidays | settings/calendar | settings | Required | Required | validation/permissions | planned | AUDITED |
| Profile/personalization | auth/personalization | profile | Required | Required | secure persistence | planned | AUDITED |
| Audit/system/background tasks | audit/system | audit/system | Required | Required | immutable audit + Cloudflare background primitives | planned | AUDITED |
| Roles/permissions | schema/routes/UI | permissions | Recognizable role UX | Replace internals | explicit RBAC permissions | planned | AUDITED |

`IMPLEMENTED`/`VERIFIED` are intentionally not used before the owning phase is built and tested.
