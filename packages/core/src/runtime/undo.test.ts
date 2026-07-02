import { describe, expect, it } from 'vitest';

import {
    type ActionActor,
    type ActionRun,
    type ClaimActionRunInput,
    type ClaimActionRunResult,
    type CreateActionRunInput,
    type CreateSnapshotInput,
    createMemoryStorageAdapter,
    createRollbackKit,
    defineAction,
    type JsonValue,
    REVERSIBILITY,
    type RecordConflictInput,
    type RecordSideEffectInput,
    RollbackKitError,
    type StorageAdapter,
    type UpdateActionRunInput,
} from '../index';

const actor: ActionActor = {
    id: 'user_1',
    type: 'user',
    displayName: 'Test User',
};

const undoActor: ActionActor = {
    id: 'user_2',
    type: 'user',
    displayName: 'Undo User',
};

describe('RollbackKit undo lifecycle', () => {
    it('undoes a completed action and stores undo metadata', async () => {
        let role = 'viewer';

        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'member.change_role',
                    reversibility: REVERSIBILITY.full,
                    undoWindowMs: 60_000,
                    preview: async () => ({
                        title: 'Change role',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async (context) => {
                        await context.snapshots.save('previousRole', {
                            role,
                        });

                        role = 'admin';

                        return {
                            data: {
                                role,
                            },
                        };
                    },
                    undo: async (context) => {
                        const previousRole = await context.snapshots.get<{
                            readonly role: string;
                        }>('previousRole');

                        if (previousRole === null) {
                            throw new RollbackKitError({
                                code: 'SNAPSHOT_NOT_FOUND',
                                message: 'Previous role snapshot was not found.',
                            });
                        }

                        role = previousRole.value.role;

                        return {
                            data: {
                                role,
                            },
                            metadata: {
                                undoReason: 'manual_request',
                            },
                        };
                    },
                }),
            ],
        });

        const run = await kit.execute({
            name: 'member.change_role',
            actor,
            input: {
                memberId: 'member_1',
                role: 'admin',
            },
        });

        expect(role).toBe('admin');

        const undone = await kit.undo({
            actionRunId: run.id,
            actor: undoActor,
        });

        expect(role).toBe('viewer');
        expect(undone.status).toBe('undone');
        expect(undone.undoneBy).toEqual(undoActor);
        expect(undone.undoResult).toEqual({
            role: 'viewer',
        });
        expect(undone.result).toEqual({
            role: 'admin',
        });
        expect(undone.metadata).toEqual({
            undoReason: 'manual_request',
        });
    });

    it('checks undo permission before changing undo status', async () => {
        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    authorize: async (context) => ({
                        allowed: context.phase !== 'undo',
                        reason: 'Only owners can undo this action.',
                    }),
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                    undo: async () => ({}),
                }),
            ],
        });

        const run = await kit.execute({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
        });

        await expect(
            kit.undo({
                actionRunId: run.id,
                actor: undoActor,
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_PERMISSION_DENIED',
        });

        await expect(kit.getActionRun(run.id)).resolves.toMatchObject({
            status: 'completed',
        });
    });

    it('rejects undo when the request tenant does not match the action run tenant', async () => {
        let undoCalled = false;

        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                    undo: async () => {
                        undoCalled = true;
                        return {};
                    },
                }),
            ],
        });

        const run = await kit.execute({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            input: {
                projectId: 'project_1',
            },
        });

        await expect(
            kit.undo({
                actionRunId: run.id,
                actor: undoActor,
                tenantId: 'tenant_2',
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_PERMISSION_DENIED',
        });

        expect(undoCalled).toBe(false);
        await expect(kit.getActionRun(run.id)).resolves.toMatchObject({
            status: 'completed',
        });
    });

    it('rejects tenant-scoped undo when the request omits tenant context', async () => {
        let undoCalled = false;

        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                    undo: async () => {
                        undoCalled = true;

                        return {};
                    },
                }),
            ],
        });

        const run = await kit.execute({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            input: {
                projectId: 'project_1',
            },
        });

        await expect(
            kit.undo({
                actionRunId: run.id,
                actor: undoActor,
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_PERMISSION_DENIED',
        });

        expect(undoCalled).toBe(false);
        await expect(kit.getActionRun(run.id)).resolves.toMatchObject({
            status: 'completed',
        });
    });

    it('rejects undo for irreversible actions', async () => {
        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.hard_delete',
                    reversibility: REVERSIBILITY.irreversible,
                    preview: async () => ({
                        title: 'Hard delete project',
                        impact: [],
                        reversibility: REVERSIBILITY.irreversible,
                    }),
                    execute: async () => ({}),
                    undo: async () => ({}),
                }),
            ],
        });

        const run = await kit.execute({
            name: 'project.hard_delete',
            actor,
            input: {
                projectId: 'project_1',
            },
        });

        await expect(
            kit.undo({
                actionRunId: run.id,
                actor: undoActor,
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_NOT_UNDOABLE',
        });
    });

    it('rejects undo when action definition has no undo handler', async () => {
        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                }),
            ],
        });

        await expect(
            kit.execute({
                name: 'project.archive',
                actor,
                input: {
                    projectId: 'project_1',
                },
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_NOT_UNDOABLE',
        });
    });

    it('checks conflicts before running undo handler and records conflict details', async () => {
        let undoCalled = false;

        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                    checkConflicts: async (context) => {
                        await context.conflicts.record('Project is active again.', {
                            projectId: 'project_1',
                        });

                        throw new RollbackKitError({
                            code: 'ACTION_CONFLICT',
                            message: 'Project is active again.',
                        });
                    },
                    undo: async () => {
                        undoCalled = true;
                        return {};
                    },
                }),
            ],
        });

        const run = await kit.execute({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
        });

        await expect(
            kit.undo({
                actionRunId: run.id,
                actor: undoActor,
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_CONFLICT',
        });

        expect(undoCalled).toBe(false);
        await expect(kit.getActionRun(run.id)).resolves.toMatchObject({
            status: 'undo_failed',
            error: {
                code: 'ACTION_CONFLICT',
                message: 'Project is active again.',
            },
        });
    });

    it('rejects undo when conflict checks record conflicts without throwing', async () => {
        let undoCalled = false;

        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                    checkConflicts: async (context) => {
                        await context.conflicts.record('Project is active again.', {
                            projectId: 'project_1',
                        });
                    },
                    undo: async () => {
                        undoCalled = true;
                        return {};
                    },
                }),
            ],
        });

        const run = await kit.execute({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
        });

        await expect(
            kit.undo({
                actionRunId: run.id,
                actor: undoActor,
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_CONFLICT',
        });

        expect(undoCalled).toBe(false);
        await expect(kit.getConflicts(run.id)).resolves.toMatchObject([
            {
                reason: 'Project is active again.',
                details: {
                    projectId: 'project_1',
                },
            },
        ]);
        await expect(kit.getActionRun(run.id)).resolves.toMatchObject({
            status: 'undo_failed',
        });
    });

    it('persists undo failure state and conflicts after a transactional lock rolls back handler writes', async () => {
        const storage = createRollbackingActionRunLockStorage();

        const kit = createRollbackKit({
            storage,
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                    checkConflicts: async (context) => {
                        await context.conflicts.record('Project is active again.', {
                            projectId: 'project_1',
                        });

                        throw new RollbackKitError({
                            code: 'ACTION_CONFLICT',
                            message: 'Project is active again.',
                        });
                    },
                    undo: async () => ({}),
                }),
            ],
        });

        const run = await kit.execute({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
        });

        await expect(
            kit.undo({
                actionRunId: run.id,
                actor: undoActor,
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_CONFLICT',
        });

        expect(storage.conflicts).toEqual([
            {
                actionRunId: run.id,
                reason: 'Project is active again.',
                details: {
                    projectId: 'project_1',
                },
            },
        ]);

        await expect(kit.getActionRun(run.id)).resolves.toMatchObject({
            status: 'undo_failed',
            error: {
                code: 'ACTION_CONFLICT',
                message: 'Project is active again.',
            },
        });
    });

    it('rejects undo after undo window expires', async () => {
        let now = new Date('2026-01-01T00:00:00.000Z');

        const kit = createRollbackKit({
            clock: {
                now: () => now,
            },
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    undoWindowMs: 1_000,
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                    undo: async () => ({}),
                }),
            ],
        });

        const run = await kit.execute({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
        });

        now = new Date('2026-01-01T00:00:01.001Z');

        await expect(
            kit.undo({
                actionRunId: run.id,
                actor: undoActor,
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_UNDO_EXPIRED',
        });
    });

    it('rejects double undo', async () => {
        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                    undo: async () => ({}),
                }),
            ],
        });

        const run = await kit.execute({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
        });

        await kit.undo({
            actionRunId: run.id,
            actor: undoActor,
        });

        await expect(
            kit.undo({
                actionRunId: run.id,
                actor: undoActor,
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_ALREADY_UNDONE',
        });
    });

    it('marks action run as undo_failed when undo handler throws', async () => {
        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                    undo: async () => {
                        throw new Error('Restore failed.');
                    },
                }),
            ],
        });

        const run = await kit.execute({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
        });

        await expect(
            kit.undo({
                actionRunId: run.id,
                actor: undoActor,
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_UNDO_FAILED',
        });

        await expect(kit.getActionRun(run.id)).resolves.toMatchObject({
            status: 'undo_failed',
            error: {
                code: 'ACTION_UNDO_FAILED',
                message: 'Action "project.archive" undo failed.',
            },
        });
    });

    it('throws for missing action run', async () => {
        const kit = createRollbackKit();

        await expect(
            kit.undo({
                actionRunId: 'missing_run',
                actor: undoActor,
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_NOT_FOUND',
        });
    });
});

