# API inventory

The Next.js source exposes API route families for at least:

- adjustments
- announcements
- audit logs
- authentication / 2FA / registration / profile / password recovery
- billing cycles
- bills
- dashboard
- expenses
- formulas
- funds / resident fund ledger
- holidays
- institution
- kitchen
- leave
- meals
- notifications
- payments / refunds
- purchases/products
- reports/exports
- restrictions
- settings/policies
- users
- system/background tasks

Migration target: versioned Hono routes under `/api/v1/*`, explicit request/response validation, request IDs, backend authorization and idempotency for money-changing operations. Route-by-route parity is tracked in FEATURE-PARITY and expanded during the owning implementation phase.
