import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import * as publicApi from '../../src/index';
import {
    createPostgresMigrationRunner,
    ROLLBACKKIT_POSTGRES_MIGRATIONS,
    RollbackKitPostgresMigrationError,
    rollbackkitPostgresVersion,
} from '../../src/index';
import { FakePostgresExecutor } from '../helpers/fake-postgres-executor';

describe('@rollbackkit/postgres', () => {
    it('exports package version placeholder', () => {
        expect(rollbackkitPostgresVersion).toBe('0.0.0');
    });

    it('does not expose storage internals from the package root', () => {
        expect(publicApi).not.toHaveProperty('createRollbackKitPostgresId');
        expect(publicApi).not.toHaveProperty('mapActionRunRow');
        expect(publicApi).not.toHaveProperty('initialSchemaMigration');
        expect(publicApi).not.toHaveProperty('actionRunIdempotencyMigration');
    });

    it('exports initial migrations', () => {
        const [migration] = ROLLBACKKIT_POSTGRES_MIGRATIONS;

        if (migration === undefined) {
            throw new Error('Expected at least one PostgreSQL migration.');
        }

        expect(migration.id).toBe('0001_initial_schema');
        expect(migration.sql).toContain('CREATE TABLE IF NOT EXISTS rollbackkit_action_runs');
        expect(migration.sql).toContain('CREATE TABLE IF NOT EXISTS rollbackkit_snapshots');
        expect(migration.sql).toContain('CREATE TABLE IF NOT EXISTS rollbackkit_side_effects');
        expect(migration.sql).toContain('CREATE TABLE IF NOT EXISTS rollbackkit_conflicts');
    });

    it('exports idempotency migration', () => {
        const migration = ROLLBACKKIT_POSTGRES_MIGRATIONS.find(
            (candidate) => candidate.id === '0002_action_run_idempotency',
        );

        expect(migration).toBeDefined();
        expect(migration?.sql).toContain('ADD COLUMN IF NOT EXISTS idempotency_key text');
        expect(migration?.sql).toContain('rollbackkit_action_runs_tenant_idempotency_idx');
        expect(migration?.sql).toContain('rollbackkit_action_runs_global_idempotency_idx');
    });

    it('applies pending migrations and records them', async () => {
        const executor = new FakePostgresExecutor();
        const runner = createPostgresMigrationRunner({ executor });

        const result = await runner.migrate();

        expect(result.applied.map((migration) => migration.id)).toEqual([
            '0001_initial_schema',
            '0002_action_run_idempotency',
        ]);
        expect(result.skipped).toEqual([]);

        expect(executor.queries.some((query) => query.text.includes('BEGIN'))).toBe(true);
        expect(
            executor.queries.some((query) =>
                query.text.includes('LOCK TABLE rollbackkit_schema_migrations'),
            ),
        ).toBe(true);
        expect(
            executor.queries.some((query) =>
                query.text.includes('CREATE TABLE IF NOT EXISTS rollbackkit_action_runs'),
            ),
        ).toBe(true);
        expect(
            executor.queries.some((query) =>
                query.text.includes('INSERT INTO rollbackkit_schema_migrations'),
            ),
        ).toBe(true);
        expect(executor.queries.some((query) => query.text.includes('COMMIT'))).toBe(true);
    });

    it('plans pending migrations without creating the schema migrations table', async () => {
        const executor = new FakePostgresExecutor();
        const runner = createPostgresMigrationRunner({ executor });

        const status = await runner.getMigrationStatus();

        expect(status.schemaTableExists).toBe(false);
        expect(status.applied).toEqual([]);
        expect(status.skipped).toEqual([]);
        expect(status.pending.map((migration) => migration.id)).toEqual([
            '0001_initial_schema',
            '0002_action_run_idempotency',
        ]);
        expect(
            executor.queries.some((query) =>
                query.text.includes('CREATE TABLE IF NOT EXISTS rollbackkit_schema_migrations'),
            ),
        ).toBe(false);
    });

    it('plans migration status from an existing schema migrations table', async () => {
        const executor = new FakePostgresExecutor(
            [
                {
                    id: '0001_initial_schema',
                    applied_at: '2026-01-01T00:00:00.000Z',
                },
            ],
            {
                schemaMigrationsTableExists: true,
            },
        );

        const runner = createPostgresMigrationRunner({ executor });

        const status = await runner.getMigrationStatus();

        expect(status.schemaTableExists).toBe(true);
        expect(status.applied).toEqual([
            {
                id: '0001_initial_schema',
                appliedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
        ]);
        expect(status.skipped.map((migration) => migration.id)).toEqual(['0001_initial_schema']);
        expect(status.pending.map((migration) => migration.id)).toEqual([
            '0002_action_run_idempotency',
        ]);
    });

    it('rechecks pending migrations after acquiring the migration lock', async () => {
        class ConcurrentMigrationExecutor extends FakePostgresExecutor {
            override async query<TResult extends QueryResultRow = QueryResultRow>(
                text: string,
                values?: unknown[],
            ): Promise<QueryResult<TResult>> {
                const result = await super.query<TResult>(text, values);

                if (text.includes('LOCK TABLE rollbackkit_schema_migrations')) {
                    for (const migration of ROLLBACKKIT_POSTGRES_MIGRATIONS) {
                        this.schemaMigrationRows.push({
                            id: migration.id,
                            applied_at: new Date('2026-01-01T00:00:00.000Z'),
                        });
                    }
                }

                return result;
            }
        }

        const executor = new ConcurrentMigrationExecutor();
        const runner = createPostgresMigrationRunner({ executor });

        const result = await runner.migrate();

        expect(result.applied).toEqual([]);
        expect(result.skipped.map((migration) => migration.id)).toEqual([
            '0001_initial_schema',
            '0002_action_run_idempotency',
        ]);
        expect(
            executor.queries.some((query) =>
                query.text.includes('CREATE TABLE IF NOT EXISTS rollbackkit_action_runs'),
            ),
        ).toBe(false);
        expect(executor.queries.some((query) => query.text.trim() === 'COMMIT')).toBe(true);
    });

    it('skips already applied migrations', async () => {
        const executor = new FakePostgresExecutor([
            {
                id: '0001_initial_schema',
                applied_at: new Date('2026-01-01T00:00:00.000Z'),
            },
            {
                id: '0002_action_run_idempotency',
                applied_at: new Date('2026-01-01T00:00:01.000Z'),
            },
        ]);

        const runner = createPostgresMigrationRunner({ executor });

        const result = await runner.migrate();

        expect(result.applied).toEqual([]);
        expect(result.skipped.map((migration) => migration.id)).toEqual([
            '0001_initial_schema',
            '0002_action_run_idempotency',
        ]);
        expect(executor.queries.some((query) => query.text === 'BEGIN')).toBe(false);
    });

    it('reads applied migrations', async () => {
        const executor = new FakePostgresExecutor([
            {
                id: '0001_initial_schema',
                applied_at: '2026-01-01T00:00:00.000Z',
            },
        ]);

        const runner = createPostgresMigrationRunner({ executor });

        await expect(runner.getAppliedMigrations()).resolves.toEqual([
            {
                id: '0001_initial_schema',
                appliedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
        ]);
    });

    it('rejects duplicate migration ids', () => {
        const executor = new FakePostgresExecutor();
        const [migration] = ROLLBACKKIT_POSTGRES_MIGRATIONS;

        if (migration === undefined) {
            throw new Error('Expected at least one PostgreSQL migration.');
        }

        expect(() =>
            createPostgresMigrationRunner({
                executor,
                migrations: [migration, migration],
            }),
        ).toThrow(RollbackKitPostgresMigrationError);
    });
});
