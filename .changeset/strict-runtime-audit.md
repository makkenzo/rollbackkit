---
"@rollbackkit/core": minor
"@rollbackkit/postgres": minor
"@rollbackkit/cli": patch
---

Harden runtime and storage boundaries: authorize preview and execute after resolving targets, require tenant context for tenant-owned undo, clone memory storage records at API boundaries, add PostgreSQL audit invariant constraints, scope migration advisory locks by database and schema, and improve CLI diagnostics and package metadata.
