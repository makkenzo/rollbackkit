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
ROLLBACKKIT_DATABASE_URL="$DATABASE_URL" \
pnpm exec rollbackkit migrate
```

Check status:

```bash
ROLLBACKKIT_DATABASE_URL="$DATABASE_URL" \
pnpm exec rollbackkit doctor
```

Set `advisoryLockTimeoutMs` on `createPostgresMigrationRunner` when migration startup should fail
instead of waiting indefinitely for another runner's advisory lock.

Legacy migration rows without checksums are rejected by default. If you have verified an old schema
manually and need to stamp bundled checksums for a one-time repair, pass
`unsafeAllowLegacyChecksumBackfill: true` to `createPostgresMigrationRunner`.

## Store Setup

```ts
import { createRollbackKit } from '@rollbackkit/core';
import { createPostgresStore } from '@rollbackkit/postgres';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.ROLLBACKKIT_DATABASE_URL,
});

export async function withRollbackKit<TValue>(
    handler: (rollbackkit: ReturnType<typeof createRollbackKit>) => Promise<TValue>,
): Promise<TValue> {
    const client = await pool.connect();

    try {
        const rollbackkit = createRollbackKit({
            storage: createPostgresStore({
                executor: client,
                actionRunLockTimeoutMs: 5_000,
            }),
            actions: [
                // your actions
            ],
        });

        return await handler(rollbackkit);
    } finally {
        client.release();
    }
}
```

For web servers, create `PostgresStore` with a request-scoped `pg.PoolClient` and release it after
the RollbackKit operation finishes. A single long-lived `pg.Client` shared by concurrent requests can
interleave RollbackKit transactions. Do not pass a bare `pg.Pool` directly to `createPostgresStore`.

For migration, checksum and connection errors, see
[Troubleshooting](../../apps/docs/TROUBLESHOOTING.md).
