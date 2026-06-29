import { describe, expect, it } from 'vitest';

import { rollbackkitPostgresVersion } from './index';

describe('@rollbackkit/postgres', () => {
    it('exports package version placeholder', () => {
        expect(rollbackkitPostgresVersion).toBe('0.0.0');
    });
});
