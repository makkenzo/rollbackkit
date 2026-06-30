import { randomUUID } from 'node:crypto';

import {
    type ActionActor,
    createRollbackKit,
    defineAction,
    REVERSIBILITY,
} from '@rollbackkit/core';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { createPostgresMigrationRunner } from '../../src/migration-runner';
import { initialSchemaMigration } from '../../src/migrations';
import { createPostgresStore } from '../../src/store';

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
                '0002_action_run_idempotency',
            ]);
            expect(firstResult.skipped).toEqual([]);

            const secondResult = await runner.migrate();

            expect(secondResult.applied).toEqual([]);
            expect(secondResult.skipped.map((migration) => migration.id)).toEqual([
                '0001_initial_schema',
                '0002_action_run_idempotency',
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

            const idempotencyIndexes = await context.client.query<{ readonly indexname: string }>(
                `
SELECT indexname
FROM pg_indexes
WHERE schemaname = $1
    AND indexname IN (
        'rollbackkit_action_runs_tenant_idempotency_idx',
        'rollbackkit_action_runs_global_idempotency_idx'
    )
ORDER BY indexname ASC
`,
                [context.schemaName],
            );

            expect(idempotencyIndexes.rows.map((row) => row.indexname)).toEqual([
                'rollbackkit_action_runs_global_idempotency_idx',
                'rollbackkit_action_runs_tenant_idempotency_idx',
            ]);
        } finally {
            await context.cleanup();
        }
    });

    it('applies pending migrations when the database is already at 0001', async () => {
        const context = await createPostgresTestContext();

        try {
            const bootstrapRunner = createPostgresMigrationRunner({
                executor: context.client,
                migrations: [initialSchemaMigration],
            });

            await bootstrapRunner.migrate();

            const runner = createPostgresMigrationRunner({
                executor: context.client,
            });

            const statusBefore = await runner.getMigrationStatus();

            expect(statusBefore.skipped.map((migration) => migration.id)).toEqual([
                '0001_initial_schema',
            ]);
            expect(statusBefore.pending.map((migration) => migration.id)).toEqual([
                '0002_action_run_idempotency',
            ]);

            const result = await runner.migrate();

            expect(result.applied.map((migration) => migration.id)).toEqual([
                '0002_action_run_idempotency',
            ]);
            expect(result.skipped.map((migration) => migration.id)).toEqual([
                '0001_initial_schema',
            ]);

            const statusAfter = await runner.getMigrationStatus();

            expect(statusAfter.pending).toEqual([]);
            expect(statusAfter.skipped.map((migration) => migration.id)).toEqual([
                '0001_initial_schema',
                '0002_action_run_idempotency',
            ]);
        } finally {
            await context.cleanup();
        }
    });

    it('preserves top-level JSON null and arrays as JSONB values', async () => {
        const context = await createPostgresTestContext();

        try {
            await createPostgresMigrationRunner({
                executor: context.client,
            }).migrate();

            const store = createPostgresStore({
                executor: context.client,
            });

            const run = await store.createActionRun({
                name: 'json.null',
                actor,
                input: null,
                reversibility: REVERSIBILITY.full,
            });

            expect(run.input).toBeNull();

            const updated = await store.updateActionRun(run.id, {
                result: null,
                undoResult: [null, { nested: null }],
            });

            expect(updated.result).toBeNull();
            expect(updated.undoResult).toEqual([null, { nested: null }]);

            const snapshot = await store.saveSnapshot({
                actionRunId: run.id,
                key: 'nullableSnapshot',
                value: null,
            });

            expect(snapshot.value).toBeNull();

            const sideEffect = await store.recordSideEffect({
                actionRunId: run.id,
                type: 'json.null',
                status: 'completed',
                reversibility: REVERSIBILITY.irreversible,
                payload: null,
            });

            expect(sideEffect.payload).toBeNull();

            const rawActionRun = await context.client.query<{
                readonly input_is_sql_null: boolean;
                readonly input_json_type: string;
                readonly result_is_sql_null: boolean;
                readonly result_json_type: string;
                readonly undo_result_json_type: string;
            }>(
                `
SELECT
    input IS NULL AS input_is_sql_null,
    jsonb_typeof(input) AS input_json_type,
    result IS NULL AS result_is_sql_null,
    jsonb_typeof(result) AS result_json_type,
    jsonb_typeof(undo_result) AS undo_result_json_type
FROM rollbackkit_action_runs
WHERE id = $1
`,
                [run.id],
            );

            expect(rawActionRun.rows[0]).toEqual({
                input_is_sql_null: false,
                input_json_type: 'null',
                result_is_sql_null: false,
                result_json_type: 'null',
                undo_result_json_type: 'array',
            });

            const rawSnapshot = await context.client.query<{
                readonly value_is_sql_null: boolean;
                readonly value_json_type: string;
            }>(
                `
SELECT
    value IS NULL AS value_is_sql_null,
    jsonb_typeof(value) AS value_json_type
FROM rollbackkit_snapshots
WHERE id = $1
`,
                [snapshot.id],
            );

            expect(rawSnapshot.rows[0]).toEqual({
                value_is_sql_null: false,
                value_json_type: 'null',
            });

            const rawSideEffect = await context.client.query<{
                readonly payload_is_sql_null: boolean;
                readonly payload_json_type: string;
            }>(
                `
SELECT
    payload IS NULL AS payload_is_sql_null,
    jsonb_typeof(payload) AS payload_json_type
FROM rollbackkit_side_effects
WHERE id = $1
`,
                [sideEffect.id],
            );

            expect(rawSideEffect.rows[0]).toEqual({
                payload_is_sql_null: false,
                payload_json_type: 'null',
            });
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
