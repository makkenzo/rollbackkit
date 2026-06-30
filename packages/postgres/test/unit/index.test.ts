import { describe, expect, it } from 'vitest';

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

    it('applies pending migrations and records them', async () => {
        const executor = new FakePostgresExecutor();
        const runner = createPostgresMigrationRunner({ executor });

        const result = await runner.migrate();

        expect(result.applied.map((migration) => migration.id)).toEqual(['0001_initial_schema']);
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

    it('skips already applied migrations', async () => {
        const executor = new FakePostgresExecutor([
            {
                id: '0001_initial_schema',
                applied_at: new Date('2026-01-01T00:00:00.000Z'),
            },
        ]);

        const runner = createPostgresMigrationRunner({ executor });

        const result = await runner.migrate();

        expect(result.applied).toEqual([]);
        expect(result.skipped.map((migration) => migration.id)).toEqual(['0001_initial_schema']);
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
