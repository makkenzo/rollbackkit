import { describe, expect, it } from 'vitest';

import { rollbackkitVersion } from './index';

describe('@rollbackkit/core', () => {
    it('exports package version placeholder', () => {
        expect(rollbackkitVersion).toBe('0.0.0');
    });
});
