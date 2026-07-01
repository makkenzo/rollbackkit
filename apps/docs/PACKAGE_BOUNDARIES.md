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

- `migrate`;
- `doctor`.

It is responsible for:

- running migrations;
- checking database connectivity;
- checking installed schema version;
- reporting whether the installed RollbackKit PostgreSQL schema is current.

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

## Public root exports

Package root exports are intentionally narrow. If a symbol is not listed here, treat it as
internal even when it is exported from a source module for local tests.

### `@rollbackkit/core`

The core root exports lifecycle contracts, action definition helpers, runtime orchestration,
storage adapter contracts, the in-memory adapter, JSON/time primitives, identity types and
RollbackKit errors.

### `@rollbackkit/postgres`

The PostgreSQL root exports:

- `createPostgresStore` and `PostgresStore`;
- `createPostgresMigrationRunner` and `PostgresMigrationRunner`;
- `migratePostgresDatabase` and `getPostgresMigrationStatus`;
- migration runner result/status/options/error types;
- database migration options type;
- `PostgresQueryExecutor`;
- `ROLLBACKKIT_POSTGRES_MIGRATIONS`;
- `RollbackKitPostgresMigration`;
- `rollbackkitPostgresVersion`.

PostgreSQL id generation, row mapper functions, row shapes and individual migration constants are
internal implementation details.

### `@rollbackkit/cli`

The CLI package is primarily a binary package. Its root exports are:

- `createRollbackKitCliProgram`;
- `runCli`;
- `rollbackkitCliVersion`;
- command construction and writer option types.

The root exports are available for embedding and test harnesses. The CLI command surface remains
the primary public contract.

## Stability policy before v1

RollbackKit is still pre-v1, but several contracts are intentionally stable enough for product UI
and API integrations.

Stable through v0:

- package root exports listed in this document, except entries explicitly listed as experimental
  below;
- core lifecycle request/result contracts;
- storage adapter contracts needed to implement a non-PostgreSQL adapter;
- core error code string values;
- PostgreSQL migration runner status/result shapes;
- CLI command names, stdout/stderr split and the `0` success / `1` failure exit-code convention.

Experimental until v1:

- imports from non-root package source modules;
- CLI embedding helpers such as `createRollbackKitCliProgram`, `runCli` and their option types;
- PostgreSQL row shapes, mapper functions, id helpers and individual migration constants;
- demo app routes, scripts, data-access helpers and UI composition;
- generated `dist/*` file names and bundle structure;
- future `@rollbackkit/react`, `@rollbackkit/next` and `@rollbackkit/testkit` APIs;
- future advanced conflict, side-effect and retention APIs.

Experimental APIs may change during v0 with a changelog entry or changeset when the change affects
published packages. If a symbol is not exported from a package root, treat it as internal by default.

## Error code contract

`RollbackKitErrorCode` values from `@rollbackkit/core` are UI/API-facing string contracts. Consumers
may branch on `error.code` and serialize `RollbackKitError#toJSON()` responses across process
boundaries.

Current stable core error codes:

- `ACTION_NOT_FOUND`;
- `ACTION_ALREADY_REGISTERED`;
- `ACTION_INPUT_INVALID`;
- `ACTION_PERMISSION_DENIED`;
- `ACTION_EXECUTION_FAILED`;
- `ACTION_UNDO_FAILED`;
- `ACTION_NOT_UNDOABLE`;
- `ACTION_ALREADY_UNDONE`;
- `ACTION_UNDO_EXPIRED`;
- `ACTION_CONFLICT`;
- `IDEMPOTENCY_CONFLICT`;
- `SNAPSHOT_NOT_FOUND`;
- `STORAGE_ERROR`.

Policy:

- existing error code string values must not be renamed or removed in v0 without an explicit
  migration note and changeset;
- new error codes may be added in v0 minor releases;
- `message` is the default developer-readable message and can be surfaced by simple integrations;
- product UI should prefer mapping `code` to localized copy;
- `details` is structured diagnostic data, not a stable copy contract;
- `cause`, stack traces and PostgreSQL driver messages are never UI/API contracts.

PostgreSQL migration errors use `RollbackKitPostgresMigrationError` with a stable error `name` and
optional `migrationId`. They are developer/CLI-facing diagnostics, not product-action error codes.

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
