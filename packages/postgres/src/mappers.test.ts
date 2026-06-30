import {
    type ActionActor,
    type ActionTarget,
    REVERSIBILITY,
    type SerializedRollbackKitError,
} from '@rollbackkit/core';
import { describe, expect, it } from 'vitest';

import {
    type ActionConflictRow,
    type ActionRunRow,
    type ActionSideEffectRow,
    mapActionConflictRow,
    mapActionRunRow,
    mapActionSideEffectRow,
    mapSnapshotRow,
    type SnapshotRow,
} from './mappers';

const actor: ActionActor = {
    id: 'user_1',
    type: 'user',
    displayName: 'Test User',
    metadata: {
        team: 'core',
    },
};

const undoActor: ActionActor = {
    id: 'user_2',
    type: 'user',
    displayName: 'Undo User',
};

const target: ActionTarget = {
    id: 'project_1',
    type: 'project',
    label: 'Demo Project',
};

describe('PostgreSQL row mappers', () => {
    it('maps full action run rows', () => {
        const error: SerializedRollbackKitError = {
            code: 'ACTION_UNDO_FAILED',
            message: 'Undo failed.',
            details: {
                reason: 'restore_failed',
            },
        };

        const row: ActionRunRow = {
            id: 'run_1',
            name: 'project.archive',
            status: 'undo_failed',

            actor_id: actor.id,
            actor_type: actor.type,
            actor,

            tenant_id: 'tenant_1',

            target_type: target.type,
            target_id: target.id,
            target,

            input: {
                projectId: 'project_1',
            },
            input_hash: 'hash_1',
            reversibility: REVERSIBILITY.full,

            created_at: '2026-01-01T00:00:00.000Z',
            executed_at: new Date('2026-01-01T00:00:01.000Z'),
            undo_expires_at: '2026-01-01T00:01:00.000Z',
            undo_started_at: '2026-01-01T00:00:05.000Z',
            undone_at: null,
            undone_by: undoActor,

            result: {
                archived: true,
            },
            undo_result: {
                restored: false,
            },
            error,
            metadata: {
                source: 'test',
            },
        };

        expect(mapActionRunRow(row)).toEqual({
            id: 'run_1',
            name: 'project.archive',
            status: 'undo_failed',
            actor,
            tenantId: 'tenant_1',
            target,
            input: {
                projectId: 'project_1',
            },
            inputHash: 'hash_1',
            reversibility: REVERSIBILITY.full,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            executedAt: new Date('2026-01-01T00:00:01.000Z'),
            undoExpiresAt: new Date('2026-01-01T00:01:00.000Z'),
            undoStartedAt: new Date('2026-01-01T00:00:05.000Z'),
            undoneBy: undoActor,
            result: {
                archived: true,
            },
            undoResult: {
                restored: false,
            },
            error,
            metadata: {
                source: 'test',
            },
        });
    });

    it('omits nullable action run fields', () => {
        const row: ActionRunRow = {
            id: 'run_1',
            name: 'project.archive',
            status: 'completed',

            actor_id: actor.id,
            actor_type: actor.type,
            actor,

            tenant_id: null,

            target_type: null,
            target_id: null,
            target: null,

            input: {},
            input_hash: null,
            reversibility: REVERSIBILITY.full,

            created_at: new Date('2026-01-01T00:00:00.000Z'),
            executed_at: null,
            undo_expires_at: null,
            undo_started_at: null,
            undone_at: null,
            undone_by: null,

            result: null,
            undo_result: null,
            error: null,
            metadata: null,
        };

        const run = mapActionRunRow(row);

        expect(run).toEqual({
            id: 'run_1',
            name: 'project.archive',
            status: 'completed',
            actor,
            input: {},
            reversibility: REVERSIBILITY.full,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        });

        expect('tenantId' in run).toBe(false);
        expect('target' in run).toBe(false);
        expect('result' in run).toBe(false);
        expect('undoResult' in run).toBe(false);
    });

    it('maps snapshot rows', () => {
        const row: SnapshotRow = {
            id: 'snapshot_1',
            action_run_id: 'run_1',
            key: 'previousRole',
            value: {
                role: 'viewer',
            },
            created_at: '2026-01-01T00:00:00.000Z',
            metadata: {
                source: 'execute',
            },
        };

        expect(mapSnapshotRow(row)).toEqual({
            id: 'snapshot_1',
            actionRunId: 'run_1',
            key: 'previousRole',
            value: {
                role: 'viewer',
            },
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            metadata: {
                source: 'execute',
            },
        });
    });

    it('maps side effect rows', () => {
        const row: ActionSideEffectRow = {
            id: 'effect_1',
            action_run_id: 'run_1',
            type: 'email.sent',
            status: 'completed',
            reversibility: REVERSIBILITY.irreversible,
            payload: {
                template: 'project_archived',
            },
            created_at: '2026-01-01T00:00:00.000Z',
            metadata: null,
        };

        expect(mapActionSideEffectRow(row)).toEqual({
            id: 'effect_1',
            actionRunId: 'run_1',
            type: 'email.sent',
            status: 'completed',
            reversibility: REVERSIBILITY.irreversible,
            payload: {
                template: 'project_archived',
            },
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        });
    });

    it('maps conflict rows', () => {
        const row: ActionConflictRow = {
            id: 'conflict_1',
            action_run_id: 'run_1',
            reason: 'Expected project to be archived, but it was deleted.',
            details: {
                projectId: 'project_1',
            },
            created_at: '2026-01-01T00:00:00.000Z',
        };

        expect(mapActionConflictRow(row)).toEqual({
            id: 'conflict_1',
            actionRunId: 'run_1',
            reason: 'Expected project to be archived, but it was deleted.',
            details: {
                projectId: 'project_1',
            },
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        });
    });

    it('rejects invalid timestamp values', () => {
        const row: SnapshotRow = {
            id: 'snapshot_1',
            action_run_id: 'run_1',
            key: 'broken',
            value: {},
            created_at: 'not-a-date',
            metadata: null,
        };

        expect(() => mapSnapshotRow(row)).toThrow(TypeError);
    });
});
