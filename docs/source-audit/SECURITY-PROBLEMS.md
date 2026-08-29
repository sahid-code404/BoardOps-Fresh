# Security audit findings

| ID | Finding | Risk | Target rule |
|---|---|---|---|
| SEC-001 | Golden master repository contains a committed `.env`. | Secret/config leakage pattern. | Target ignores all real env files; only `.env.example` is committed. |
| SEC-002 | Golden master contains a live-looking SQLite database and compressed DB backup under version control. | Sensitive operational data exposure/retention risk. | Never migrate database files/backups; use deterministic fake local seed data. |
| SEC-003 | Runtime/dev logs and agent/tool output are committed. | Accidental sensitive data and repository-noise risk. | Ignore logs/scratch/tool output. |
| SEC-004 | Session DB schema stores the opaque session token directly and lookup queries by the raw token. | DB disclosure would expose active bearer credentials. | Persist a keyed/one-way digest and rotate/revoke sessions. |
| SEC-005 | `requireRole` and many endpoints use coarse string roles. | Authorization drift/over-broad privilege risk. | Explicit permission checks on every protected backend action. |
| SEC-006 | Bearer header fallback remains accepted for browser compatibility. | Expands token exposure/storage surface. | Complete migration to secure server-managed cookie sessions. |

Positive source behavior to keep: HttpOnly cookie support, Secure in production, SameSite=lax, scrypt password hashing, timing-safe verification and cryptographically random opaque tokens.
