import { Pool } from 'pg';

const DATABASE_URL_ENV_NAMES = ['ROLLBACKKIT_DEMO_DATABASE_URL', 'DATABASE_URL'] as const;

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
    const databaseUrl = DATABASE_URL_ENV_NAMES.map((name) => env[name]).find(
        (value): value is string => value !== undefined && value.trim() !== '',
    );

    if (databaseUrl === undefined) {
        throw new Error(`Missing demo database URL. Set ${DATABASE_URL_ENV_NAMES.join(' or ')}.`);
    }

    return databaseUrl;
}
