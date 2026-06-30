import type { QueryResult, QueryResultRow } from 'pg';
import type { RollbackKitPostgresMigration } from './migrations';
import { ROLLBACKKIT_POSTGRES_MIGRATIONS } from './migrations';

const SCHEMA_MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS rollbackkit_schema_migrations (
    id text PRIMARY KEY,
    description text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);
`;

interface AppliedMigrationRow extends QueryResultRow {
    readonly id: string;
    readonly applied_at: Date | string;
}

interface SchemaMigrationTableRow extends QueryResultRow {
    readonly table_name: string | null;
}

export interface PostgresQueryExecutor {
    query<TResult extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: unknown[],
    ): Promise<QueryResult<TResult>>;
}

export interface AppliedPostgresMigration {
    readonly id: string;
    readonly appliedAt: Date;
}

export interface PostgresMigrationResult {
    readonly applied: readonly RollbackKitPostgresMigration[];
    readonly skipped: readonly RollbackKitPostgresMigration[];
}

export interface PostgresMigrationStatus {
    readonly schemaTableExists: boolean;
    readonly applied: readonly AppliedPostgresMigration[];
    readonly skipped: readonly RollbackKitPostgresMigration[];
    readonly pending: readonly RollbackKitPostgresMigration[];
}

export interface PostgresMigrationRunnerOptions {
    readonly executor: PostgresQueryExecutor;
    readonly migrations?: readonly RollbackKitPostgresMigration[];
}

export interface RollbackKitPostgresMigrationErrorOptions {
    readonly migrationId?: string;
    readonly cause?: unknown;
}

export class RollbackKitPostgresMigrationError extends Error {
    readonly migrationId?: string;

    constructor(message: string, options: RollbackKitPostgresMigrationErrorOptions = {}) {
        super(
            message,
            options.cause === undefined
                ? undefined
                : {
                      cause: options.cause,
                  },
        );

        this.name = 'RollbackKitPostgresMigrationError';

        if (options.migrationId !== undefined) {
            this.migrationId = options.migrationId;
        }
    }
}

export class PostgresMigrationRunner {
    readonly #executor: PostgresQueryExecutor;
    readonly #migrations: readonly RollbackKitPostgresMigration[];

    constructor(options: PostgresMigrationRunnerOptions) {
        this.#executor = options.executor;
        this.#migrations = options.migrations ?? ROLLBACKKIT_POSTGRES_MIGRATIONS;

        assertUniqueMigrationIds(this.#migrations);
    }

    async getAppliedMigrations(): Promise<readonly AppliedPostgresMigration[]> {
        await this.#ensureSchemaMigrationsTable();

        return this.#readAppliedMigrations();
    }

    async getMigrationStatus(): Promise<PostgresMigrationStatus> {
        const schemaTableExists = await this.#readSchemaMigrationsTableExists();

        if (!schemaTableExists) {
            return this.#createMigrationStatus([], false);
        }

        return this.#createMigrationStatus(await this.#readAppliedMigrations(), true);
    }

    async migrate(): Promise<PostgresMigrationResult> {
        await this.#ensureSchemaMigrationsTable();

        const status = this.#createMigrationStatus(await this.#readAppliedMigrations(), true);

        if (status.pending.length === 0) {
            return {
                applied: [],
                skipped: status.skipped,
            };
        }

        let currentMigration: RollbackKitPostgresMigration | undefined;

        await this.#executor.query('BEGIN');

        try {
            await this.#executor.query(
                'LOCK TABLE rollbackkit_schema_migrations IN SHARE ROW EXCLUSIVE MODE',
            );

            const lockedStatus = this.#createMigrationStatus(
                await this.#readAppliedMigrations(),
                true,
            );

            if (lockedStatus.pending.length === 0) {
                await this.#executor.query('COMMIT');

                return {
                    applied: [],
                    skipped: lockedStatus.skipped,
                };
            }

            for (const migration of lockedStatus.pending) {
                currentMigration = migration;

                await this.#executor.query(migration.sql);
                await this.#executor.query(
                    `
INSERT INTO rollbackkit_schema_migrations (id, description)
VALUES ($1, $2)
`,
                    [migration.id, migration.description],
                );
            }

            await this.#executor.query('COMMIT');

            return {
                applied: lockedStatus.pending,
                skipped: lockedStatus.skipped,
            };
        } catch (error) {
            await this.#executor.query('ROLLBACK').catch(() => undefined);

            if (error instanceof RollbackKitPostgresMigrationError) {
                throw error;
            }

            const migrationId = currentMigration?.id;

            throw new RollbackKitPostgresMigrationError(
                `Failed to apply RollbackKit PostgreSQL migration${
                    migrationId === undefined ? '' : ` "${migrationId}"`
                }.`,
                {
                    ...(migrationId === undefined ? {} : { migrationId }),
                    cause: error,
                },
            );
        }
    }

    async #ensureSchemaMigrationsTable(): Promise<void> {
        await this.#executor.query(SCHEMA_MIGRATIONS_TABLE_SQL);
    }

    async #readSchemaMigrationsTableExists(): Promise<boolean> {
        const result = await this.#executor.query<SchemaMigrationTableRow>(`
SELECT to_regclass('rollbackkit_schema_migrations')::text AS table_name
`);

        return result.rows[0]?.table_name !== null && result.rows[0]?.table_name !== undefined;
    }

    async #readAppliedMigrations(): Promise<readonly AppliedPostgresMigration[]> {
        const result = await this.#executor.query<AppliedMigrationRow>(`
SELECT id, applied_at
FROM rollbackkit_schema_migrations
ORDER BY id ASC
`);

        return result.rows.map((row) => ({
            id: row.id,
            appliedAt: row.applied_at instanceof Date ? row.applied_at : new Date(row.applied_at),
        }));
    }

    #createMigrationStatus(
        appliedMigrations: readonly AppliedPostgresMigration[],
        schemaTableExists: boolean,
    ): PostgresMigrationStatus {
        const appliedIds = new Set(appliedMigrations.map((migration) => migration.id));

        return {
            schemaTableExists,
            applied: appliedMigrations,
            skipped: this.#migrations.filter((migration) => appliedIds.has(migration.id)),
            pending: this.#migrations.filter((migration) => !appliedIds.has(migration.id)),
        };
    }
}

export function createPostgresMigrationRunner(
    options: PostgresMigrationRunnerOptions,
): PostgresMigrationRunner {
    return new PostgresMigrationRunner(options);
}

function assertUniqueMigrationIds(migrations: readonly RollbackKitPostgresMigration[]): void {
    const seen = new Set<string>();

    for (const migration of migrations) {
        if (seen.has(migration.id)) {
            throw new RollbackKitPostgresMigrationError(
                `Duplicate RollbackKit PostgreSQL migration id "${migration.id}".`,
                {
                    migrationId: migration.id,
                },
            );
        }

        seen.add(migration.id);
    }
}
