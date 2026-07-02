import { readFileSync } from 'node:fs';
import type { PostgresMigrationResult, PostgresMigrationStatus } from '@rollbackkit/postgres';
import { describe, expect, it } from 'vitest';

import {
    type CliWriter,
    createRollbackKitCliProgram,
    rollbackkitCliVersion,
    runCli,
} from '../../src/program';

class MemoryWriter implements CliWriter {
    output = '';

    write(text: string): void {
        this.output += text;
    }
}

const pendingMigration = {
    id: '0001_initial_schema',
    description: 'Create RollbackKit tables.',
    sql: 'select 1',
};

const idempotencyMigration = {
    id: '0002_action_run_idempotency',
    description: 'Add idempotency keys.',
    sql: 'select 2',
};

describe('@rollbackkit/cli', () => {
    it('exports package version from package metadata', () => {
        expect(rollbackkitCliVersion).toBe(readPackageVersion());
        expect(
            readFileSync(new URL('../../src/program.ts', import.meta.url), 'utf8'),
        ).not.toContain("rollbackkitCliVersion = '0.0.0'");
    });

    it('applies PostgreSQL migrations', async () => {
        const stdout = new MemoryWriter();
        let receivedDatabaseUrl: string | undefined;

        const program = createRollbackKitCliProgram({
            stdout,
            env: {},
            migratePostgresDatabase: async ({ databaseUrl }) => {
                receivedDatabaseUrl = databaseUrl;

                return {
                    applied: [pendingMigration, idempotencyMigration],
                    skipped: [],
                } satisfies PostgresMigrationResult;
            },
        });

        await program.parseAsync(
            ['node', 'rollbackkit', 'migrate', '--database-url', 'postgres://test'],
            {
                from: 'node',
            },
        );

        expect(receivedDatabaseUrl).toBe('postgres://test');
        expect(stdout.output).toContain('Applied 2 RollbackKit PostgreSQL migration(s):');
        expect(stdout.output).toContain('- 0001_initial_schema:');
        expect(stdout.output).toContain('- 0002_action_run_idempotency:');
    });

    it('reports already applied PostgreSQL migrations', async () => {
        const stdout = new MemoryWriter();

        const program = createRollbackKitCliProgram({
            stdout,
            env: {},
            migratePostgresDatabase: async () =>
                ({
                    applied: [],
                    skipped: [pendingMigration, idempotencyMigration],
                }) satisfies PostgresMigrationResult,
        });

        await program.parseAsync(
            ['node', 'rollbackkit', 'migrate', '--database-url', 'postgres://test'],
            {
                from: 'node',
            },
        );

        expect(stdout.output).toContain('RollbackKit PostgreSQL schema is up to date.');
    });

    it('checks PostgreSQL migration status with doctor', async () => {
        const stdout = new MemoryWriter();
        let receivedDatabaseUrl: string | undefined;

        const program = createRollbackKitCliProgram({
            stdout,
            env: {},
            getPostgresMigrationStatus: async ({ databaseUrl }) => {
                receivedDatabaseUrl = databaseUrl;

                return {
                    schemaTableExists: false,
                    applied: [],
                    skipped: [],
                    pending: [pendingMigration, idempotencyMigration],
                } satisfies PostgresMigrationStatus;
            },
        });

        await program.parseAsync(
            ['node', 'rollbackkit', 'doctor', '--database-url', 'postgres://test'],
            {
                from: 'node',
            },
        );

        expect(receivedDatabaseUrl).toBe('postgres://test');
        expect(stdout.output).toContain('RollbackKit PostgreSQL doctor');
        expect(stdout.output).toContain('Database: connected');
        expect(stdout.output).toContain('Migration table: missing');
        expect(stdout.output).toContain('Schema: 2 pending migration(s)');
        expect(stdout.output).toContain('- 0001_initial_schema:');
        expect(stdout.output).toContain('- 0002_action_run_idempotency:');
    });

    it('reads database url from environment', async () => {
        const stdout = new MemoryWriter();
        let receivedDatabaseUrl: string | undefined;

        const program = createRollbackKitCliProgram({
            stdout,
            env: {
                ROLLBACKKIT_DATABASE_URL: 'postgres://env-url',
            },
            getPostgresMigrationStatus: async ({ databaseUrl }) => {
                receivedDatabaseUrl = databaseUrl;

                return {
                    schemaTableExists: false,
                    applied: [],
                    skipped: [],
                    pending: [],
                } satisfies PostgresMigrationStatus;
            },
        });

        await program.parseAsync(['node', 'rollbackkit', 'doctor'], {
            from: 'node',
        });

        expect(receivedDatabaseUrl).toBe('postgres://env-url');
    });

    it('warns when PostgreSQL commands fall back to DATABASE_URL', async () => {
        const stdout = new MemoryWriter();
        const stderr = new MemoryWriter();

        const program = createRollbackKitCliProgram({
            stdout,
            stderr,
            env: {
                DATABASE_URL: 'postgres://ambient-url',
            },
            getPostgresMigrationStatus: async () =>
                ({
                    schemaTableExists: false,
                    applied: [],
                    skipped: [],
                    pending: [],
                }) satisfies PostgresMigrationStatus,
        });

        await program.parseAsync(['node', 'rollbackkit', 'doctor'], {
            from: 'node',
        });

        expect(stderr.output).toContain(
            'Using DATABASE_URL for RollbackKit CLI. Prefer ROLLBACKKIT_DATABASE_URL or --database-url for schema changes.',
        );
    });

    it('requires a database url for PostgreSQL commands', async () => {
        const stdout = new MemoryWriter();

        const program = createRollbackKitCliProgram({
            stdout,
            env: {},
        });

        await expect(
            program.parseAsync(['node', 'rollbackkit', 'doctor'], {
                from: 'node',
            }),
        ).rejects.toThrow(
            'Missing PostgreSQL database URL. Pass --database-url or set ROLLBACKKIT_DATABASE_URL / DATABASE_URL.',
        );
    });

    it('writes top-level errors to injected stderr and returns a non-zero exit code', async () => {
        const stdout = new MemoryWriter();
        const stderr = new MemoryWriter();

        const exitCode = await runCli({
            argv: ['node', 'rollbackkit', 'doctor'],
            stdout,
            stderr,
            env: {},
        });

        expect(exitCode).toBe(1);
        expect(stdout.output).toBe('');
        expect(stderr.output).toContain(
            'Missing PostgreSQL database URL. Pass --database-url or set ROLLBACKKIT_DATABASE_URL / DATABASE_URL.',
        );
    });

    it('returns a non-zero exit code for parser errors without exiting the process', async () => {
        const stdout = new MemoryWriter();
        const stderr = new MemoryWriter();

        const exitCode = await runCli({
            argv: ['node', 'rollbackkit', 'unknown-command'],
            stdout,
            stderr,
            env: {},
        });

        expect(exitCode).toBe(1);
        expect(stdout.output).toBe('');
        expect(stderr.output).toContain("unknown command 'unknown-command'");
    });

    it('prints nested error causes in verbose mode', async () => {
        const stdout = new MemoryWriter();
        const stderr = new MemoryWriter();
        const rootCause = new Error('socket closed');
        const databaseCause = new Error('connection failed', {
            cause: rootCause,
        });
        const error = new Error('migration failed', {
            cause: databaseCause,
        });

        const exitCode = await runCli({
            argv: [
                'node',
                'rollbackkit',
                '--verbose',
                'migrate',
                '--database-url',
                'postgres://test',
            ],
            stdout,
            stderr,
            env: {},
            migratePostgresDatabase: async () => {
                throw error;
            },
        });

        expect(exitCode).toBe(1);
        expect(stderr.output).toContain('migration failed');
        expect(stderr.output).toContain('Caused by: Error: connection failed');
        expect(stderr.output).toContain('Caused by: Error: socket closed');
    });
});

function readPackageVersion(): string {
    const packageJson = JSON.parse(
        readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
        readonly version: string;
    };

    return packageJson.version;
}
