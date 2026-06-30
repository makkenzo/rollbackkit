import { describe, expect, it } from 'vitest';

import * as publicApi from '../../src/index';

describe('@rollbackkit/cli public API', () => {
    it('does not expose CLI implementation internals from the package root', () => {
        expect(Object.keys(publicApi)).toEqual(['rollbackkitCliVersion']);
        expect(publicApi.rollbackkitCliVersion).toBe('0.0.0');
    });
});
