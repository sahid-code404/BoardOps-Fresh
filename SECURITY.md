# Security policy

BoardOps handles authentication, financial records, operational documents, and audit history.

## Baseline rules

- Never commit real `.env` files, credentials, session tokens, OTPs, database files, backups, user uploads, or runtime logs.
- Production secrets belong in the deployment secret store, not source control.
- Backend authorization is mandatory; frontend visibility is not authorization.
- Financial mutations require validation, auditability, transaction boundaries, and idempotency.
- Approved/published financial records are corrected through reversal/adjustment/replacement, not silent edit or hard delete.
- Security findings from the read-only golden master are tracked in `docs/source-audit/SECURITY-PROBLEMS.md`.

No production deployment is authorized during the current Phase 00/01 gate.
