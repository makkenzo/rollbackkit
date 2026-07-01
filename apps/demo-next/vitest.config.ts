import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const configDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '@': configDirectory,
            'server-only': resolve(configDirectory, 'test/server-only-stub.ts'),
        },
    },
    test: {
        environment: 'node',
        fileParallelism: false,
        include: ['test/**/*.test.ts'],
    },
});
