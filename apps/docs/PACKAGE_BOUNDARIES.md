# Package Boundaries

RollbackKit is designed as a library-first TypeScript monorepo.

The main architectural rule is:

> Core owns product-action lifecycle contracts. Integrations own runtime-specific behavior.

## Packages

### `@rollbackkit/core`

The core package contains framework contracts and lifecycle orchestration.

It is responsible for:

- action definitions;
- action registry;
- preview lifecycle;
- execute lifecycle;
- undo lifecycle;
- snapshot contracts;
- storage adapter interface;
- lifecycle status model;
- error model;
- in-memory store for tests and examples.

It must not depend on:

- PostgreSQL;
- Prisma;
- Drizzle;
- Next.js;
- React;
- Node.js runtime APIs;
- HTTP frameworks;
- CLI code.

`@rollbackkit/core` should be usable in any TypeScript runtime that can execute standard JavaScript.

### `@rollbackkit/postgres`

The PostgreSQL package implements persistent storage for RollbackKit.

It is responsible for:

- PostgreSQL schema;
- migration runner;
- action persistence;
- snapshot persistence;
- side effect persistence;
- conflict persistence;
- idempotency records;
- transaction-level locking;
- history queries.

It depends on:

- `@rollbackkit/core`;
- `pg`.

It must not contain product-specific business logic.

### `@rollbackkit/cli`

The CLI package provides developer-facing commands.

Initial commands:

- `init`;
- `migrate`;
- `doctor`.

It is responsible for:

- running migrations;
- checking database connectivity;
- checking installed schema version;
- helping users initialize RollbackKit in existing projects.

It depends on:

- `@rollbackkit/core`;
- `@rollbackkit/postgres`.

It must not implement lifecycle logic directly.

### Future packages

Future packages are intentionally not created yet:

- `@rollbackkit/react`;
- `@rollbackkit/next`;
- `@rollbackkit/testkit`.

They should be added only after the core API stabilizes.

## Dependency direction

Allowed direction:

```text
cli -> postgres -> core
cli -> core

demo app -> postgres -> core
demo app -> core

future react -> core
future next -> core
future testkit -> core
```

Forbidden direction:

```text
core -> postgres
core -> cli
core -> react
core -> next
postgres -> cli
postgres -> demo app
```

## Boundary rule

When adding new functionality, ask:

1. Is this pure lifecycle behavior?
    - Put it in `@rollbackkit/core`.

2. Is this PostgreSQL persistence or locking?
    - Put it in `@rollbackkit/postgres`.

3. Is this developer tooling?
    - Put it in `@rollbackkit/cli`.

4. Is this demo-only product logic?
    - Put it in `apps/demo-next`.

5. Is this public documentation?
    - Put it in `apps/docs`.

6. Is this internal architecture documentation?
    - Put it in root `docs/`.
