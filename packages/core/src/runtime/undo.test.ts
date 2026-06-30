import { describe, expect, it } from 'vitest';

import {
    type ActionActor,
    createRollbackKit,
    defineAction,
    REVERSIBILITY,
    RollbackKitError,
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

        await expect(kit.storage.getActionRun(run.id)).resolves.toMatchObject({
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
            code: 'ACTION_NOT_UNDOABLE',
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

        await expect(kit.storage.getActionRun(run.id)).resolves.toMatchObject({
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
