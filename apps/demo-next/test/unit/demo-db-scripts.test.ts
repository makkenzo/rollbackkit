import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { readDemoSql } from '../../scripts/demo-db.mjs';
import { migrateDemoSchema } from '../../scripts/demo-schema-migrations.mjs';
import { seedDemoDatabase } from '../../scripts/seed-demo-db.mjs';

describe('demo database scripts', () => {
    it('prepares rollbackkit and demo schemas before seeding fixture data', async () => {
        const client = new RecordingClient();

        await seedDemoDatabase(client);

        expect(client.labels).toEqual(['rollbackkit migration', 'demo migration', 'seed']);
    });

    it('rejects drifted pre-existing demo schema before marking migration applied', async () => {
        const client = new DriftedDemoSchemaClient([]);

        await expect(migrateDemoSchema(client)).rejects.toThrow(
            'Demo schema migration "0001_demo_schema" cannot be marked applied',
        );
        expect(
            client.statements.some((statement) =>
                statement.includes('INSERT INTO demo_schema_migrations'),
            ),
        ).toBe(false);
    });

    it('rejects drifted applied demo schema before skipping migration', async () => {
        const sql = await readDemoSql('db/schema.sql');
        const checksum = `sha256:${createHash('sha256').update(sql).digest('hex')}`;
        const client = new DriftedDemoSchemaClient([
            {
                id: '0001_demo_schema',
                checksum,
            },
        ]);

        await expect(migrateDemoSchema(client)).rejects.toThrow(
            'Demo schema migration "0001_demo_schema" cannot be marked applied',
        );
        expect(client.statements).not.toContain('BEGIN');
    });
});

class RecordingClient {
    readonly labels: string[] = [];

    async query(sql: string) {
        if (sql.includes('CREATE TABLE IF NOT EXISTS rollbackkit_action_runs')) {
            this.labels.push('rollbackkit migration');
        } else if (sql.includes('CREATE TABLE IF NOT EXISTS demo_schema_migrations')) {
            this.labels.push('demo migration');
        } else if (sql.includes('INSERT INTO demo_workspaces')) {
            this.labels.push('seed');
        }

        if (sql.includes('information_schema.columns')) {
            return {
                rows: expectedDemoColumnRows(),
            };
        }

        return { rows: [] };
    }
}

class DriftedDemoSchemaClient {
    readonly statements: string[] = [];

    constructor(
        private readonly appliedRows: ReadonlyArray<{
            readonly id: string;
            readonly checksum: string;
        }>,
    ) {}

    async query(sql: string) {
        this.statements.push(sql.trim());

        if (sql.includes('SELECT id, checksum')) {
            return {
                rows: this.appliedRows,
            };
        }

        if (sql.includes('information_schema.columns')) {
            return {
                rows: [
                    { table_name: 'demo_workspaces', column_name: 'id' },
                    { table_name: 'demo_workspaces', column_name: 'slug' },
                    { table_name: 'demo_workspaces', column_name: 'name' },
                    { table_name: 'demo_workspaces', column_name: 'created_at' },
                ],
            };
        }

        return {
            rows: [],
        };
    }
}

function expectedDemoColumnRows() {
    return [
        { table_name: 'demo_workspaces', column_name: 'id' },
        { table_name: 'demo_workspaces', column_name: 'slug' },
        { table_name: 'demo_workspaces', column_name: 'name' },
        { table_name: 'demo_workspaces', column_name: 'created_at' },
        { table_name: 'demo_members', column_name: 'id' },
        { table_name: 'demo_members', column_name: 'workspace_id' },
        { table_name: 'demo_members', column_name: 'name' },
        { table_name: 'demo_members', column_name: 'email' },
        { table_name: 'demo_members', column_name: 'role' },
        { table_name: 'demo_members', column_name: 'created_at' },
        { table_name: 'demo_projects', column_name: 'id' },
        { table_name: 'demo_projects', column_name: 'workspace_id' },
        { table_name: 'demo_projects', column_name: 'name' },
        { table_name: 'demo_projects', column_name: 'owner_member_id' },
        { table_name: 'demo_projects', column_name: 'status' },
        { table_name: 'demo_projects', column_name: 'archived_at' },
        { table_name: 'demo_projects', column_name: 'updated_at' },
        { table_name: 'demo_projects', column_name: 'created_at' },
        { table_name: 'demo_documents', column_name: 'id' },
        { table_name: 'demo_documents', column_name: 'workspace_id' },
        { table_name: 'demo_documents', column_name: 'project_id' },
        { table_name: 'demo_documents', column_name: 'owner_member_id' },
        { table_name: 'demo_documents', column_name: 'title' },
        { table_name: 'demo_documents', column_name: 'state' },
        { table_name: 'demo_documents', column_name: 'archived_at' },
        { table_name: 'demo_documents', column_name: 'updated_at' },
        { table_name: 'demo_documents', column_name: 'created_at' },
    ];
}
