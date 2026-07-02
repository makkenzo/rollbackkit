import { describe, expect, it } from 'vitest';

import {
    type ActionActor,
    type ActionSideEffect,
    createRollbackKit,
    defineAction,
    type JsonValue,
    MemoryStorageAdapter,
    REVERSIBILITY,
    type RecordSideEffectInput,
    RollbackKitError,
} from '../index';

const actor: ActionActor = {
    id: 'user_1',
    type: 'user',
    displayName: 'Test User',
};

const noopUndo = async () => ({});

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
                    undo: noopUndo,
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

        await expect(kit.getActionRun(run.id)).resolves.toEqual(run);
    });

    it('runs new action execution inside a storage transaction', async () => {
        class TransactionalMemoryStorage extends MemoryStorageAdapter {
            transactionCount = 0;

            async withTransaction<TValue>(handler: () => Promise<TValue>): Promise<TValue> {
                this.transactionCount += 1;
                return handler();
            }
        }

        const storage = new TransactionalMemoryStorage();
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
                    undo: noopUndo,
                }),
            ],
        });

        await kit.execute({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
        });

        expect(storage.transactionCount).toBe(1);
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
                    undo: noopUndo,
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
                    undo: noopUndo,
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

        await expect(kit.getSnapshots(run.id)).resolves.toMatchObject([
            {
                actionRunId: run.id,
                key: 'previousRole',
                value: {
                    role: 'viewer',
                },
            },
        ]);
    });

    it('allows execute handlers to record side effects', async () => {
        class SideEffectMemoryStorage extends MemoryStorageAdapter {
            recordedSideEffectTypes: string[] = [];

            override async recordSideEffect<TPayload extends JsonValue = JsonValue>(
                input: RecordSideEffectInput<TPayload>,
            ): Promise<ActionSideEffect<TPayload>> {
                this.recordedSideEffectTypes.push(input.type);
                return super.recordSideEffect(input);
            }
        }

        const storage = new SideEffectMemoryStorage();
        const kit = createRollbackKit({
            storage,
            actions: [
                defineAction({
                    name: 'member.invite',
                    reversibility: REVERSIBILITY.full,
                    preview: async () => ({
                        title: 'Invite member',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async (context) => {
                        await context.sideEffects.record({
                            type: 'email.invitation',
                            status: 'completed',
                            reversibility: REVERSIBILITY.compensating,
                            payload: {
                                email: 'grace@example.com',
                            },
                        });

                        return {};
                    },
                    undo: noopUndo,
                }),
            ],
        });

        await kit.execute({
            name: 'member.invite',
            actor,
            input: {
                email: 'grace@example.com',
            },
        });

        expect(storage.recordedSideEffectTypes).toEqual(['email.invitation']);
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
                    undo: noopUndo,
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
                    undo: noopUndo,
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
            kit.queryActionRuns({
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
                    undo: noopUndo,
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
                    undo: noopUndo,
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
                    undo: noopUndo,
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

    it('rejects idempotency key reuse with the same input and a different target', async () => {
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
                    undo: noopUndo,
                }),
            ],
        });

        await kit.execute({
            name: 'project.archive',
            actor,
            idempotencyKey: 'request_1',
            target: {
                id: 'project_1',
                type: 'project',
            },
            input: {
                dryRun: false,
            },
        });

        await expect(
            kit.execute({
                name: 'project.archive',
                actor,
                idempotencyKey: 'request_1',
                target: {
                    id: 'project_2',
                    type: 'project',
                },
                input: {
                    dryRun: false,
                },
            }),
        ).rejects.toMatchObject({
            code: 'IDEMPOTENCY_CONFLICT',
        });

        expect(executionCount).toBe(1);
    });

    it('rejects executing undoable actions without an undo handler', async () => {
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
