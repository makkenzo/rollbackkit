import {
    createPostgresMigrationRunner,
    type PostgresQueryExecutor,
    ROLLBACKKIT_POSTGRES_MIGRATIONS,
} from '@rollbackkit/postgres';
import { Command } from 'commander';
import { Client } from 'pg';

export const rollbackkitCliVersion = '0.0.0';

const DATABASE_URL_ENV_NAMES = ['ROLLBACKKIT_DATABASE_URL', 'DATABASE_URL'] as const;

export interface CliWriter {
    write(text: string): unknown;
}

export interface RollbackKitCliPostgresClient extends PostgresQueryExecutor {
    connect(): Promise<unknown>;
    end(): Promise<unknown>;
}

export interface RollbackKitCliProgramOptions {
    readonly createPostgresClient?: (databaseUrl: string) => RollbackKitCliPostgresClient;
    readonly stdout?: CliWriter;
    readonly stderr?: CliWriter;
    readonly env?: Record<string, string | undefined>;
}

export interface RunCliOptions extends RollbackKitCliProgramOptions {
    readonly argv?: readonly string[];
}

interface PostgresCommandOptions {
    readonly databaseUrl?: string;
}

export function createRollbackKitCliProgram(options: RollbackKitCliProgramOptions = {}): Command {
    const stdout = options.stdout ?? process.stdout;
    const env = options.env ?? process.env;
    const createPostgresClient = options.createPostgresClient ?? createDefaultPostgresClient;

    const program = new Command();

    program
        .name('rollbackkit')
        .description('CLI for RollbackKit migrations and diagnostics.')
        .version(rollbackkitCliVersion);

    program
        .command('migrate')
        .description('Apply RollbackKit PostgreSQL migrations.')
        .option('--database-url <url>', 'PostgreSQL connection string.')
        .action(async (command: PostgresCommandOptions) => {
            const databaseUrl = resolveDatabaseUrl(command.databaseUrl, env);

            await withPostgresClient(createPostgresClient, databaseUrl, async (client) => {
                const runner = createPostgresMigrationRunner({
                    executor: client,
                });

                const result = await runner.migrate();

                if (result.applied.length === 0) {
                    writeLine(
                        stdout,
                        `RollbackKit PostgreSQL schema is up to date. ${result.skipped.length} migration(s) already applied.`,
                    );
                    return;
                }

                writeLine(
                    stdout,
                    `Applied ${result.applied.length} RollbackKit PostgreSQL migration(s):`,
                );

                for (const migration of result.applied) {
                    writeLine(stdout, `- ${migration.id}: ${migration.description}`);
                }
            });
        });

    program
        .command('doctor')
        .description('Check RollbackKit PostgreSQL connectivity and migration status.')
        .option('--database-url <url>', 'PostgreSQL connection string.')
        .action(async (command: PostgresCommandOptions) => {
            const databaseUrl = resolveDatabaseUrl(command.databaseUrl, env);

            await withPostgresClient(createPostgresClient, databaseUrl, async (client) => {
                const runner = createPostgresMigrationRunner({
                    executor: client,
                });

                const appliedMigrations = await runner.getAppliedMigrations();
                const appliedIds = new Set(appliedMigrations.map((migration) => migration.id));
                const pendingMigrations = ROLLBACKKIT_POSTGRES_MIGRATIONS.filter(
                    (migration) => !appliedIds.has(migration.id),
                );

                writeLine(stdout, 'RollbackKit PostgreSQL doctor');
                writeLine(stdout, 'Database: connected');
                writeLine(stdout, `Applied migrations: ${appliedMigrations.length}`);

                if (pendingMigrations.length === 0) {
                    writeLine(stdout, 'Schema: up to date');
                    return;
                }

                writeLine(stdout, `Schema: ${pendingMigrations.length} pending migration(s)`);

                for (const migration of pendingMigrations) {
                    writeLine(stdout, `- ${migration.id}: ${migration.description}`);
                }
            });
        });

    return program;
}

export async function runCli(options: RunCliOptions = {}): Promise<void> {
    const program = createRollbackKitCliProgram(options);

    await program.parseAsync([...(options.argv ?? process.argv)], {
        from: 'node',
    });
}

function createDefaultPostgresClient(databaseUrl: string): RollbackKitCliPostgresClient {
    return new Client({
        connectionString: databaseUrl,
    });
}

async function withPostgresClient<TValue>(
    createPostgresClient: (databaseUrl: string) => RollbackKitCliPostgresClient,
    databaseUrl: string,
    handler: (client: RollbackKitCliPostgresClient) => Promise<TValue>,
): Promise<TValue> {
    const client = createPostgresClient(databaseUrl);

    await client.connect();

    try {
        return await handler(client);
    } finally {
        await client.end();
    }
}

function resolveDatabaseUrl(
    databaseUrl: string | undefined,
    env: Record<string, string | undefined>,
): string {
    const resolvedDatabaseUrl =
        databaseUrl ??
        DATABASE_URL_ENV_NAMES.map((name) => env[name]).find(
            (value): value is string => value !== undefined && value.trim() !== '',
        );

    if (resolvedDatabaseUrl === undefined || resolvedDatabaseUrl.trim() === '') {
        throw new Error(
            `Missing PostgreSQL database URL. Pass --database-url or set ${DATABASE_URL_ENV_NAMES.join(
                ' / ',
            )}.`,
        );
    }

    return resolvedDatabaseUrl;
}

function writeLine(writer: CliWriter, text: string): void {
    writer.write(`${text}\n`);
}
