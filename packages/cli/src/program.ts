import {
    getPostgresMigrationStatus,
    migratePostgresDatabase,
    type PostgresDatabaseMigrationOptions,
    type PostgresMigrationResult,
    type PostgresMigrationStatus,
} from '@rollbackkit/postgres';
import { Command, CommanderError } from 'commander';
import packageJson from '../package.json';
import type { DatabaseUrlSource } from './database-url';
import { loadDatabaseConfig } from './database-url';
import { writeCliError } from './error-presenter';
import type { CliWriter } from './output';
import { writeLine } from './output';

export const rollbackkitCliVersion = packageJson.version;
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

interface GlobalCommandOptions {
    readonly verbose?: boolean;
}

export function createRollbackKitCliProgram(options: RollbackKitCliProgramOptions = {}): Command {
    const stdout = options.stdout ?? process.stdout;
    const stderr = options.stderr ?? process.stderr;
    const env = options.env ?? process.env;
    const runMigrations = options.migratePostgresDatabase ?? migratePostgresDatabase;
    const readMigrationStatus = options.getPostgresMigrationStatus ?? getPostgresMigrationStatus;

    const program = new Command();

    program.configureOutput({
        writeOut: (text) => {
            stdout.write(text);
        },
        writeErr: (text) => {
            stderr.write(text);
        },
    });

    program
        .name('rollbackkit')
        .description('CLI for RollbackKit migrations and diagnostics.')
        .version(rollbackkitCliVersion)
        .option('--verbose', 'Show stack traces and nested error causes.');

    program
        .command('migrate')
        .description('Apply RollbackKit PostgreSQL migrations.')
        .option('--database-url <url>', 'PostgreSQL connection string.')
        .action(async (command: PostgresCommandOptions) => {
            const { databaseUrl, databaseUrlSource } = loadDatabaseConfig(command.databaseUrl, env);

            writeDatabaseUrlSourceWarning(stderr, databaseUrlSource);

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
            const { databaseUrl, databaseUrlSource } = loadDatabaseConfig(command.databaseUrl, env);

            writeDatabaseUrlSourceWarning(stderr, databaseUrlSource);

            const status = await readMigrationStatus({
                databaseUrl,
            });

            writeLine(stdout, 'RollbackKit PostgreSQL doctor');
            writeLine(stdout, 'Database: connected');
            writeLine(
                stdout,
                `Migration table: ${status.schemaTableExists ? 'present' : 'missing'}`,
            );
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

export async function runCli(options: RunCliOptions = {}): Promise<number> {
    const stderr = options.stderr ?? process.stderr;
    const program = createRollbackKitCliProgram(options);

    program.exitOverride();

    try {
        await program.parseAsync([...(options.argv ?? process.argv)], {
            from: 'node',
        });

        return 0;
    } catch (error) {
        if (error instanceof CommanderError && error.exitCode === 0) {
            return 0;
        }

        writeCliError(stderr, error, {
            verbose: getVerboseFlag(program, options.argv ?? process.argv),
        });

        return 1;
    }
}

function getVerboseFlag(program: Command, argv: readonly string[]): boolean {
    return (program.opts<GlobalCommandOptions>().verbose ?? argv.includes('--verbose')) === true;
}

function writeDatabaseUrlSourceWarning(writer: CliWriter, source: DatabaseUrlSource): void {
    if (source !== 'DATABASE_URL') {
        return;
    }

    writeLine(
        writer,
        'Using DATABASE_URL for RollbackKit CLI. Prefer ROLLBACKKIT_DATABASE_URL or --database-url for schema changes.',
    );
}
