# ADR-001 — Cloudflare backend

Status: Accepted.

Use Cloudflare Workers for the API, D1 for authoritative relational data, R2 for operational files, Queues for asynchronous events and Workflows for durable multi-step processes such as monthly closing. Local development uses the Cloudflare Vite plugin/workerd-compatible runtime and local bindings.

Reason: this is the required production architecture and provides a Web-standards TypeScript runtime with first-class local simulation.
