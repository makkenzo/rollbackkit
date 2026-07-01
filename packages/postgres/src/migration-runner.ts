import { createHash } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';
import type { RollbackKitPostgresMigration } from './migrations';
import { ROLLBACKKIT_POSTGRES_MIGRATIONS } from './migrations';

const SCHEMA_MIGRATIONS_TABLE_SQL = `
	CREATE TABLE IF NOT EXISTS rollbackkit_schema_migrations (
	    id text PRIMARY KEY,
	    description text NOT NULL,
	    checksum text NOT NULL,
	    applied_at timestamptz NOT NULL DEFAULT now()
	);
	`;

const SCHEMA_MIGRATIONS_CHECKSUM_COLUMN_SQL = `
ALTER TABLE rollbackkit_schema_migrations
    ADD COLUMN IF NOT EXISTS checksum text;
`;

const ROLLBACKKIT_MIGRATION_ADVISORY_LOCK_CLASS_ID = 1_763_074_182;
const ROLLBACKKIT_MIGRATION_ADVISORY_LOCK_OBJECT_ID = 1;

interface AppliedMigrationRow extends QueryResultRow {
    readonly id: string;
    readonly checksum: string | null;
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
    readonly checksum: string;
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
        assertSingleConnectionExecutor(
            options.executor,
            'PostgresMigrationRunner requires a single PostgreSQL connection executor for migration transactions. Do not pass pg.Pool directly.',
        );

        this.#executor = options.executor;
        this.#migrations = options.migrations ?? ROLLBACKKIT_POSTGRES_MIGRATIONS;

        assertUniqueMigrationIds(this.#migrations);
    }

    async getAppliedMigrations(): Promise<readonly AppliedPostgresMigration[]> {
        return this.#withMigrationAdvisoryLock(async () => {
            await this.#ensureSchemaMigrationsTable();

            return this.#readAppliedMigrations();
        });
    }

    async getMigrationStatus(): Promise<PostgresMigrationStatus> {
        return this.#withMigrationAdvisoryLock(async () => {
            const schemaTableExists = await this.#readSchemaMigrationsTableExists();

            if (!schemaTableExists) {
                return this.#createMigrationStatus([], false);
            }

            await this.#ensureSchemaMigrationChecksums();

            return this.#createMigrationStatus(await this.#readAppliedMigrations(), true);
        });
    }

    async migrate(): Promise<PostgresMigrationResult> {
        return this.#withMigrationAdvisoryLock(async () => {
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
	INSERT INTO rollbackkit_schema_migrations (id, description, checksum)
	VALUES ($1, $2, $3)
	`,
                        [migration.id, migration.description, createMigrationChecksum(migration)],
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
        });
    }

    async #ensureSchemaMigrationsTable(): Promise<void> {
        await this.#executor.query(SCHEMA_MIGRATIONS_TABLE_SQL);
        await this.#ensureSchemaMigrationChecksums();
    }

    async #ensureSchemaMigrationChecksums(): Promise<void> {
        await this.#executor.query(SCHEMA_MIGRATIONS_CHECKSUM_COLUMN_SQL);

        for (const migration of this.#migrations) {
            await this.#executor.query(
                `
UPDATE rollbackkit_schema_migrations
SET checksum = $2
WHERE id = $1
  AND (checksum IS NULL OR btrim(checksum) = '')
`,
                [migration.id, createMigrationChecksum(migration)],
            );
        }
    }

    async #readSchemaMigrationsTableExists(): Promise<boolean> {
        const result = await this.#executor.query<SchemaMigrationTableRow>(`
SELECT to_regclass('rollbackkit_schema_migrations')::text AS table_name
`);

        return result.rows[0]?.table_name !== null && result.rows[0]?.table_name !== undefined;
    }

    async #readAppliedMigrations(): Promise<readonly AppliedPostgresMigration[]> {
        const result = await this.#executor.query<AppliedMigrationRow>(`
	SELECT id, checksum, applied_at
	FROM rollbackkit_schema_migrations
	ORDER BY id ASC
	`);

        return result.rows.map((row) => ({
            id: row.id,
            checksum: mapMigrationChecksum(row),
            appliedAt: row.applied_at instanceof Date ? row.applied_at : new Date(row.applied_at),
        }));
    }

    async #withMigrationAdvisoryLock<TValue>(handler: () => Promise<TValue>): Promise<TValue> {
        await this.#executor.query('SELECT pg_advisory_lock($1, $2)', [
            ROLLBACKKIT_MIGRATION_ADVISORY_LOCK_CLASS_ID,
            ROLLBACKKIT_MIGRATION_ADVISORY_LOCK_OBJECT_ID,
        ]);

        try {
            return await handler();
        } finally {
            await this.#executor
                .query('SELECT pg_advisory_unlock($1, $2)', [
                    ROLLBACKKIT_MIGRATION_ADVISORY_LOCK_CLASS_ID,
                    ROLLBACKKIT_MIGRATION_ADVISORY_LOCK_OBJECT_ID,
                ])
                .catch(() => undefined);
        }
    }

    #createMigrationStatus(
        appliedMigrations: readonly AppliedPostgresMigration[],
        schemaTableExists: boolean,
    ): PostgresMigrationStatus {
        assertAppliedMigrationChecksums(appliedMigrations, this.#migrations);

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

export function assertSingleConnectionExecutor(executor: unknown, message: string): void {
    if (isPoolLikeExecutor(executor)) {
        throw new RollbackKitPostgresMigrationError(message);
    }
}

export function createMigrationChecksum(migration: RollbackKitPostgresMigration): string {
    return `sha256:${createHash('sha256').update(migration.sql).digest('hex')}`;
}

function mapMigrationChecksum(row: AppliedMigrationRow): string {
    if (typeof row.checksum === 'string' && row.checksum.trim() !== '') {
        return row.checksum;
    }

    throw new RollbackKitPostgresMigrationError(
        `Applied RollbackKit PostgreSQL migration "${row.id}" does not have a checksum.`,
        {
            migrationId: row.id,
        },
    );
}

function assertAppliedMigrationChecksums(
    appliedMigrations: readonly AppliedPostgresMigration[],
    migrations: readonly RollbackKitPostgresMigration[],
): void {
    const migrationsById = new Map(migrations.map((migration) => [migration.id, migration]));

    for (const appliedMigration of appliedMigrations) {
        const migration = migrationsById.get(appliedMigration.id);

        if (migration === undefined) {
            throw new RollbackKitPostgresMigrationError(
                `Unknown applied RollbackKit PostgreSQL migration "${appliedMigration.id}".`,
                {
                    migrationId: appliedMigration.id,
                },
            );
        }

        const expectedChecksum = createMigrationChecksum(migration);

        if (appliedMigration.checksum !== expectedChecksum) {
            throw new RollbackKitPostgresMigrationError(
                `Applied RollbackKit PostgreSQL migration "${appliedMigration.id}" checksum does not match the bundled migration.`,
                {
                    migrationId: appliedMigration.id,
                },
            );
        }
    }
}

function isPoolLikeExecutor(executor: unknown): boolean {
    if (typeof executor !== 'object' || executor === null) {
        return false;
    }

    return 'totalCount' in executor && 'idleCount' in executor && 'waitingCount' in executor;
}
