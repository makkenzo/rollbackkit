import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptsDirectory, '..');
const envFilePath = resolve(packageDirectory, '.env.test');
const vitestPath = resolve(packageDirectory, 'node_modules/vitest/vitest.mjs');

const env = {
    ...process.env,
};

if (existsSync(envFilePath)) {
    Object.assign(env, parseEnvFile(readFileSync(envFilePath, 'utf8')));
}

if (
    env.ROLLBACKKIT_POSTGRES_TEST_DATABASE_URL === undefined ||
    env.ROLLBACKKIT_POSTGRES_TEST_DATABASE_URL.trim() === ''
) {
    console.error(
        [
            'ROLLBACKKIT_POSTGRES_TEST_DATABASE_URL is required for PostgreSQL integration tests.',
            `Set it in the environment or create ${envFilePath}.`,
        ].join('\n'),
    );
    process.exit(1);
}

const result = spawnSync(process.execPath, [vitestPath, 'run', 'test/integration'], {
    cwd: packageDirectory,
    env,
    stdio: 'inherit',
});

process.exit(result.status ?? 1);

function parseEnvFile(content) {
    const result = {};

    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();

        if (line === '' || line.startsWith('#')) {
            continue;
        }

        const separatorIndex = line.indexOf('=');

        if (separatorIndex < 0) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        const rawValue = line.slice(separatorIndex + 1).trim();

        if (key === '') {
            continue;
        }

        result[key] = unquoteEnvValue(rawValue);
    }

    return result;
}

function unquoteEnvValue(value) {
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }

    return value;
}
