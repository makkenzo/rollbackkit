import {
    getPostgresMigrationStatus,
    migratePostgresDatabase,
    type PostgresDatabaseMigrationOptions,
    type PostgresMigrationResult,
    type PostgresMigrationStatus,
} from '@rollbackkit/postgres';
import { Command } from 'commander';
import { resolveDatabaseUrl } from './database-url';
import type { CliWriter } from './output';
import { writeLine } from './output';

export const rollbackkitCliVersion = '0.0.0';
export type { CliWriter } from './output';

export interface RollbackKitCliProgramOptions {
    readonly migratePostgresDatabase?: (
        options: PostgresDatabaseMigrationOptions,
    ) => Promise<PostgresMigrationResult>;
    readonly getPostgresMigrationStatus?: (
        options: PostgresDatabaseMigrationOptions,
    ) => Promise<PostgresMigrationStatus>;
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
    const runMigrations = options.migratePostgresDatabase ?? migratePostgresDatabase;
    const readMigrationStatus = options.getPostgresMigrationStatus ?? getPostgresMigrationStatus;

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

            const result = await runMigrations({
                databaseUrl,
            });

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

    program
        .command('doctor')
        .description('Check RollbackKit PostgreSQL connectivity and migration status.')
        .option('--database-url <url>', 'PostgreSQL connection string.')
        .action(async (command: PostgresCommandOptions) => {
            const databaseUrl = resolveDatabaseUrl(command.databaseUrl, env);

            const status = await readMigrationStatus({
                databaseUrl,
            });

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

    return program;
}

export async function runCli(options: RunCliOptions = {}): Promise<void> {
    const program = createRollbackKitCliProgram(options);

    await program.parseAsync([...(options.argv ?? process.argv)], {
        from: 'node',
    });
}
