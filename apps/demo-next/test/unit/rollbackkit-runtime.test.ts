import type { ActionActor } from '@rollbackkit/core';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { MEMBER_CHANGE_ROLE_ACTION_NAME } from '../../lib/server/actions/member-change-role.action';
import { MEMBER_REMOVE_ACTION_NAME } from '../../lib/server/actions/member-remove.action';
import { PROJECT_ARCHIVE_ACTION_NAME } from '../../lib/server/actions/project-archive.action';
import { createDemoRollbackKit } from '../../lib/server/rollbackkit';

const actor: ActionActor = {
    id: 'member_test',
    type: 'user',
    displayName: 'Test Member',
};

describe('demo RollbackKit runtime', () => {
    it('registers server-side demo actions', () => {
        const rollbackkit = createDemoRollbackKit(new FakePostgresExecutor());

        expect(rollbackkit.registry.size).toBe(3);
        expect(rollbackkit.registry.has(PROJECT_ARCHIVE_ACTION_NAME)).toBe(true);
        expect(rollbackkit.registry.has(MEMBER_CHANGE_ROLE_ACTION_NAME)).toBe(true);
        expect(rollbackkit.registry.has(MEMBER_REMOVE_ACTION_NAME)).toBe(true);
        expect(rollbackkit.queryActionRuns).toBeDefined();
    });

    it('rejects tenant and workspace mismatches before reading product state', async () => {
        const executor = new FakePostgresExecutor();
        const rollbackkit = createDemoRollbackKit(executor);

        const requests = [
            {
                name: PROJECT_ARCHIVE_ACTION_NAME,
                input: {
                    workspaceId: 'workspace_other',
                    projectId: 'project_1',
                },
            },
            {
                name: MEMBER_CHANGE_ROLE_ACTION_NAME,
                input: {
                    workspaceId: 'workspace_other',
                    memberId: 'member_1',
                    role: 'admin',
                },
            },
            {
                name: MEMBER_REMOVE_ACTION_NAME,
                input: {
                    workspaceId: 'workspace_other',
                    memberId: 'member_1',
                },
            },
        ] as const;

        for (const request of requests) {
            await expect(
                rollbackkit.preview({
                    ...request,
                    actor,
                    tenantId: 'workspace_acme',
                }),
            ).rejects.toMatchObject({
                code: 'ACTION_INPUT_INVALID',
            });
        }

        expect(executor.queryCount).toBe(0);
    });
});

class FakePostgresExecutor {
    queryCount = 0;

    async query<TResult extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<TResult>> {
        this.queryCount += 1;

        return {
            command: '',
            rowCount: 0,
            oid: 0,
            fields: [],
            rows: [],
        };
    }
}
