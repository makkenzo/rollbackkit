import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptsDirectory, '..');
const appEnvFile = resolve(appDirectory, '.env');

const DEMO_DATABASE_URL_ENV_NAME = 'ROLLBACKKIT_DEMO_DATABASE_URL';

if (existsSync(appEnvFile)) {
    process.loadEnvFile(appEnvFile);
}

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
    const databaseUrl = env[DEMO_DATABASE_URL_ENV_NAME];

    if (databaseUrl === undefined || databaseUrl.trim() === '') {
        throw new Error(`Missing demo database URL. Set ${DEMO_DATABASE_URL_ENV_NAME}.`);
    }

    return databaseUrl;
}
