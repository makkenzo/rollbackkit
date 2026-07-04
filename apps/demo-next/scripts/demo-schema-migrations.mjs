import { createHash } from 'node:crypto';

import { readDemoSql } from './demo-db.mjs';

const DEMO_SCHEMA_MIGRATIONS = [
    {
        id: '0001_demo_schema',
        description: 'Create RollbackKit demo product tables.',
        path: 'db/schema.sql',
    },
];

const EXPECTED_DEMO_SCHEMA_COLUMNS = new Map([
    ['demo_workspaces', ['id', 'slug', 'name', 'created_at']],
    ['demo_members', ['id', 'workspace_id', 'name', 'email', 'role', 'created_at']],
    [
        'demo_projects',
        [
            'id',
            'workspace_id',
            'name',
            'owner_member_id',
            'status',
            'archived_at',
            'updated_at',
            'created_at',
        ],
    ],
    [
        'demo_documents',
        [
            'id',
            'workspace_id',
            'project_id',
            'owner_member_id',
            'title',
            'state',
            'archived_at',
            'updated_at',
            'created_at',
        ],
    ],
]);

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
            await assertExpectedDemoSchema(client, migration);
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
            await assertExpectedDemoSchema(client, migration);
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

async function assertExpectedDemoSchema(client, migration) {
    const expectedTables = [...EXPECTED_DEMO_SCHEMA_COLUMNS.keys()];
    const result = await client.query(
        `
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = current_schema()
  AND table_name = ANY($1::text[])
ORDER BY table_name ASC, ordinal_position ASC
`,
        [expectedTables],
    );

    const actualColumnsByTable = new Map();

    for (const row of result.rows) {
        const tableName = String(row.table_name);
        const columnName = String(row.column_name);
        const columns = actualColumnsByTable.get(tableName) ?? new Set();

        columns.add(columnName);
        actualColumnsByTable.set(tableName, columns);
    }

    const missing = [];

    for (const [tableName, expectedColumns] of EXPECTED_DEMO_SCHEMA_COLUMNS) {
        const actualColumns = actualColumnsByTable.get(tableName);

        if (actualColumns === undefined) {
            missing.push(`${tableName}.*`);
            continue;
        }

        for (const columnName of expectedColumns) {
            if (!actualColumns.has(columnName)) {
                missing.push(`${tableName}.${columnName}`);
            }
        }
    }

    if (missing.length > 0) {
        throw new Error(
            `Demo schema migration "${migration.id}" cannot be marked applied because expected demo schema is missing: ${missing.join(
                ', ',
            )}.`,
        );
    }
}
