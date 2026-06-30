import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import {
    type CliWriter,
    createRollbackKitCliProgram,
    type RollbackKitCliPostgresClient,
    rollbackkitCliVersion,
} from '../../src/program';

interface RecordedQuery {
    readonly text: string;
    readonly values?: unknown[];
}

interface FakeAppliedMigrationRow extends QueryResultRow {
    readonly id: string;
    readonly applied_at: Date | string;
}

class MemoryWriter implements CliWriter {
    output = '';

    write(text: string): void {
        this.output += text;
    }
}

class FakePostgresClient implements RollbackKitCliPostgresClient {
    readonly queries: RecordedQuery[] = [];
    readonly appliedRows: FakeAppliedMigrationRow[];

    connected = false;
    ended = false;
    schemaMigrationsTableExists: boolean;

    constructor(
        appliedRows: readonly FakeAppliedMigrationRow[] = [],
        options: { readonly schemaMigrationsTableExists?: boolean } = {},
    ) {
        this.appliedRows = [...appliedRows];
        this.schemaMigrationsTableExists =
            options.schemaMigrationsTableExists ?? appliedRows.length > 0;
    }

    async connect(): Promise<void> {
        this.connected = true;
    }

    async end(): Promise<void> {
        this.ended = true;
    }

    async query<TResult extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: unknown[],
    ): Promise<QueryResult<TResult>> {
        this.queries.push(values === undefined ? { text } : { text, values });

        if (text.includes("to_regclass('rollbackkit_schema_migrations')")) {
            return createQueryResult([
                {
                    table_name: this.schemaMigrationsTableExists
                        ? 'rollbackkit_schema_migrations'
                        : null,
                },
            ] as unknown as TResult[]);
        }

        if (text.includes('CREATE TABLE IF NOT EXISTS rollbackkit_schema_migrations')) {
            this.schemaMigrationsTableExists = true;

            return createQueryResult([]);
        }

        if (text.includes('SELECT id, applied_at')) {
            return createQueryResult(this.appliedRows as unknown as TResult[]);
        }

        if (text.includes('INSERT INTO rollbackkit_schema_migrations') && values !== undefined) {
            const id = String(values[0]);

            if (!this.appliedRows.some((row) => row.id === id)) {
                this.appliedRows.push({
                    id,
                    applied_at: new Date('2026-01-01T00:00:00.000Z'),
                });
            }
        }

        return createQueryResult([]);
    }
}

describe('@rollbackkit/cli', () => {
    it('exports package version placeholder', () => {
        expect(rollbackkitCliVersion).toBe('0.0.0');
    });

    it('applies PostgreSQL migrations', async () => {
        const stdout = new MemoryWriter();
        const client = new FakePostgresClient();

        const program = createRollbackKitCliProgram({
            stdout,
            env: {},
            createPostgresClient: () => client,
        });

        await program.parseAsync(
            ['node', 'rollbackkit', 'migrate', '--database-url', 'postgres://test'],
            {
                from: 'node',
            },
        );

        expect(client.connected).toBe(true);
        expect(client.ended).toBe(true);
        expect(stdout.output).toContain('Applied 2 RollbackKit PostgreSQL migration(s):');
        expect(stdout.output).toContain('- 0001_initial_schema:');
        expect(stdout.output).toContain('- 0002_action_run_idempotency:');

        expect(client.queries.some((query) => query.text.trim() === 'BEGIN')).toBe(true);
        expect(client.queries.some((query) => query.text.trim() === 'COMMIT')).toBe(true);
    });

    it('reports already applied PostgreSQL migrations', async () => {
        const stdout = new MemoryWriter();
        const client = new FakePostgresClient([
            {
                id: '0001_initial_schema',
                applied_at: new Date('2026-01-01T00:00:00.000Z'),
            },
            {
                id: '0002_action_run_idempotency',
                applied_at: new Date('2026-01-01T00:00:01.000Z'),
            },
        ]);

        const program = createRollbackKitCliProgram({
            stdout,
            env: {},
            createPostgresClient: () => client,
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
        const client = new FakePostgresClient();

        const program = createRollbackKitCliProgram({
            stdout,
            env: {},
            createPostgresClient: () => client,
        });

        await program.parseAsync(
            ['node', 'rollbackkit', 'doctor', '--database-url', 'postgres://test'],
            {
                from: 'node',
            },
        );

        expect(client.connected).toBe(true);
        expect(client.ended).toBe(true);
        expect(stdout.output).toContain('RollbackKit PostgreSQL doctor');
        expect(stdout.output).toContain('Database: connected');
        expect(stdout.output).toContain('Schema: 2 pending migration(s)');
        expect(stdout.output).toContain('- 0001_initial_schema:');
        expect(stdout.output).toContain('- 0002_action_run_idempotency:');
        expect(
            client.queries.some((query) =>
                query.text.includes('CREATE TABLE IF NOT EXISTS rollbackkit_schema_migrations'),
            ),
        ).toBe(false);
    });

    it('reads database url from environment', async () => {
        const stdout = new MemoryWriter();
        const client = new FakePostgresClient();

        let receivedDatabaseUrl: string | undefined;

        const program = createRollbackKitCliProgram({
            stdout,
            env: {
                ROLLBACKKIT_DATABASE_URL: 'postgres://env-url',
            },
            createPostgresClient: (databaseUrl) => {
                receivedDatabaseUrl = databaseUrl;

                return client;
            },
        });

        await program.parseAsync(['node', 'rollbackkit', 'doctor'], {
            from: 'node',
        });

        expect(receivedDatabaseUrl).toBe('postgres://env-url');
    });

    it('requires a database url for PostgreSQL commands', async () => {
        const stdout = new MemoryWriter();

        const program = createRollbackKitCliProgram({
            stdout,
            env: {},
            createPostgresClient: () => new FakePostgresClient(),
        });

        await expect(
            program.parseAsync(['node', 'rollbackkit', 'doctor'], {
                from: 'node',
            }),
        ).rejects.toThrow(
            'Missing PostgreSQL database URL. Pass --database-url or set ROLLBACKKIT_DATABASE_URL / DATABASE_URL.',
        );
    });
});

function createQueryResult<TResult extends QueryResultRow>(rows: TResult[]): QueryResult<TResult> {
    return {
        command: '',
        rowCount: rows.length,
        oid: 0,
        fields: [],
        rows,
    };
}
