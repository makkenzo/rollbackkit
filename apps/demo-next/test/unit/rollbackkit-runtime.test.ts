import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import { MEMBER_CHANGE_ROLE_ACTION_NAME } from '../../lib/server/actions/member-change-role';
import { PROJECT_ARCHIVE_ACTION_NAME } from '../../lib/server/actions/project-archive';
import { createDemoRollbackKit } from '../../lib/server/rollbackkit';

describe('demo RollbackKit runtime', () => {
    it('registers server-side demo actions', () => {
        const rollbackkit = createDemoRollbackKit(new FakePostgresExecutor());

        expect(rollbackkit.registry.size).toBe(2);
        expect(rollbackkit.registry.has(PROJECT_ARCHIVE_ACTION_NAME)).toBe(true);
        expect(rollbackkit.registry.has(MEMBER_CHANGE_ROLE_ACTION_NAME)).toBe(true);
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
