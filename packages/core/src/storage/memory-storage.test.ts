import { describe, expect, it } from 'vitest';

import {
    type ActionActor,
    createMemoryStorageAdapter,
    REVERSIBILITY,
    RollbackKitError,
} from '../index';

const actor: ActionActor = {
    id: 'user_1',
    type: 'user',
    displayName: 'Test User',
};

describe('MemoryStorageAdapter', () => {
    it('creates and reads action runs', async () => {
        const storage = createMemoryStorageAdapter();

        const run = await storage.createActionRun({
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
            reversibility: REVERSIBILITY.full,
        });

        expect(run.id).toBe('run_1');
        expect(run.status).toBe('created');
        expect(run.name).toBe('project.archive');

        await expect(storage.getActionRun(run.id)).resolves.toEqual(run);
    });

    it('returns defensive copies of stored action runs and snapshots', async () => {
        const storage = createMemoryStorageAdapter();
        const input = {
            projectId: 'project_1',
            metadata: {
                reason: 'cleanup',
            },
        };

        const run = await storage.createActionRun({
            name: 'project.archive',
            actor,
            input,
            reversibility: REVERSIBILITY.full,
        });

        input.metadata.reason = 'mutated after create';

        const firstRead = await storage.getActionRun(run.id);

        expect(firstRead?.input).toEqual({
            projectId: 'project_1',
            metadata: {
                reason: 'cleanup',
            },
        });

        if (firstRead === null) {
            throw new Error('Expected action run to exist.');
        }

        (firstRead.input as { metadata: { reason: string } }).metadata.reason = 'mutated read';

        await expect(storage.getActionRun(run.id)).resolves.toMatchObject({
            input: {
                projectId: 'project_1',
                metadata: {
                    reason: 'cleanup',
                },
            },
        });

        const snapshotValue = {
            status: 'active',
        };
        const snapshot = await storage.saveSnapshot({
            actionRunId: run.id,
            key: 'previousProjectState',
            value: snapshotValue,
        });

        snapshotValue.status = 'archived';
        (snapshot.value as { status: string }).status = 'mutated snapshot';

        await expect(storage.getSnapshots(run.id)).resolves.toMatchObject([
            {
                key: 'previousProjectState',
                value: {
                    status: 'active',
                },
            },
        ]);
    });

    it('updates action runs', async () => {
        const storage = createMemoryStorageAdapter();

        const run = await storage.createActionRun({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        const executedAt = new Date('2026-01-01T00:00:00.000Z');

        const updated = await storage.updateActionRun(run.id, {
            status: 'completed',
            executedAt,
            result: {
                archived: true,
            },
        });

        expect(updated.status).toBe('completed');
        expect(updated.executedAt).toEqual(executedAt);
        expect(updated.result).toEqual({
            archived: true,
        });

        await expect(storage.getActionRun(run.id)).resolves.toEqual(updated);
    });

    it('rolls back writes made inside a rejected transaction', async () => {
        const storage = createMemoryStorageAdapter();

        const run = await storage.createActionRun({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        await expect(
            storage.withTransaction(async () => {
                await storage.updateActionRun(run.id, {
                    status: 'running',
                    metadata: {
                        step: 'mutated',
                    },
                });

                await storage.saveSnapshot({
                    actionRunId: run.id,
                    key: 'previousProject',
                    value: {
                        status: 'active',
                    },
                });

                await storage.recordSideEffect({
                    actionRunId: run.id,
                    type: 'email.sent',
                    status: 'completed',
                    reversibility: REVERSIBILITY.irreversible,
                });

                await storage.recordConflict({
                    actionRunId: run.id,
                    reason: 'Concurrent change detected.',
                });

                throw new Error('transaction failed');
            }),
        ).rejects.toThrow('transaction failed');

        await expect(storage.getActionRun(run.id)).resolves.toEqual(run);
        await expect(storage.getSnapshots(run.id)).resolves.toEqual([]);
        await expect(storage.getSideEffects(run.id)).resolves.toEqual([]);
        await expect(storage.getConflicts(run.id)).resolves.toEqual([]);
    });

    it('does not roll back a concurrent committed transaction', async () => {
        const storage = createMemoryStorageAdapter();

        let releaseFirst = () => {};
        const firstCanFinish = new Promise<void>((resolve) => {
            releaseFirst = () => resolve();
        });

        let secondStarted = () => {};
        const secondDidStart = new Promise<void>((resolve) => {
            secondStarted = () => resolve();
        });

        const first = storage.withTransaction(async () => {
            await storage.createActionRun({
                name: 'project.archive',
                actor,
                input: {
                    projectId: 'project_1',
                },
                reversibility: REVERSIBILITY.full,
            });

            secondStarted();
            await firstCanFinish;

            throw new Error('first failed');
        });

        await secondDidStart;

        const second = storage.withTransaction(async () =>
            storage.createActionRun({
                name: 'member.change_role',
                actor,
                input: {
                    memberId: 'member_1',
                },
                reversibility: REVERSIBILITY.full,
            }),
        );

        releaseFirst();

        await expect(first).rejects.toThrow('first failed');
        const committed = await second;

        await expect(storage.queryActionRuns({})).resolves.toEqual([committed]);
    });

    it('does not roll back a concurrent committed write outside an explicit transaction', async () => {
        const storage = createMemoryStorageAdapter();

        const seed = await storage.createActionRun({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        let releaseFirst = () => {};
        const firstCanFinish = new Promise<void>((resolve) => {
            releaseFirst = () => resolve();
        });

        let firstStarted = () => {};
        const firstDidStart = new Promise<void>((resolve) => {
            firstStarted = () => resolve();
        });

        const first = storage.withTransaction(async () => {
            await storage.updateActionRun(seed.id, {
                status: 'running',
            });

            firstStarted();
            await firstCanFinish;

            throw new Error('first failed');
        });

        await firstDidStart;

        const second = storage.createActionRun({
            name: 'member.change_role',
            actor,
            input: {
                memberId: 'member_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        releaseFirst();

        await expect(first).rejects.toThrow('first failed');
        const committed = await second;

        await expect(storage.getActionRun(seed.id)).resolves.toEqual(seed);
        await expect(storage.getActionRun(committed.id)).resolves.toEqual(committed);
    });

    it('stores snapshots', async () => {
        const storage = createMemoryStorageAdapter();

        const run = await storage.createActionRun({
            name: 'member.change_role',
            actor,
            input: {
                memberId: 'member_1',
                role: 'admin',
            },
            reversibility: REVERSIBILITY.full,
        });

        const snapshot = await storage.saveSnapshot({
            actionRunId: run.id,
            key: 'previousRole',
            value: {
                role: 'viewer',
            },
        });

        expect(snapshot.id).toBe('snapshot_2');
        expect(snapshot.key).toBe('previousRole');

        await expect(storage.getSnapshots(run.id)).resolves.toEqual([snapshot]);
    });

    it('records side effects and conflicts', async () => {
        const storage = createMemoryStorageAdapter();

        const run = await storage.createActionRun({
            name: 'document.archive',
            actor,
            input: {
                documentId: 'document_1',
            },
            reversibility: REVERSIBILITY.partial,
        });

        const sideEffect = await storage.recordSideEffect({
            actionRunId: run.id,
            type: 'email.sent',
            status: 'completed',
            reversibility: REVERSIBILITY.irreversible,
            payload: {
                template: 'document_archived',
            },
        });

        const conflict = await storage.recordConflict({
            actionRunId: run.id,
            reason: 'Expected document to be archived, but it was deleted.',
            details: {
                documentId: 'document_1',
            },
        });

        expect(sideEffect.id).toBe('effect_2');
        expect(sideEffect.type).toBe('email.sent');
        expect(conflict.id).toBe('conflict_3');
        expect(conflict.reason).toBe('Expected document to be archived, but it was deleted.');

        await expect(storage.getSideEffects(run.id)).resolves.toEqual([sideEffect]);
        await expect(storage.getConflicts(run.id)).resolves.toEqual([conflict]);
    });

    it('queries action history', async () => {
        const storage = createMemoryStorageAdapter();

        const first = await storage.createActionRun({
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
            reversibility: REVERSIBILITY.full,
        });

        const second = await storage.createActionRun({
            name: 'member.remove',
            actor,
            tenantId: 'tenant_1',
            target: {
                id: 'member_1',
                type: 'member',
            },
            input: {
                memberId: 'member_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        const completedSecond = await storage.updateActionRun(second.id, {
            status: 'completed',
        });

        await expect(
            storage.queryActionRuns({
                tenantId: 'tenant_1',
                status: 'completed',
            }),
        ).resolves.toEqual([completedSecond]);

        await expect(
            storage.queryActionRuns({
                tenantId: 'tenant_1',
                limit: 1,
            }),
        ).resolves.toEqual([completedSecond]);

        await expect(
            storage.queryActionRuns({
                tenantId: 'tenant_1',
                cursor: completedSecond.id,
            }),
        ).resolves.toEqual([first]);
    });

    it('filters action history by actor type and actor id together', async () => {
        const storage = createMemoryStorageAdapter();

        const userRun = await storage.createActionRun({
            name: 'project.archive',
            actor: {
                id: 'actor_1',
                type: 'user',
            },
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        await storage.createActionRun({
            name: 'system.reconcile',
            actor: {
                id: 'actor_1',
                type: 'system',
            },
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        await expect(
            storage.queryActionRuns({
                actorId: 'actor_1',
                actorType: 'user',
            }),
        ).resolves.toEqual([userRun]);
    });

    it('serializes lock handlers for the same action run', async () => {
        const storage = createMemoryStorageAdapter();

        const run = await storage.createActionRun({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        const order: string[] = [];

        let releaseFirst = () => {};
        let markFirstStarted = () => {};

        const firstRelease = new Promise<void>((resolve) => {
            releaseFirst = () => resolve();
        });

        const firstStarted = new Promise<void>((resolve) => {
            markFirstStarted = () => resolve();
        });

        const first = storage.withActionRunLock(run.id, async () => {
            order.push('first:start');
            markFirstStarted();

            await firstRelease;

            order.push('first:end');

            return 'first';
        });

        const second = storage.withActionRunLock(run.id, async () => {
            order.push('second:start');
            order.push('second:end');

            return 'second';
        });

        await firstStarted;

        expect(order).toEqual(['first:start']);

        releaseFirst();

        await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);

        expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
    });

    it('throws when mutating a missing action run', async () => {
        const storage = createMemoryStorageAdapter();

        await expect(
            storage.updateActionRun('missing_run', {
                status: 'completed',
            }),
        ).rejects.toBeInstanceOf(RollbackKitError);
    });
});
