const DATABASE_URL_ENV_NAMES = ['ROLLBACKKIT_DATABASE_URL', 'DATABASE_URL'] as const;

export type DatabaseUrlSource = 'option' | (typeof DATABASE_URL_ENV_NAMES)[number];

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

    for (const name of DATABASE_URL_ENV_NAMES) {
        const envValue = env[name];

        if (envValue !== undefined && envValue.trim() !== '') {
            return {
                databaseUrl: envValue,
                databaseUrlSource: name,
            };
        }
    }

    throw new Error(
        `Missing PostgreSQL database URL. Pass --database-url or set ${DATABASE_URL_ENV_NAMES.join(
            ' / ',
        )}.`,
    );
}

export function resolveDatabaseUrl(
    databaseUrl: string | undefined,
    env: Record<string, string | undefined>,
): string {
    return loadDatabaseConfig(databaseUrl, env).databaseUrl;
}
