import {
    type ActionActor,
    type ActionTarget,
    createRollbackKit,
    defineAction,
    REVERSIBILITY,
} from '@rollbackkit/core';

import { describe, expect, it } from 'vitest';

import { createPostgresStore } from '../../src/store';
import { FakePostgresExecutor } from '../helpers/fake-postgres-executor';

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

const target: ActionTarget = {
    id: 'project_1',
    type: 'project',
    label: 'Demo Project',
};

describe('PostgresStore core lifecycle integration', () => {
    it('runs execute lifecycle through PostgresStore', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const clock = {
            now: () => now,
        };

        const executor = new FakePostgresExecutor();
        const store = createPostgresStore({
            executor,
            clock,
        });

        const kit = createRollbackKit({
            storage: store,
            clock,
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    undoWindowMs: 60_000,
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async (context) => {
                        await context.snapshots.save('previousProjectState', {
                            archived: false,
                        });

                        return {
                            data: {
                                archived: true,
                            },
                        };
                    },
                    undo: async () => ({}),
                }),
            ],
        });

        const run = await kit.execute({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            target,
            input: {
                projectId: 'project_1',
            },
        });

        expect(run).toEqual({
            id: expect.stringMatching(/^run_/),
            name: 'project.archive',
            status: 'completed',
            actor,
            tenantId: 'tenant_1',
            target,
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
            createdAt: now,
            executedAt: now,
            undoExpiresAt: new Date('2026-01-01T00:01:00.000Z'),
            result: {
                archived: true,
            },
        });

        await expect(store.getActionRun(run.id)).resolves.toEqual(run);

        await expect(store.getSnapshots(run.id)).resolves.toMatchObject([
            {
                actionRunId: run.id,
                key: 'previousProjectState',
                value: {
                    archived: false,
                },
                createdAt: now,
            },
        ]);

        const relevantQueries = executor.queries
            .map((query) => query.text)
            .filter(
                (text) =>
                    text.includes('INSERT INTO rollbackkit_action_runs') ||
                    text.includes('UPDATE rollbackkit_action_runs') ||
                    text.includes('INSERT INTO rollbackkit_snapshots'),
            );

        expect(relevantQueries).toHaveLength(4);
        expect(relevantQueries[0]).toContain('INSERT INTO rollbackkit_action_runs');
        expect(relevantQueries[1]).toContain('UPDATE rollbackkit_action_runs');
        expect(relevantQueries[2]).toContain('INSERT INTO rollbackkit_snapshots');
        expect(relevantQueries[3]).toContain('UPDATE rollbackkit_action_runs');
    });

    it('runs undo lifecycle through PostgresStore lock and snapshot reader', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const clock = {
            now: () => now,
        };

        let archived = false;

        const executor = new FakePostgresExecutor();
        const store = createPostgresStore({
            executor,
            clock,
        });

        const kit = createRollbackKit({
            storage: store,
            clock,
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    undoWindowMs: 60_000,
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async (context) => {
                        await context.snapshots.save('previousProjectState', {
                            archived,
                        });

                        archived = true;

                        return {
                            data: {
                                archived,
                            },
                        };
                    },
                    undo: async (context) => {
                        const snapshot = await context.snapshots.get<{
                            readonly archived: boolean;
                        }>('previousProjectState');

                        if (snapshot === null) {
                            throw new Error('Expected previousProjectState snapshot.');
                        }

                        archived = snapshot.value.archived;

                        return {
                            data: {
                                archived,
                            },
                        };
                    },
                }),
            ],
        });

        const run = await kit.execute({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            target,
            input: {
                projectId: 'project_1',
            },
        });

        expect(archived).toBe(true);

        const undone = await kit.undo({
            actionRunId: run.id,
            actor: undoActor,
        });

        expect(archived).toBe(false);

        expect(undone).toEqual({
            ...run,
            status: 'undone',
            undoStartedAt: now,
            undoneAt: now,
            undoneBy: undoActor,
            undoResult: {
                archived: false,
            },
        });

        const transactionQueries = executor.queries
            .map((query) => query.text.trim())
            .filter(
                (text) =>
                    text === 'BEGIN' ||
                    text === 'COMMIT' ||
                    text === 'ROLLBACK' ||
                    text.includes('FOR UPDATE'),
            );

        expect(transactionQueries).toEqual([
            'BEGIN',
            expect.stringContaining('FOR UPDATE'),
            'COMMIT',
        ]);
    });
});
