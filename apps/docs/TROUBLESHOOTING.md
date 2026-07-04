# Troubleshooting

Use this guide when the first setup path fails before you can run preview, execute, history or undo.

## Quick Checks

Run these from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @rollbackkit/docs test
```

For PostgreSQL-backed flows, verify the database URL and migration status:

```bash
ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm --filter @rollbackkit/cli exec node dist/bin.mjs doctor
```

For the Next.js demo, verify the demo database:

```bash
ROLLBACKKIT_DEMO_DATABASE_URL="postgres://user:password@localhost:5432/rollbackkit_test" \
pnpm --filter @rollbackkit/demo-next db:reset
```

## Missing PostgreSQL Database URL

Error:

```text
Missing PostgreSQL database URL. Pass --database-url or set ROLLBACKKIT_DATABASE_URL.
```

Fix:

```bash
export ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database"
```

Or pass the URL directly:

```bash
pnpm exec rollbackkit doctor --database-url "postgres://user:password@localhost:5432/app_database"
```

Use `ROLLBACKKIT_DATABASE_URL` or `--database-url` for RollbackKit CLI commands. The CLI
intentionally ignores generic `DATABASE_URL` so schema commands do not target an ambient
application database by accident.

## Missing Demo Database URL

Error:

```text
Missing demo database URL. Set ROLLBACKKIT_DEMO_DATABASE_URL.
```

Fix for one command:

```bash
ROLLBACKKIT_DEMO_DATABASE_URL="postgres://user:password@localhost:5432/rollbackkit_test" \
pnpm --filter @rollbackkit/demo-next db:reset
```

Fix for repeated local demo commands:

```bash
cp apps/demo-next/.env.example apps/demo-next/.env
```

Then edit `apps/demo-next/.env` with your local database URL. The file is ignored by git.

## CLI Cannot Find Workspace Package Dist Files

Error:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../packages/cli/node_modules/@rollbackkit/core/dist/index.mjs'
```

This means the local workspace package that the CLI imports has not been built yet.

Fix:

```bash
pnpm --filter @rollbackkit/core build
pnpm --filter @rollbackkit/postgres build
pnpm --filter @rollbackkit/cli build
```

Then rerun the CLI command:

```bash
ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm --filter @rollbackkit/cli exec node dist/bin.mjs migrate
```

If you are not debugging package boundaries, `pnpm build` is the simpler reset.

## Migration Checksum Error

Error:

```text
Applied RollbackKit PostgreSQL migration "0001_initial_schema" does not have a checksum.
```

Recent RollbackKit builds backfill checksums for known bundled migrations. If you still see this
error, first rebuild the PostgreSQL package and rerun migrations:

```bash
pnpm --filter @rollbackkit/postgres build

ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm --filter @rollbackkit/cli exec node dist/bin.mjs migrate
```

For a disposable demo database, `db:reset` is also acceptable:

```bash
ROLLBACKKIT_DEMO_DATABASE_URL="postgres://user:password@localhost:5432/rollbackkit_test" \
pnpm --filter @rollbackkit/demo-next db:reset
```

Do not hand-edit production migration rows unless you have verified the exact bundled migration SQL
and have a database backup.

## Migration Checksum Mismatch

Error:

```text
Applied RollbackKit PostgreSQL migration "0001_initial_schema" checksum does not match the bundled migration.
```

This means the database records a migration id whose SQL no longer matches the package currently in
use.

Fix:

- verify that the application and CLI are using the same RollbackKit version;
- make sure local `dist` files are rebuilt from the current source;
- do not run a newer package against a database migrated by modified local migration SQL;
- for disposable local databases, recreate the database and run `migrate` again.

## PostgreSQL Connection Fails

Check that PostgreSQL is running and the database exists:

```bash
psql "postgres://user:password@localhost:5432/app_database"
```

Then check RollbackKit status:

```bash
ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm --filter @rollbackkit/cli exec node dist/bin.mjs doctor
```

## Schema Has Pending Migrations

Run:

```bash
ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm --filter @rollbackkit/cli exec node dist/bin.mjs migrate
```

Then verify:

```bash
ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm --filter @rollbackkit/cli exec node dist/bin.mjs doctor
```

## PostgresStore Rejects `pg.Pool`

Error:

```text
PostgresStore requires a single PostgreSQL connection executor for transaction-safe storage. Do not pass pg.Pool directly.
```

Fix:

```ts
const client = await pool.connect();

try {
    const storage = createPostgresStore({
        executor: client,
    });

    // run preview, execute or undo here
} finally {
    client.release();
}
```

Use `pg.Client` or `pg.PoolClient` for RollbackKit storage. A bare `pg.Pool` can split transaction
queries across connections, which breaks undo locking.

For web servers, prefer leasing a `pg.PoolClient` for each RollbackKit operation. Do not keep one
connected `pg.Client` inside a singleton `RollbackKit` instance and share it across concurrent
requests.

## Idempotency Conflict

Error:

```text
Idempotency key "request_123" was already used for action "project.archive" with different input.
```

The same error code is returned when the key is reused with a different target.

Fix:

- reuse the same idempotency key only for exact retries of the same request;
- generate a new key for a different target or input;
- include the action scope in application-generated request ids.

RollbackKit treats same key plus different input or target as unsafe because it cannot know which
mutation the caller intended to retry.

## Undo Is Refused

Undo is designed to fail closed. Common causes:

- the action run does not exist;
- the action did not complete successfully;
- the undo window expired;
- the action has already been undone;
- the request `tenantId` does not match the action run tenant;
- a tenant-scoped action run is undone without passing tenant context;
- the undo actor is not authorized;
- required snapshots are missing;
- `checkConflicts` recorded that current state no longer matches expected state.

Check conflicts for the action run when status is `undo_failed`:

```ts
const conflicts = await rollbackkit.getConflicts({
  actionRunId,
  tenantId,
});
```

For UI/API guidance, show conflict reasons as state explanations instead of generic server errors.

## Demo Looks Empty After Reset

Run the full reset instead of only migrations:

```bash
ROLLBACKKIT_DEMO_DATABASE_URL="postgres://user:password@localhost:5432/rollbackkit_test" \
pnpm --filter @rollbackkit/demo-next db:reset
```

`db:migrate` prepares schema. `db:reset` prepares schema, clears demo data and seeds the workspace.

## Related Pages

- [Getting Started](./GETTING_STARTED.md)
- [PostgreSQL Setup](./POSTGRESQL_SETUP.md)
- [Demo App](./DEMO_APP.md)
- [Security Baseline](./SECURITY.md)
- [Conflict Detection](./recipes/CONFLICT_DETECTION.md)
