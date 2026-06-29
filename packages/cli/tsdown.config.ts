import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['src/index.ts', 'src/bin.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    deps: {
        neverBundle: ['commander', '@rollbackkit/core', '@rollbackkit/postgres'],
    },
});
