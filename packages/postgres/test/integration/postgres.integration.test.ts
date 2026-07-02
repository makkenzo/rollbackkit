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
import {
    actionRunIdempotencyMigration,
    auditInvariantsMigration,
    initialSchemaMigration,
} from '../../src/migrations';
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
                '0003_audit_invariants',
                '0004_validate_audit_invariants',
            ]);
            expect(firstResult.skipped).toEqual([]);

            const secondResult = await runner.migrate();

            expect(secondResult.applied).toEqual([]);
            expect(secondResult.skipped.map((migration) => migration.id)).toEqual([
                '0001_initial_schema',
                '0002_action_run_idempotency',
                '0003_audit_invariants',
                '0004_validate_audit_invariants',
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

            const constraints = await context.client.query<{
                readonly conname: string;
                readonly convalidated: boolean;
            }>(
                `
SELECT conname, convalidated
FROM pg_constraint
WHERE connamespace = $1::regnamespace
    AND conname IN (
        'rollbackkit_action_runs_actor_consistency_check',
        'rollbackkit_action_runs_status_check',
        'rollbackkit_action_runs_target_consistency_check',
        'rollbackkit_side_effects_status_check'
    )
ORDER BY conname ASC
`,
                [context.schemaName],
            );

            expect(constraints.rows).toEqual([
                {
                    conname: 'rollbackkit_action_runs_actor_consistency_check',
                    convalidated: true,
                },
                {
                    conname: 'rollbackkit_action_runs_status_check',
                    convalidated: true,
                },
                {
                    conname: 'rollbackkit_action_runs_target_consistency_check',
                    convalidated: true,
                },
                {
                    conname: 'rollbackkit_side_effects_status_check',
                    convalidated: true,
                },
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
                '0003_audit_invariants',
                '0004_validate_audit_invariants',
            ]);

            const result = await runner.migrate();

            expect(result.applied.map((migration) => migration.id)).toEqual([
                '0002_action_run_idempotency',
                '0003_audit_invariants',
                '0004_validate_audit_invariants',
            ]);
            expect(result.skipped.map((migration) => migration.id)).toEqual([
                '0001_initial_schema',
            ]);

            const statusAfter = await runner.getMigrationStatus();

            expect(statusAfter.pending).toEqual([]);
            expect(statusAfter.skipped.map((migration) => migration.id)).toEqual([
                '0001_initial_schema',
                '0002_action_run_idempotency',
                '0003_audit_invariants',
                '0004_validate_audit_invariants',
            ]);
        } finally {
            await context.cleanup();
        }
    });

    it('validates audit constraints when upgrading from a database already at 0003', async () => {
        const context = await createPostgresTestContext();

        try {
            const bootstrapRunner = createPostgresMigrationRunner({
                executor: context.client,
                migrations: [
                    initialSchemaMigration,
                    actionRunIdempotencyMigration,
                    auditInvariantsMigration,
                ],
            });

            await bootstrapRunner.migrate();

            await expect(readAuditConstraintValidation(context.client)).resolves.toEqual([
                {
                    conname: 'rollbackkit_action_runs_actor_consistency_check',
                    convalidated: false,
                },
                {
                    conname: 'rollbackkit_action_runs_status_check',
                    convalidated: false,
                },
                {
                    conname: 'rollbackkit_action_runs_target_consistency_check',
                    convalidated: false,
                },
                {
                    conname: 'rollbackkit_side_effects_status_check',
                    convalidated: false,
                },
            ]);

            const runner = createPostgresMigrationRunner({
                executor: context.client,
            });
            const statusBefore = await runner.getMigrationStatus();

            expect(statusBefore.skipped.map((migration) => migration.id)).toEqual([
                '0001_initial_schema',
                '0002_action_run_idempotency',
                '0003_audit_invariants',
            ]);
            expect(statusBefore.pending.map((migration) => migration.id)).toEqual([
                '0004_validate_audit_invariants',
            ]);

            const result = await runner.migrate();

            expect(result.applied.map((migration) => migration.id)).toEqual([
                '0004_validate_audit_invariants',
            ]);
            expect(result.skipped.map((migration) => migration.id)).toEqual([
                '0001_initial_schema',
                '0002_action_run_idempotency',
                '0003_audit_invariants',
            ]);
            await expect(readAuditConstraintValidation(context.client)).resolves.toEqual([
                {
                    conname: 'rollbackkit_action_runs_actor_consistency_check',
                    convalidated: true,
                },
                {
                    conname: 'rollbackkit_action_runs_status_check',
                    convalidated: true,
                },
                {
                    conname: 'rollbackkit_action_runs_target_consistency_check',
                    convalidated: true,
                },
                {
                    conname: 'rollbackkit_side_effects_status_check',
                    convalidated: true,
                },
            ]);
        } finally {
            await context.cleanup();
        }
    });

    it('serializes concurrent migration runners on a real PostgreSQL database', async () => {
        const context = await createPostgresTestContext();
        const secondClient = await context.createClient();

        try {
            const firstRunner = createPostgresMigrationRunner({
                executor: context.client,
            });
            const secondRunner = createPostgresMigrationRunner({
                executor: secondClient,
            });

            const results = await Promise.all([firstRunner.migrate(), secondRunner.migrate()]);

            expect(results.filter((result) => result.applied.length === 4)).toHaveLength(1);
            expect(results.filter((result) => result.applied.length === 0)).toHaveLength(1);
            expect(
                results.every(
                    (result) => result.applied.length === 4 || result.skipped.length === 4,
                ),
            ).toBe(true);

            const appliedRows = await context.client.query<{
                readonly id: string;
                readonly migration_count: number;
            }>(
                `
SELECT id, COUNT(*)::int AS migration_count
FROM rollbackkit_schema_migrations
GROUP BY id
ORDER BY id ASC
`,
            );

            expect(appliedRows.rows).toEqual([
                {
                    id: '0001_initial_schema',
                    migration_count: 1,
                },
                {
                    id: '0002_action_run_idempotency',
                    migration_count: 1,
                },
                {
                    id: '0003_audit_invariants',
                    migration_count: 1,
                },
                {
                    id: '0004_validate_audit_invariants',
                    migration_count: 1,
                },
            ]);
        } finally {
            await secondClient.end().catch(() => undefined);
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

    it('deduplicates concurrent idempotent claims on a real PostgreSQL database', async () => {
        const context = await createPostgresTestContext();
        const secondClient = await context.createClient();

        try {
            const now = new Date('2026-01-01T00:00:00.000Z');
            const clock = {
                now: () => now,
            };

            await createPostgresMigrationRunner({
                executor: context.client,
            }).migrate();

            const firstStore = createPostgresStore({
                executor: context.client,
                clock,
            });
            const secondStore = createPostgresStore({
                executor: secondClient,
                clock,
            });

            const claimInput = {
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
                inputHash: 'fnv1a64:hash_1',
                idempotencyKey: 'request_1',
                reversibility: REVERSIBILITY.full,
            } as const;

            const results = await Promise.all([
                firstStore.claimActionRun(claimInput),
                secondStore.claimActionRun(claimInput),
            ]);

            expect(results.filter((result) => result.created)).toHaveLength(1);
            expect(results.filter((result) => !result.created)).toHaveLength(1);
            expect(new Set(results.map((result) => result.run.id)).size).toBe(1);
            expect(results[0]?.run).toEqual(results[1]?.run);

            const actionRunCount = await context.client.query<{
                readonly action_run_count: number;
            }>(
                `
SELECT COUNT(*)::int AS action_run_count
FROM rollbackkit_action_runs
WHERE idempotency_key = $1
`,
                [claimInput.idempotencyKey],
            );

            expect(actionRunCount.rows[0]?.action_run_count).toBe(1);
        } finally {
            await secondClient.end().catch(() => undefined);
            await context.cleanup();
        }
    });

    it('serializes concurrent action run locks on a real PostgreSQL database', async () => {
        const context = await createPostgresTestContext();
        const secondClient = await context.createClient();

        try {
            await createPostgresMigrationRunner({
                executor: context.client,
            }).migrate();

            const firstStore = createPostgresStore({
                executor: context.client,
            });
            const secondStore = createPostgresStore({
                executor: secondClient,
            });
            const run = await firstStore.createActionRun({
                name: 'project.archive',
                actor,
                input: {
                    projectId: 'project_1',
                },
                reversibility: REVERSIBILITY.full,
            });
            const firstLocked = createDeferred();
            const releaseFirst = createDeferred();
            const lockEvents: string[] = [];

            const firstLock = firstStore.withActionRunLock(run.id, async () => {
                lockEvents.push('first:locked');
                firstLocked.resolve();
                await releaseFirst.promise;
                lockEvents.push('first:released');

                return 'first';
            });

            await firstLocked.promise;

            let secondEntered = false;
            const secondLock = secondStore.withActionRunLock(run.id, async () => {
                secondEntered = true;
                lockEvents.push('second:locked');

                return 'second';
            });

            try {
                await delay(50);
                expect(secondEntered).toBe(false);
            } finally {
                releaseFirst.resolve();
            }

            await expect(Promise.all([firstLock, secondLock])).resolves.toEqual([
                'first',
                'second',
            ]);
            expect(lockEvents).toEqual(['first:locked', 'first:released', 'second:locked']);
        } finally {
            await secondClient.end().catch(() => undefined);
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
                tenantId: 'tenant_1',
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
    createClient(): Promise<Client>;
    cleanup(): Promise<void>;
}

async function createPostgresTestContext(): Promise<PostgresTestContext> {
    if (DATABASE_URL === undefined) {
        throw new Error('ROLLBACKKIT_POSTGRES_TEST_DATABASE_URL is required.');
    }

    const client = new Client({
        connectionString: getPostgresTestDatabaseUrl(),
    });

    await client.connect();

    const schemaName = `rollbackkit_test_${randomUUID().replaceAll('-', '_')}`;

    try {
        await client.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
        await client.query(`SET search_path TO ${quoteIdentifier(schemaName)}`);

        return {
            client,
            schemaName,
            createClient: () => createPostgresTestClient(schemaName),
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

async function createPostgresTestClient(schemaName: string): Promise<Client> {
    const client = new Client({
        connectionString: getPostgresTestDatabaseUrl(),
    });

    await client.connect();
    await client.query(`SET search_path TO ${quoteIdentifier(schemaName)}`);

    return client;
}

async function readAuditConstraintValidation(client: Client): Promise<
    readonly {
        readonly conname: string;
        readonly convalidated: boolean;
    }[]
> {
    const result = await client.query<{
        readonly conname: string;
        readonly convalidated: boolean;
    }>(
        `
SELECT conname, convalidated
FROM pg_constraint
WHERE connamespace = current_schema()::regnamespace
    AND conname IN (
        'rollbackkit_action_runs_actor_consistency_check',
        'rollbackkit_action_runs_status_check',
        'rollbackkit_action_runs_target_consistency_check',
        'rollbackkit_side_effects_status_check'
    )
ORDER BY conname ASC
`,
    );

    return result.rows;
}

function getPostgresTestDatabaseUrl(): string {
    if (DATABASE_URL === undefined) {
        throw new Error('ROLLBACKKIT_POSTGRES_TEST_DATABASE_URL is required.');
    }

    return DATABASE_URL;
}

function quoteIdentifier(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`;
}

function createDeferred(): {
    readonly promise: Promise<void>;
    readonly resolve: () => void;
} {
    let resolvePromise: () => void = () => undefined;

    const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
    });

    return {
        promise,
        resolve: resolvePromise,
    };
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
