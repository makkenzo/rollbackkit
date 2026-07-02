---
"@rollbackkit/postgres": patch
---

Harden PostgreSQL migration checks by validating audit constraints, enforcing non-null migration checksums after backfill, and failing explicit integration test runs without a test database URL.