function createRollbackingActionRunLockStorage(): StorageAdapter & {
    readonly conflicts: RecordConflictInput[];
} {
    const storage = createMemoryStorageAdapter();
    const conflicts: RecordConflictInput[] = [];

    return {
        conflicts,
        withTransaction: (handler) => storage.withTransaction(handler),
        createActionRun: <TInput extends JsonValue = JsonValue>(
            input: CreateActionRunInput<TInput>,
        ) => storage.createActionRun(input),
        claimActionRun: <TInput extends JsonValue = JsonValue>(
            input: ClaimActionRunInput<TInput>,
        ): Promise<ClaimActionRunResult<TInput>> => storage.claimActionRun(input),
        getActionRun: (id: string) => storage.getActionRun(id),
        updateActionRun: <TResult extends JsonValue = JsonValue>(
            id: string,
            input: UpdateActionRunInput<TResult>,
        ) => storage.updateActionRun(id, input),
        saveSnapshot: <TValue extends JsonValue = JsonValue>(input: CreateSnapshotInput<TValue>) =>
            storage.saveSnapshot(input),
        getSnapshots: (actionRunId: string) => storage.getSnapshots(actionRunId),
        recordSideEffect: <TPayload extends JsonValue = JsonValue>(
            input: RecordSideEffectInput<TPayload>,
        ) => storage.recordSideEffect(input),
        getSideEffects: (actionRunId: string) => storage.getSideEffects(actionRunId),
        recordConflict: async (input) => {
            conflicts.push(input);

            return storage.recordConflict(input);
        },
        getConflicts: (actionRunId: string) => storage.getConflicts(actionRunId),
        queryActionRuns: (query) => storage.queryActionRuns(query),
        withActionRunLock: async <TValue>(
            actionRunId: string,
            handler: (run: ActionRun) => Promise<TValue>,
        ): Promise<TValue> => {
            const runBeforeLock = await storage.getActionRun(actionRunId);
            const conflictCountBeforeLock = conflicts.length;

            try {
                return await storage.withActionRunLock(actionRunId, handler);
            } catch (error) {
                conflicts.splice(conflictCountBeforeLock);

                if (runBeforeLock !== null) {
                    await storage.updateActionRun(actionRunId, {
                        status: runBeforeLock.status,
                    });
                }

                throw error;
            }
        },
    };
}
