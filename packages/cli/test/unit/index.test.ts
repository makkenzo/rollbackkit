import { describe, expect, it } from 'vitest';

import * as publicApi from '../../src/index';

describe('@rollbackkit/cli public API', () => {
    it('exports stable embedding API from the package root', () => {
        expect(Object.keys(publicApi).sort()).toEqual([
            'createRollbackKitCliProgram',
            'rollbackkitCliVersion',
            'runCli',
        ]);
        expect(publicApi.rollbackkitCliVersion).toBe('0.0.0');
        expect(publicApi.createRollbackKitCliProgram).toBeTypeOf('function');
        expect(publicApi.runCli).toBeTypeOf('function');
    });
});
