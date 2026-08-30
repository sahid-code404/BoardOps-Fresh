# Variables / Formula Engine Verification Checkpoint

Date: 2026-08-30

## Status

**IMPLEMENTATION VERIFIED — formal project-record closure pending documentation-head CI.**

Implementation verification head:

`b90808d1e5faca7bb2b5cb8434982408000b3b3c`

Implementation CI run:

`33319044942`

That implementation run passed deterministic lockfile validation, frozen install, TypeScript typecheck, unit tests, production builds, clean local D1 reset/migrate/seed/invariant verification, Worker readiness/API smoke, frontend smoke, all 19 real-D1 Playwright runtime tests, and the complete Phase 02 visual regression suite.

No production deployment was performed.

## Scope boundary

This checkpoint owns **Variables / Formula Engine** only. It does not claim Monthly Closing.

The source audit identified a critical Monthly Closing defect: the legacy close path can fall back to arithmetic such as `rate × count` when `formula.mealCharges` is absent or invalid. This checkpoint establishes the canonical Formula Engine required to remove that fallback later, but Monthly Closing remains `AUDITED` until its own implementation proves that missing, archived, malformed, or unresolved canonical formulas block closing.

## Durable institution-scoped model

Migration `0014_variables_formula_engine.sql` establishes canonical institution-scoped Variables and Formulas with immutable version history.

The current Variable/Formula rows carry active state while `variable_versions` and `formula_versions` preserve historical payloads. D1 guards reject mutation or deletion of immutable version history and protect the durable current entities from destructive history loss.

System-protected Variables cannot be archived. An ACTIVE Variable also cannot be archived while an ACTIVE Formula depends on it.

## Canonical fixed-point evaluator

Formula evaluation is Worker-owned and uses BigInt-backed fixed-point arithmetic rather than JavaScript binary floating-point for canonical financial calculation.

The evaluator supports:

- persisted Variable references through `var('...')`
- runtime context identifiers such as `breakfast_count`, `lunch_count`, and `dinner_count`
- decimal literals including `.5`
- deterministic arithmetic and rounding
- strict token/syntax validation
- missing persisted Variable reporting
- missing runtime-context reporting
- divide-by-zero rejection

Unit coverage explicitly proves `0.1 + 0.2 = 0.3` under the canonical evaluator.

The real-runtime suite also verifies the canonical meal calculation:

`3 × ₹40 + 2 × ₹60 + 1 × ₹70 = ₹310`

## Fail-closed dependency lifecycle

An ACTIVE Formula cannot be created or updated when a persisted Variable dependency is missing or archived. The API returns the unresolved dependencies instead of activating an unreproducible Formula.

A rejected Formula update does not advance the Formula version or replace the last valid immutable expression.

Likewise, an ACTIVE Variable cannot be archived while an active Formula depends on it. After the dependent Formula is archived, that Variable may be archived normally unless it is system-protected.

These rules are the prerequisite for Monthly Closing to fail closed later. This checkpoint itself does not modify Monthly Closing.

## Authorization baseline

The verified current RBAC baseline is:

- **64 permissions**
- **158 deterministic role-permission grants**
- Admin Formula/Variable permissions: **9**
- Super Admin Formula/Variable permissions: **9**
- Manager Formula/Variable permissions: **1**
- Resident/User Formula/Variable permissions: **1**

The nine Formula/Variable permissions are:

- `variables.read`
- `variables.create`
- `variables.update`
- `variables.archive`
- `formulas.read`
- `formulas.create`
- `formulas.update`
- `formulas.archive`
- `formulas.test`

Admin and Super Admin receive all nine. Manager and Resident/User receive only `variables.read`. Formula read/administration/testing therefore remains fail-closed for those roles. Future-institution bootstrap installs the same least-privilege baseline.

## Deterministic D1 invariants

`scripts/verify-formulas-local.mjs` is wired into the mandatory local reset/verification chain.

The verified clean-D1 state is:

- 10 active Variables
- 10 immutable Variable versions
- 4 active Formulas
- 4 immutable Formula versions
- 64 permissions
- 158 deterministic grants
- 6 immutable-history guards
- 2 future-institution bootstrap triggers
- 8 protected Variables
- 1 canonical meal Formula
- 1 canonical meal Formula dependency mapping

The verifier also probes immutable version update/delete protection and entity hard-delete guards instead of relying only on schema inspection.

Older finance verifiers remain future-safe for legitimate permission growth; this Formula verifier owns the exact present-day 64/158 global baseline.

## Real-runtime lifecycle proof

The dedicated real-D1 Formula Engine runtime coverage verifies:

1. authenticated-shell navigation into Formula Engine
2. real D1 Variables and Formulas render instead of fixture-only data
3. canonical meal evaluation returns exactly ₹310 for the 3/2/1 meal-count example
4. Variable creation starts at version 1
5. Variable update creates version 2
6. Formula creation with a missing persisted dependency is rejected
7. valid Formula creation against the runtime Variable succeeds
8. Formula evaluation returns the exact deterministic expected result
9. a depended-on Variable cannot be archived while the Formula is active
10. Formula update creates version 2
11. a later update to a missing dependency is rejected without replacing version 2
12. archiving the Formula releases the active dependency
13. the runtime Variable can then be archived
14. protected seeded Variables remain non-archivable
15. archived runtime fixtures disappear from active lists and deterministic seed counts return unchanged
16. no Formula/Variable API request produces an unexpected server error

The same runtime suite proves Resident least privilege through the real login/session path: the deterministic seeded resident can read Variables but receives permission-specific `403` responses for Variable mutations and all Formula read/create/update/archive/test actions.

The resident proof deliberately reuses the seeded active resident rather than registering another shared-IP identity, preventing the Formula test from consuming an email-verification challenge needed by later serial runtime tests.

CI run `33319044942` completed **19/19 real-D1 runtime tests green**, including both Formula Engine tests and the later Refunds/Adjustments lifecycle test.

## Visual contract and harness hardening

The dedicated Formula Engine visual contract covers both Variables and Formulas views while the general Phase 02 route matrix continues to exercise `/formula-engine` across the existing responsive/theme surfaces.

The final harness corrections were test mechanics only:

- replaced authenticated hard cold navigation with the proven Dashboard → More navigation → Formula Engine shell path
- reused the deterministic seeded resident to avoid unnecessary auth challenge/rate-limit pollution
- aligned Variables/Formulas locators with the component's actual accessible `tab` role
- scoped duplicate `System` text to the intended KPI bar to satisfy Playwright strict-mode semantics

No evaluator rule, accounting rule, dependency guard, authorization rule, or production behavior was relaxed to make the suites pass.

## Monthly Closing boundary

Monthly Closing remains **AUDITED** and intentionally untouched by this checkpoint.

Its owning implementation must consume a valid canonical Formula/version with strict persisted-variable and runtime-context dependency resolution. Missing or invalid required formulas must block closing. The legacy fallback arithmetic identified by the audit must not survive that checkpoint.

## Closure condition

Variables / Formula Engine implementation is **VERIFIED** at implementation head `b90808d1e5faca7bb2b5cb8434982408000b3b3c` with CI run `33319044942` fully green.

Formal project-record closure requires the documentation head containing this verification record, the feature-parity update, and the changelog entry to pass the same CI gate.

No production deployment was performed, and the golden repository remained read-only.
