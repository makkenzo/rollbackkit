# Contributing

RollbackKit is an early v0 TypeScript monorepo. Contributions should keep the package boundaries
explicit and avoid promoting experimental internals into public API by accident.

## Prerequisites

- Node.js 22 or newer.
- pnpm from the root `packageManager` field.

Enable pnpm through Corepack:

```bash
corepack enable
pnpm install
```

## Local Checks

Run the PR check set before opening a pull request:

```bash
pnpm ci:pr
```

Useful narrower commands:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
```

PostgreSQL integration tests require a local database and are intentionally separate from the
default PR unit-test command.

## Changesets

Add a changeset when a change affects a published package:

```bash
pnpm changeset
```

No changeset is needed for documentation-only changes, private app changes, CI-only changes or
internal checklist updates.

## Package Boundaries

- Put lifecycle contracts and runtime behavior in `@rollbackkit/core`.
- Put PostgreSQL persistence, locking and migrations in `@rollbackkit/postgres`.
- Put developer command-line behavior in `@rollbackkit/cli`.
- Keep demo-only product logic inside `apps/demo-next`.
- Keep public documentation inside `apps/docs`.

Package root exports are the public API surface. Treat non-root imports as internal unless the
package boundary documentation says otherwise.
