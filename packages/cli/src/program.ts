import { createPostgresMigrationRunner, type PostgresQueryExecutor } from '@rollbackkit/postgres';
import { Command } from 'commander';
import { Client } from 'pg';
import { resolveDatabaseUrl } from './database-url';
import type { CliWriter } from './output';
import { writeLine } from './output';

export const rollbackkitCliVersion = '0.0.0';
export type { CliWriter } from './output';

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

                const status = await runner.getMigrationStatus();

                writeLine(stdout, 'RollbackKit PostgreSQL doctor');
                writeLine(stdout, 'Database: connected');
                writeLine(stdout, `Applied migrations: ${status.applied.length}`);

                if (status.pending.length === 0) {
                    writeLine(stdout, 'Schema: up to date');
                    return;
                }

                writeLine(stdout, `Schema: ${status.pending.length} pending migration(s)`);

                for (const migration of status.pending) {
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
