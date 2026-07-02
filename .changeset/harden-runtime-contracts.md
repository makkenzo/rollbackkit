---
"@rollbackkit/core": minor
"@rollbackkit/postgres": patch
"@rollbackkit/cli": patch
---

Harden runtime contracts: undo can be scoped by tenant, recorded conflicts now block undo, idempotency retries must match the original target, read-only PostgreSQL migration status no longer mutates schema state, and package version exports are sourced from package metadata.
