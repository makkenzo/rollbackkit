---
"@rollbackkit/core": minor
"@rollbackkit/postgres": patch
"@rollbackkit/cli": patch
---

Harden audit safety contracts: enforce memory transaction rollback, reject unsafe undo state, validate stored JSON payloads, require scoped side-effect/conflict reads, cap stored idempotency keys, support required snapshots and actor-type history filters, add PostgreSQL lock timeouts and migration checksum compatibility, guard embedded CLI exits and recursive cause rendering, and redact database credentials in CLI errors.
