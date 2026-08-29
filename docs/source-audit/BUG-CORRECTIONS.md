# Bug correction log

## ACC-001 — Formula fallback
Source behavior: monthly close can proceed using legacy rate×count behavior when the canonical formula is absent/invalid.
Why incorrect: published bills become dependent on a second calculation path and are not guaranteed reproducible.
New behavior: close is blocked until the canonical formula validates.
Data/UI impact: readiness shows a blocking error; no bill is generated.
Tests: invalid/missing formula must block close.
Migration impact: none until billing schema phases.
Status: PLANNED.

## ACC-002 — Floating-point money
Source behavior: multiple money fields and totals use Float/JavaScript number.
Why incorrect: binary floating point is unsuitable as authoritative financial storage.
New behavior: integer minor units throughout authoritative domain/database/API contracts.
Data impact: explicit conversion migration required for any imported legacy data.
Tests: conversion, arithmetic, ledger invariants, round-trip formatting.
Status: PLANNED.

## SEC-001 — Raw session token persistence
Source behavior: opaque token is stored/queryable directly.
New behavior: only a digest is persisted; raw token exists only client-side cookie/request context.
Status: PLANNED.
