import { createHash } from 'node:crypto';

import { readDemoSql } from './demo-db.mjs';

const DEMO_SCHEMA_MIGRATIONS = [
    {
        id: '0001_demo_schema',
        description: 'Create RollbackKit demo product tables.',
        path: 'db/schema.sql',
    },
];

export async function migrateDemoSchema(client) {
    await client.query(`
CREATE TABLE IF NOT EXISTS demo_schema_migrations (
    id text PRIMARY KEY,
    description text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
)
`);

    const applied = await readAppliedDemoMigrations(client);
    const pending = [];

    for (const migration of DEMO_SCHEMA_MIGRATIONS) {
        const sql = await readDemoSql(migration.path);
        const checksum = createDemoMigrationChecksum(sql);
        const appliedChecksum = applied.get(migration.id);

        if (appliedChecksum === checksum) {
            continue;
        }

        if (appliedChecksum !== undefined) {
            throw new Error(
                `Applied demo schema migration "${migration.id}" checksum does not match ${migration.path}.`,
            );
        }

        pending.push({
            ...migration,
            checksum,
            sql,
        });
    }

    if (pending.length === 0) {
        return {
            applied: [],
            skipped: DEMO_SCHEMA_MIGRATIONS,
        };
    }

    await client.query('BEGIN');

    try {
        await client.query('LOCK TABLE demo_schema_migrations IN SHARE ROW EXCLUSIVE MODE');

        for (const migration of pending) {
            await client.query(migration.sql);
            await client.query(
                `
INSERT INTO demo_schema_migrations (id, description, checksum)
VALUES ($1, $2, $3)
`,
                [migration.id, migration.description, migration.checksum],
            );
        }

        await client.query('COMMIT');

        return {
            applied: pending,
            skipped: DEMO_SCHEMA_MIGRATIONS.filter(
                (migration) => !pending.some((item) => item.id === migration.id),
            ),
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    }
}

async function readAppliedDemoMigrations(client) {
    const result = await client.query(`
SELECT id, checksum
FROM demo_schema_migrations
ORDER BY id ASC
`);

    return new Map(result.rows.map((row) => [String(row.id), String(row.checksum)]));
}

function createDemoMigrationChecksum(sql) {
    return `sha256:${createHash('sha256').update(sql).digest('hex')}`;
}
