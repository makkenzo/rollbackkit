# Introduction

RollbackKit is a TypeScript framework for product actions that need preview, audit history and undo.

It is built for SaaS and internal-tool operations such as:

- archive a project;
- remove a workspace member;
- change a user's role;
- publish or archive a document;
- import a batch of customer records.

These operations are usually implemented as one-off mutations behind a confirmation modal. That is
easy to ship, but it leaves the product with weak safety guarantees:

- the UI cannot explain real impact before mutation;
- retry behavior is usually ad hoc;
- audit history is incomplete or spread across logs;
- undo is hard to add later;
- unsafe rollback is easy to perform accidentally.

RollbackKit asks you to model those operations as explicit lifecycle-managed actions:

```text
preview -> execute -> audit -> undo -> expire
```

The framework does not guess how your application data should be restored. You define the product
operation, snapshots, side effects, permission checks and undo handler. RollbackKit supplies the
lifecycle contracts, storage interfaces, PostgreSQL adapter, migration tooling and failure
boundaries.

## What RollbackKit Provides

- A core action runtime in `@rollbackkit/core`.
- A storage adapter contract that keeps core lifecycle code storage-agnostic.
- A PostgreSQL adapter in `@rollbackkit/postgres`.
- A migration and diagnostics CLI in `@rollbackkit/cli`.
- A Next.js demo app that shows preview, execute, audit and undo end to end.

## Where To Start

Read [Why rollback-first](./WHY_ROLLBACK_FIRST.md) if you want the product and architecture case.

Read [Getting started](./GETTING_STARTED.md) if you want to define and run your first action.

Read [Recipes](./recipes/README.md) when you want concrete product patterns:

- [Soft Delete With Undo](./recipes/SOFT_DELETE_WITH_UNDO.md)
- [Change User Role Safely](./recipes/CHANGE_USER_ROLE.md)
- [Remove Workspace Member With Undo](./recipes/REMOVE_WORKSPACE_MEMBER.md)
- [Conflict Detection](./recipes/CONFLICT_DETECTION.md)

Read [PostgreSQL Setup](./POSTGRESQL_SETUP.md) when you are ready to persist action runs and
snapshots.
