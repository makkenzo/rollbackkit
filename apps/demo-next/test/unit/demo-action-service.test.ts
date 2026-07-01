import { type ActionRun, REVERSIBILITY, RollbackKitError } from '@rollbackkit/core';
import { describe, expect, it } from 'vitest';

import { runDemoAction, serializeActionRun } from '../../lib/server/demo-action-service';

describe('demo action service DTO boundary', () => {
    it('serializes action runs as UI-safe summaries', () => {
        const run: ActionRun = {
            id: 'run_1',
            name: 'project.archive',
            status: 'completed',
            actor: {
                id: 'member_ada',
                type: 'user',
                displayName: 'Ada Lovelace',
            },
            tenantId: 'workspace_acme',
            target: {
                id: 'project_billing',
                type: 'project',
                label: 'Billing Revamp',
                metadata: {
                    status: 'archived',
                },
            },
            input: {
                projectId: 'project_billing',
            },
            reversibility: REVERSIBILITY.full,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            executedAt: new Date('2026-01-01T00:00:01.000Z'),
            undoExpiresAt: new Date('2026-01-01T00:30:00.000Z'),
            result: {
                projectId: 'project_billing',
                status: 'archived',
            },
            metadata: {
                projectName: 'Billing Revamp',
            },
        };

        const dto = serializeActionRun(run);

        expect(dto).toEqual({
            id: 'run_1',
            name: 'project.archive',
            status: 'completed',
            createdAt: '2026-01-01T00:00:00.000Z',
            executedAt: '2026-01-01T00:00:01.000Z',
            target: {
                id: 'project_billing',
                type: 'project',
                label: 'Billing Revamp',
            },
            canUndo: true,
            undoExpiresAt: '2026-01-01T00:30:00.000Z',
        });
        expect(dto).not.toHaveProperty('actor');
        expect(dto).not.toHaveProperty('tenantId');
        expect(dto).not.toHaveProperty('result');
        expect(dto).not.toHaveProperty('metadata');
    });

    it('does not expose internal error details to client responses', async () => {
        const response = await runDemoAction(async () => {
            throw new RollbackKitError({
                code: 'ACTION_CONFLICT',
                message: 'Project cannot be archived safely.',
                details: {
                    internalSnapshotKey: 'previousProjectState',
                },
            });
        });

        expect(response).toEqual({
            ok: false,
            error: {
                code: 'ACTION_CONFLICT',
                message: 'Project cannot be archived safely.',
            },
        });
    });
});
