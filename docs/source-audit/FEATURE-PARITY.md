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
| Expenses | expenses view/API | expenses | Required | Required | integer money + immutability + replacement corrections | clean D1 + runtime + visual | VERIFIED |
| Payments | payments view/API | payments | Required | Required | integer money + idempotency + immutability | clean D1 + runtime + visual | VERIFIED |
| Funds | funds/resident ledger | funds | Required | Required | derived ledger authority; no duplicate mutable balance | clean D1 + runtime + visual | VERIFIED |
| Refunds/adjustments | finance APIs | accounting | Required | Required | durable credit reservation + immutable additive corrections | clean D1 + runtime + visual | VERIFIED |
| Variables/formulas | formula engine/API | formulas | Required | Parser semantics where valid | BigInt fixed-point evaluation + runtime identifiers + immutable versions + fail-closed persisted dependencies | clean D1 + unit + runtime + visual | VERIFIED |
| Billing cycles/snapshots/bills | billing/closing | billing | Required | Workflow intent | immutable snapshot-only billing | clean D1 + runtime + visual | VERIFIED |
| Monthly closing | monthly-closing | monthly-closing | Required | User workflow | resumable fail-closed state machine + immutable Formula/version snapshot + D1 source locks | clean D1 + runtime + visual | VERIFIED |
| Notifications/announcements | notifications | notifications | Required | Required | durable idempotent self-scoped delivery + transactional domain-event fan-out | clean D1 + runtime + visual | VERIFIED |
| Reports/exports | reports/system | reports | Required | Required | canonical lazy D1 read models + deterministic scoped CSV export | clean D1 + runtime + visual | VERIFIED |
| Settings/policies/holidays | settings/calendar | settings | Required | Required | validated institution settings/policies + durable holiday meal guards + least-privilege RBAC | clean D1 + runtime + visual | VERIFIED |
| Profile/personalization | auth/personalization | profile | Required | Required | secure persistence | planned | AUDITED |
| Audit/system/background tasks | audit/system | audit/system | Required | Required | immutable audit + Cloudflare background primitives | planned | AUDITED |
| Roles/permissions | schema/routes/UI | permissions | Recognizable role UX | Replace internals | explicit RBAC permissions | planned | AUDITED |

`IMPLEMENTED`/`VERIFIED` are intentionally not used before the owning phase is built and tested.
