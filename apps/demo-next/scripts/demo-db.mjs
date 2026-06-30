import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptsDirectory, '..');

const DATABASE_URL_ENV_NAMES = ['ROLLBACKKIT_DEMO_DATABASE_URL', 'DATABASE_URL'];

export async function withDemoPostgresClient(handler) {
    const client = new Client({
        connectionString: resolveDemoDatabaseUrl(),
    });

    await client.connect();

    try {
        return await handler(client);
    } finally {
        await client.end();
    }
}

export async function readDemoSql(relativePath) {
    return readFile(resolve(appDirectory, relativePath), 'utf8');
}

function resolveDemoDatabaseUrl(env = process.env) {
    const databaseUrl = DATABASE_URL_ENV_NAMES.map((name) => env[name]).find(
        (value) => value !== undefined && value.trim() !== '',
    );

    if (databaseUrl === undefined) {
        throw new Error(`Missing demo database URL. Set ${DATABASE_URL_ENV_NAMES.join(' or ')}.`);
    }

    return databaseUrl;
}
