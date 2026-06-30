import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import { createDemoRollbackKit } from '../../lib/server/rollbackkit';

describe('demo RollbackKit runtime', () => {
    it('creates a server-side RollbackKit runtime', () => {
        const rollbackkit = createDemoRollbackKit(new FakePostgresExecutor());

        expect(rollbackkit.registry.size).toBe(0);
        expect(rollbackkit.storage).toBeDefined();
    });
});

class FakePostgresExecutor {
    async query<TResult extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<TResult>> {
        return {
            command: '',
            rowCount: 0,
            oid: 0,
            fields: [],
            rows: [],
        };
    }
}
