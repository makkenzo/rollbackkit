
# PostgreSQL Setup

RollbackKit uses PostgreSQL as the first official persistent storage adapter.

The PostgreSQL adapter stores:

- action runs;
- snapshots;
- side effects;
- conflicts;
- schema migration state.

The core package stays storage-agnostic. PostgreSQL-specific persistence, migrations and locking live in `@rollbackkit/postgres`.

## Requirements

You need:

- a running PostgreSQL database;
- a PostgreSQL connection string;
- RollbackKit packages built locally or installed from npm.

Example local connection string:

```bash
postgres://user:password@localhost:5432/app_database
````


Replace it with your own database URL.

## Environment variables

RollbackKit CLI reads the database URL from one of these environment variables:

```bash
ROLLBACKKIT_DATABASE_URL
DATABASE_URL
```

`ROLLBACKKIT_DATABASE_URL` is preferred when you want a dedicated RollbackKit database URL.

Example:

```bash
export ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database"
```

You can also pass the database URL directly:

```bash
rollbackkit doctor --database-url "postgres://user:password@localhost:5432/app_database"
```

## Applying migrations

RollbackKit stores its schema in your PostgreSQL database.

Run migrations before using the PostgreSQL store:

```bash
rollbackkit migrate
```

With an explicit database URL:

```bash
rollbackkit migrate --database-url "postgres://user:password@localhost:5432/app_database"
```

From this monorepo during local development:

```bash
ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm --filter @rollbackkit/cli exec node dist/bin.mjs migrate
```

If migrations are pending, the CLI prints the applied migration list:

```text
Applied 1 RollbackKit PostgreSQL migration(s):
- 0001_initial_schema: Create RollbackKit action run, snapshot, side effect and conflict tables.
```

If the schema is already up to date, it prints:

```text
RollbackKit PostgreSQL schema is up to date. 1 migration(s) already applied.
```

## Checking database status

Use `doctor` to verify that RollbackKit can connect to PostgreSQL and inspect migration status:

```bash
rollbackkit doctor
```

With an explicit database URL:

```bash
rollbackkit doctor --database-url "postgres://user:password@localhost:5432/app_database"
```

From this monorepo during local development:

```bash
ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm --filter @rollbackkit/cli exec node dist/bin.mjs doctor
```

Example output before migrations:

```text
RollbackKit PostgreSQL doctor
Database: connected
Applied migrations: 0
Schema: 1 pending migration(s)
- 0001_initial_schema: Create RollbackKit action run, snapshot, side effect and conflict tables.
```

Example output after migrations:

```text
RollbackKit PostgreSQL doctor
Database: connected
Applied migrations: 1
Schema: up to date
```

## Using `PostgresStore`

Create a PostgreSQL client and pass it to `createPostgresStore`.

```ts
import { createRollbackKit } from '@rollbackkit/core';
import { createPostgresStore } from '@rollbackkit/postgres';
import { Client } from 'pg';

const client = new Client({
    connectionString: process.env.ROLLBACKKIT_DATABASE_URL,
});

await client.connect();

const storage = createPostgresStore({
    executor: client,
});

const rollbackkit = createRollbackKit({
    storage,
    actions: [
        // your actions
    ],
});
```

## Important locking note

`PostgresStore.withActionRunLock()` uses a transaction and `SELECT ... FOR UPDATE`.

For lock-safe undo, pass a single-connection executor such as:

* `pg.Client`;
* `pg.PoolClient`.

Do not pass a bare `pg.Pool` directly to `createPostgresStore` for undo flows.

A bare pool can run `BEGIN`, `SELECT ... FOR UPDATE`, updates and `COMMIT` on different connections, which breaks transaction safety.

Recommended pattern with `pg.Pool`:

```ts
import { createRollbackKit } from '@rollbackkit/core';
import { createPostgresStore } from '@rollbackkit/postgres';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.ROLLBACKKIT_DATABASE_URL,
});

const client = await pool.connect();

try {
    const storage = createPostgresStore({
        executor: client,
    });

    const rollbackkit = createRollbackKit({
        storage,
        actions: [
            // your actions
        ],
    });

    // run preview / execute / undo here
} finally {
    client.release();
}
```

## Tables created by the initial migration

The initial migration creates these tables:

```text
rollbackkit_action_runs
rollbackkit_snapshots
rollbackkit_side_effects
rollbackkit_conflicts
rollbackkit_schema_migrations
```

## What is stored

### `rollbackkit_action_runs`

Stores the lifecycle state of each action run:

* action name;
* actor;
* tenant id;
* target;
* input;
* status;
* reversibility;
* timestamps;
* result;
* undo result;
* error;
* metadata.

### `rollbackkit_snapshots`

Stores JSON snapshots required for undo.

Snapshots should contain only the state required to safely undo the action.

Do not store secrets, tokens, passwords or unnecessary sensitive data in snapshots.

### `rollbackkit_side_effects`

Stores external or non-local effects of an action.

Examples:

* email sent;
* webhook delivered;
* notification created;
* file removed.

Each side effect records its own reversibility.

### `rollbackkit_conflicts`

Stores reasons why undo is unsafe or impossible.

Examples:

* target state changed after the original action;
* required snapshot is missing;
* target no longer exists;
* expected state does not match actual state.

### `rollbackkit_schema_migrations`

Stores applied RollbackKit PostgreSQL migrations.

## Local development checklist

Build packages:

```bash
pnpm build
```

Run PostgreSQL package tests:

```bash
pnpm --filter @rollbackkit/postgres test
```

Run real PostgreSQL integration tests:

```bash
ROLLBACKKIT_POSTGRES_TEST_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm --filter @rollbackkit/postgres test:integration
```

Check CLI doctor:

```bash
ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm --filter @rollbackkit/cli exec node dist/bin.mjs doctor
```

Apply migrations:

```bash
ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm --filter @rollbackkit/cli exec node dist/bin.mjs migrate
```

Check status again:

```bash
ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm --filter @rollbackkit/cli exec node dist/bin.mjs doctor
```

## Troubleshooting

### Missing database URL

Error:

```text
Missing PostgreSQL database URL. Pass --database-url or set ROLLBACKKIT_DATABASE_URL / DATABASE_URL.
```

Fix:

```bash
export ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database"
```

Or pass the URL directly:

```bash
rollbackkit doctor --database-url "postgres://user:password@localhost:5432/app_database"
```

### Database connection fails

Check that PostgreSQL is running and the database exists.

Example:

```bash
psql "postgres://user:password@localhost:5432/app_database"
```

### Schema has pending migrations

Run:

```bash
rollbackkit migrate
```

Then verify:

```bash
rollbackkit doctor
```

### Undo locking behaves incorrectly

Make sure `createPostgresStore()` receives a single-connection executor.

Use `pg.Client` or `pg.PoolClient`, not a bare `pg.Pool`, for flows that depend on transaction-safe undo.

