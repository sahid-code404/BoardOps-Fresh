# Accounting rules for the rewrite

These rules are mandatory even where source behavior differs:

- Currency is integer minor units (INR paise); binary floating-point is never authoritative.
- Approved payments/expenses/purchases and published bills are immutable historical records.
- Corrections use reversal, adjustment and replacement events; no silent direct edit or hard delete.
- Ledger events are append-only and explain derived balances.
- Money-changing requests are idempotent.
- Historical bills read only frozen monthly snapshots, never mutable live rows.
- Formula/version/variables/policies/rates/source data are frozen for reproducibility.
- Missing or invalid canonical billing formula blocks close; no legacy fallback.
- Monthly closing is a durable, resumable, observable state machine with transaction-safe/idempotent steps.
