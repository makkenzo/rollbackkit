import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import * as publicApi from '../../src/index';

describe('@rollbackkit/cli public API', () => {
    it('exports stable embedding API from the package root', () => {
        expect(Object.keys(publicApi).sort()).toEqual([
            'createRollbackKitCliProgram',
            'rollbackkitCliVersion',
            'runCli',
        ]);
        expect(publicApi.rollbackkitCliVersion).toBe(readPackageVersion());
        expect(publicApi.createRollbackKitCliProgram).toBeTypeOf('function');
        expect(publicApi.runCli).toBeTypeOf('function');
    });
});

function readPackageVersion(): string {
    const packageJson = JSON.parse(
        readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
        readonly version: string;
    };

    return packageJson.version;
}
