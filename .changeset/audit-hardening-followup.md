---
"@rollbackkit/core": minor
"@rollbackkit/postgres": patch
"@rollbackkit/cli": patch
---

Harden audit safety contracts: enforce memory transaction rollback, reject unsafe undo state, validate stored JSON payloads, support required snapshots and actor-type history filters, add PostgreSQL lock timeouts and strict migration history checks, and redact database credentials in CLI errors.
