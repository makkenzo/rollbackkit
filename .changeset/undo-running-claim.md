---
"@rollbackkit/core": patch
---

Persist undo-running state before executing undo handlers so failed undo attempts cannot roll back
to a completed run and be picked up by a second undo request.
