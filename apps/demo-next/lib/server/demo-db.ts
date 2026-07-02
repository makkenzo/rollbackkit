import 'server-only';

import { Pool } from 'pg';

const DEMO_DATABASE_URL_ENV_NAME = 'ROLLBACKKIT_DEMO_DATABASE_URL';

let demoPool: Pool | undefined;

export function getDemoPostgresPool(): Pool {
    demoPool ??= new Pool({
        connectionString: resolveDemoDatabaseUrl(),
    });

    return demoPool;
}

export async function closeDemoPostgresPool(): Promise<void> {
    const pool = demoPool;

    demoPool = undefined;

    if (pool !== undefined) {
        await pool.end();
    }
}

function resolveDemoDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
    const databaseUrl = env[DEMO_DATABASE_URL_ENV_NAME];

    if (databaseUrl === undefined || databaseUrl.trim() === '') {
        throw new Error(`Missing demo database URL. Set ${DEMO_DATABASE_URL_ENV_NAME}.`);
    }

    return databaseUrl;
}
