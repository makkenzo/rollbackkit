import { Client } from 'pg';
import {
    createPostgresMigrationRunner,
    type PostgresMigrationResult,
    type PostgresMigrationStatus,
} from './migration-runner';
import type { RollbackKitPostgresMigration } from './migrations';

export interface PostgresDatabaseMigrationOptions {
    readonly databaseUrl: string;
    readonly migrations?: readonly RollbackKitPostgresMigration[];
}

export async function migratePostgresDatabase(
    options: PostgresDatabaseMigrationOptions,
): Promise<PostgresMigrationResult> {
    return withPostgresClient(options.databaseUrl, (client) =>
        createPostgresMigrationRunner({
            executor: client,
            ...(options.migrations === undefined ? {} : { migrations: options.migrations }),
        }).migrate(),
    );
}

export async function getPostgresMigrationStatus(
    options: PostgresDatabaseMigrationOptions,
): Promise<PostgresMigrationStatus> {
    return withPostgresClient(options.databaseUrl, (client) =>
        createPostgresMigrationRunner({
            executor: client,
            ...(options.migrations === undefined ? {} : { migrations: options.migrations }),
        }).getMigrationStatus(),
    );
}

async function withPostgresClient<TValue>(
    databaseUrl: string,
    handler: (client: Client) => Promise<TValue>,
): Promise<TValue> {
    const client = new Client({
        connectionString: databaseUrl,
    });

    await client.connect();

    try {
        return await handler(client);
    } finally {
        await client.end();
    }
}
