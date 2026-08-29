# Logic bugs / unsafe semantics found

| ID | Finding | Severity | Rewrite action |
|---|---|---:|---|
| LOG-001 | Monthly closing explicitly falls back to legacy `rate × count` billing when `formula.mealCharges` is missing or invalid. | Critical | Block close and require a valid canonical formula. |
| LOG-002 | Authoritative financial/snapshot fields use Prisma `Float`/JavaScript number arithmetic. | Critical | Migrate to integer minor units and integer-safe domain operations. |
| LOG-003 | Authorization is broadly role-string based (`ADMIN`, `USER`, `SUPER_ADMIN`) across navigation/API/session helpers. | High | Introduce permission-based authorization enforced server-side. |
| LOG-004 | Session lookup uses the raw opaque bearer/cookie token as the DB lookup value. | High | Store only a one-way token digest server-side; rotate/revoke sessions. |
| LOG-005 | Source accepts Authorization bearer fallback alongside the HttpOnly cookie for backward compatibility. | Medium | Remove unnecessary browser token fallback after compatibility migration. |

Additional module-specific defects are recorded before each owning feature is ported; no source bug is preserved merely for visual parity.
