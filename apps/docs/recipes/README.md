# Recipes

Recipes show complete product-action patterns that can be copied into an application and adapted to
its own database, permission model and UI.

Use these guides after [Getting Started](../GETTING_STARTED.md) when you want a concrete pattern
instead of the minimal first action.

## Available Recipes

- [Soft Delete With Undo](./SOFT_DELETE_WITH_UNDO.md): archive a record, keep a snapshot and restore
  it only while the archived state is still unchanged.
- [Change User Role Safely](./CHANGE_USER_ROLE.md): change a member role with preview, audit history
  and a conflict check before undo.
- [Remove Workspace Member With Undo](./REMOVE_WORKSPACE_MEMBER.md): remove a member, snapshot owned
  relations and restore membership only when the workspace state is still safe.
- [Conflict Detection](./CONFLICT_DETECTION.md): block unsafe undo, record conflict details and
  return a UI/API-safe reason.

## Next Recipes

The next recipe set should cover document archive, bulk import rollback, partial rollback with an
email side effect, irreversible action warnings, multi-tenant setup, idempotency keys, custom
permissions, action-history UI, undo toast behavior and cleanup of expired snapshots.

## Related Pages

- [Introduction](../INTRODUCTION.md)
- [Core Lifecycle](../CORE_LIFECYCLE.md)
- [Architecture](../ARCHITECTURE.md)
- [Package Boundaries](../PACKAGE_BOUNDARIES.md)
- [Demo App](../DEMO_APP.md)
