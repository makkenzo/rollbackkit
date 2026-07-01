# @rollbackkit/postgres

PostgreSQL storage adapter and migration runner for RollbackKit.

Use this package when RollbackKit action runs, snapshots, side effects, conflicts and history should
be stored durably in PostgreSQL.

## Install

```bash
pnpm add @rollbackkit/core @rollbackkit/postgres pg
```

## Migrations

Run migrations before creating a `PostgresStore`:

```bash
ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm exec rollbackkit migrate
```

Check status:

```bash
ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm exec rollbackkit doctor
```

## Store Setup

```ts
import { createRollbackKit } from '@rollbackkit/core';
import { createPostgresStore } from '@rollbackkit/postgres';
import { Client } from 'pg';

const client = new Client({
    connectionString: process.env.ROLLBACKKIT_DATABASE_URL,
});

await client.connect();

const rollbackkit = createRollbackKit({
    storage: createPostgresStore({
        executor: client,
    }),
    actions: [
        // your actions
    ],
});
```

For undo flows, pass a single PostgreSQL connection executor such as `pg.Client` or `pg.PoolClient`.
Do not pass a bare `pg.Pool` directly to `createPostgresStore`.
