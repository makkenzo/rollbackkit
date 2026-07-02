const DATABASE_URL_ENV_NAME = 'ROLLBACKKIT_DATABASE_URL';

export type DatabaseUrlSource = 'option' | typeof DATABASE_URL_ENV_NAME;

export interface CliDatabaseConfig {
    readonly databaseUrl: string;
    readonly databaseUrlSource: DatabaseUrlSource;
}

export function loadDatabaseConfig(
    databaseUrl: string | undefined,
    env: Record<string, string | undefined>,
): CliDatabaseConfig {
    if (databaseUrl !== undefined && databaseUrl.trim() !== '') {
        return {
            databaseUrl,
            databaseUrlSource: 'option',
        };
    }

    const envValue = env[DATABASE_URL_ENV_NAME];

    if (envValue !== undefined && envValue.trim() !== '') {
        return {
            databaseUrl: envValue,
            databaseUrlSource: DATABASE_URL_ENV_NAME,
        };
    }

    throw new Error(
        `Missing PostgreSQL database URL. Pass --database-url or set ${DATABASE_URL_ENV_NAME}.`,
    );
}

export function resolveDatabaseUrl(
    databaseUrl: string | undefined,
    env: Record<string, string | undefined>,
): string {
    return loadDatabaseConfig(databaseUrl, env).databaseUrl;
}
