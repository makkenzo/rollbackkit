---
"@rollbackkit/postgres": patch
---

Serialize PostgreSQL migration setup with an advisory lock so concurrent migration runners do not
race while creating the RollbackKit migration metadata table.
