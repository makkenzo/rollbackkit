import { randomUUID } from 'node:crypto';

import {
    type ActionActor,
    createRollbackKit,
    defineAction,
    REVERSIBILITY,
} from '@rollbackkit/core';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { createPostgresMigrationRunner } from './migration-runner';
import { createPostgresStore } from './store';

const DATABASE_URL = process.env.ROLLBACKKIT_POSTGRES_TEST_DATABASE_URL;
const describeIntegration = DATABASE_URL === undefined ? describe.skip : describe;

const actor: ActionActor = {
    id: 'user_1',
    type: 'user',
    displayName: 'Test User',
};

const undoActor: ActionActor = {
    id: 'user_2',
    type: 'user',
    displayName: 'Undo User',
};

describeIntegration('PostgreSQL integration', () => {
    it('applies migrations on a real PostgreSQL database', async () => {
        const context = await createPostgresTestContext();

        try {
            const runner = createPostgresMigrationRunner({
                executor: context.client,
            });

            const firstResult = await runner.migrate();

            expect(firstResult.applied.map((migration) => migration.id)).toEqual([
                '0001_initial_schema',
            ]);
            expect(firstResult.skipped).toEqual([]);

            const secondResult = await runner.migrate();

            expect(secondResult.applied).toEqual([]);
            expect(secondResult.skipped.map((migration) => migration.id)).toEqual([
                '0001_initial_schema',
            ]);

            const tables = await context.client.query<{ readonly table_name: string }>(
                `
SELECT table_name
FROM information_schema.tables
WHERE table_schema = $1
ORDER BY table_name ASC
`,
                [context.schemaName],
            );

            expect(tables.rows.map((row) => row.table_name)).toEqual([
                'rollbackkit_action_runs',
                'rollbackkit_conflicts',
                'rollbackkit_schema_migrations',
                'rollbackkit_side_effects',
                'rollbackkit_snapshots',
            ]);
        } finally {
            await context.cleanup();
        }
    });

    it('runs execute and undo lifecycle against real PostgreSQL storage', async () => {
        const context = await createPostgresTestContext();

        try {
            const now = new Date('2026-01-01T00:00:00.000Z');
            const clock = {
                now: () => now,
            };

            await createPostgresMigrationRunner({
                executor: context.client,
            }).migrate();

            const store = createPostgresStore({
                executor: context.client,
                clock,
            });

            let archived = false;

            const kit = createRollbackKit({
                storage: store,
                clock,
                actions: [
                    defineAction({
                        name: 'project.archive',
                        reversibility: REVERSIBILITY.full,
                        undoWindowMs: 60_000,
                        preview: async () => ({
                            title: 'Archive project',
                            impact: [],
                            reversibility: REVERSIBILITY.full,
                        }),
                        execute: async (executeContext) => {
                            await executeContext.snapshots.save('previousProjectState', {
                                archived,
                            });

                            archived = true;

                            return {
                                data: {
                                    archived,
                                },
                            };
                        },
                        undo: async (undoContext) => {
                            const snapshot = await undoContext.snapshots.get<{
                                readonly archived: boolean;
                            }>('previousProjectState');

                            if (snapshot === null) {
                                throw new Error('Expected previousProjectState snapshot.');
                            }

                            archived = snapshot.value.archived;

                            return {
                                data: {
                                    archived,
                                },
                            };
                        },
                    }),
                ],
            });

            const run = await kit.execute({
                name: 'project.archive',
                actor,
                tenantId: 'tenant_1',
                target: {
                    id: 'project_1',
                    type: 'project',
                    label: 'Demo Project',
                },
                input: {
                    projectId: 'project_1',
                },
            });

            expect(archived).toBe(true);

            expect(run).toMatchObject({
                id: expect.stringMatching(/^run_/),
                name: 'project.archive',
                status: 'completed',
                actor,
                tenantId: 'tenant_1',
                target: {
                    id: 'project_1',
                    type: 'project',
                    label: 'Demo Project',
                },
                input: {
                    projectId: 'project_1',
                },
                reversibility: REVERSIBILITY.full,
                createdAt: now,
                executedAt: now,
                undoExpiresAt: new Date('2026-01-01T00:01:00.000Z'),
                result: {
                    archived: true,
                },
            });

            await expect(store.getSnapshots(run.id)).resolves.toMatchObject([
                {
                    actionRunId: run.id,
                    key: 'previousProjectState',
                    value: {
                        archived: false,
                    },
                    createdAt: now,
                },
            ]);

            const undone = await kit.undo({
                actionRunId: run.id,
                actor: undoActor,
            });

            expect(archived).toBe(false);

            expect(undone).toMatchObject({
                id: run.id,
                name: 'project.archive',
                status: 'undone',
                actor,
                tenantId: 'tenant_1',
                undoneAt: now,
                undoneBy: undoActor,
                undoResult: {
                    archived: false,
                },
            });

            await expect(store.getActionRun(run.id)).resolves.toMatchObject({
                id: run.id,
                status: 'undone',
                undoResult: {
                    archived: false,
                },
            });
        } finally {
            await context.cleanup();
        }
    });
});

interface PostgresTestContext {
    readonly client: Client;
    readonly schemaName: string;
    cleanup(): Promise<void>;
}

async function createPostgresTestContext(): Promise<PostgresTestContext> {
    if (DATABASE_URL === undefined) {
        throw new Error('ROLLBACKKIT_POSTGRES_TEST_DATABASE_URL is required.');
    }

    const client = new Client({
        connectionString: DATABASE_URL,
    });

    await client.connect();

    const schemaName = `rollbackkit_test_${randomUUID().replaceAll('-', '_')}`;

    try {
        await client.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
        await client.query(`SET search_path TO ${quoteIdentifier(schemaName)}`);

        return {
            client,
            schemaName,
            cleanup: async () => {
                await client
                    .query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`)
                    .catch(() => undefined);

                await client.end().catch(() => undefined);
            },
        };
    } catch (error) {
        await client.end().catch(() => undefined);

        throw error;
    }
}

function quoteIdentifier(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`;
}
