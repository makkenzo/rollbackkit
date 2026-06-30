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

describe('RollbackKit execute lifecycle', () => {
    it('executes an action and stores completed action run', async () => {
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
                    execute: async () => ({
                        data: {
                            archived: true,
                        },
                    }),
                }),
            ],
        });

        const run = await kit.execute({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            target: {
                id: 'project_1',
                type: 'project',
            },
            input: {
                projectId: 'project_1',
            },
        });

        expect(run.status).toBe('completed');
        expect(run.name).toBe('project.archive');
        expect(run.actor).toEqual(actor);
        expect(run.tenantId).toBe('tenant_1');
        expect(run.target).toEqual({
            id: 'project_1',
            type: 'project',
        });
        expect(run.result).toEqual({
            archived: true,
        });

        await expect(kit.storage.getActionRun(run.id)).resolves.toEqual(run);
    });

    it('passes resolved target into execute context', async () => {
        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    resolveTarget: async () => ({
                        id: 'project_1',
                        type: 'project',
                        label: 'Demo project',
                    }),
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async (context) => ({
                        data: {
                            targetLabel: context.target?.label ?? null,
                        },
                    }),
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

        expect(run.result).toEqual({
            targetLabel: 'Demo project',
        });
    });

    it('allows execute handlers to save snapshots', async () => {
        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'member.change_role',
                    reversibility: REVERSIBILITY.full,
                    preview: async () => ({
                        title: 'Change role',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async (context) => {
                        await context.snapshots.save('previousRole', {
                            role: 'viewer',
                        });

                        return {
                            data: {
                                role: 'admin',
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

        await expect(kit.storage.getSnapshots(run.id)).resolves.toMatchObject([
            {
                actionRunId: run.id,
                key: 'previousRole',
                value: {
                    role: 'viewer',
                },
            },
        ]);
    });

    it('checks execute permission', async () => {
        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    authorize: async (context) => ({
                        allowed: context.phase !== 'execute',
                        reason: 'Only owners can execute this action.',
                    }),
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
            code: 'ACTION_PERMISSION_DENIED',
        });
    });

    it('marks action run as failed when execute throws', async () => {
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
                    execute: async () => {
                        throw new Error('Database write failed.');
                    },
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
            code: 'ACTION_EXECUTION_FAILED',
        });

        await expect(
            kit.storage.queryActionRuns({
                name: 'project.archive',
            }),
        ).resolves.toMatchObject([
            {
                status: 'failed',
                error: {
                    code: 'ACTION_EXECUTION_FAILED',
                    message: 'Action "project.archive" execution failed.',
                },
            },
        ]);
    });

    it('stores undo expiration for undoable actions', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');

        const kit = createRollbackKit({
            clock: {
                now: () => now,
            },
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    undoWindowMs: 30_000,
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

        expect(run.undoExpiresAt).toEqual(new Date('2026-01-01T00:00:30.000Z'));
    });

    it('returns the existing action run for repeated idempotent execute requests', async () => {
        let executionCount = 0;

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
                    execute: async () => {
                        executionCount += 1;

                        return {
                            data: {
                                executionCount,
                            },
                        };
                    },
                }),
            ],
        });

        const first = await kit.execute({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            idempotencyKey: 'request_1',
            input: {
                projectId: 'project_1',
                reason: 'cleanup',
            },
        });

        const second = await kit.execute({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            idempotencyKey: 'request_1',
            input: {
                reason: 'cleanup',
                projectId: 'project_1',
            },
        });

        expect(second).toEqual(first);
        expect(first.idempotencyKey).toBe('request_1');
        expect(first.inputHash).toMatch(/^fnv1a64:/);
        expect(executionCount).toBe(1);
    });

    it('rejects idempotency key reuse with different input', async () => {
        let executionCount = 0;

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
                    execute: async () => {
                        executionCount += 1;

                        return {};
                    },
                }),
            ],
        });

        await kit.execute({
            name: 'project.archive',
            actor,
            idempotencyKey: 'request_1',
            input: {
                projectId: 'project_1',
            },
        });

        await expect(
            kit.execute({
                name: 'project.archive',
                actor,
                idempotencyKey: 'request_1',
                input: {
                    projectId: 'project_2',
                },
            }),
        ).rejects.toMatchObject({
            code: 'IDEMPOTENCY_CONFLICT',
        });

        expect(executionCount).toBe(1);
    });

    it('does not store undo expiration for irreversible actions', async () => {
        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.hard_delete',
                    reversibility: REVERSIBILITY.irreversible,
                    undoWindowMs: 30_000,
                    preview: async () => ({
                        title: 'Hard delete project',
                        impact: [],
                        reversibility: REVERSIBILITY.irreversible,
                    }),
                    execute: async () => ({}),
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

        expect(run.undoExpiresAt).toBeUndefined();
    });

    it('throws for missing actions', async () => {
        const kit = createRollbackKit();

        await expect(
            kit.execute({
                name: 'missing.action',
                actor,
                input: {},
            }),
        ).rejects.toBeInstanceOf(RollbackKitError);
    });
});
