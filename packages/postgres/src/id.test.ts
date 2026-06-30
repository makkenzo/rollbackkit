import { describe, expect, it } from 'vitest';

import { createRollbackKitPostgresId } from './id';

describe('PostgreSQL id generation', () => {
    it('creates stable prefixed ids', () => {
        expect(createRollbackKitPostgresId('run')).toMatch(
            /^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );

        expect(createRollbackKitPostgresId('snapshot')).toMatch(
            /^snapshot_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );

        expect(createRollbackKitPostgresId('effect')).toMatch(
            /^effect_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );

        expect(createRollbackKitPostgresId('conflict')).toMatch(
            /^conflict_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
    });

    it('does not reuse ids', () => {
        const first = createRollbackKitPostgresId('run');
        const second = createRollbackKitPostgresId('run');

        expect(first).not.toBe(second);
    });
});
