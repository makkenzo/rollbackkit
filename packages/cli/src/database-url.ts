const DATABASE_URL_ENV_NAMES = ['ROLLBACKKIT_DATABASE_URL', 'DATABASE_URL'] as const;

export function resolveDatabaseUrl(
    databaseUrl: string | undefined,
    env: Record<string, string | undefined>,
): string {
    const resolvedDatabaseUrl =
        databaseUrl ??
        DATABASE_URL_ENV_NAMES.map((name) => env[name]).find(
            (value): value is string => value !== undefined && value.trim() !== '',
        );

    if (resolvedDatabaseUrl === undefined || resolvedDatabaseUrl.trim() === '') {
        throw new Error(
            `Missing PostgreSQL database URL. Pass --database-url or set ${DATABASE_URL_ENV_NAMES.join(
                ' / ',
            )}.`,
        );
    }

    return resolvedDatabaseUrl;
}
