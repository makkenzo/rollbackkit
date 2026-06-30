import {
    type ActionActor,
    type ActionTarget,
    REVERSIBILITY,
    RollbackKitError,
    type StorageAdapter,
} from '@rollbackkit/core';

import { describe, expect, it } from 'vitest';

import { createPostgresStore } from '../../src/store';
import { FakePostgresExecutor } from '../helpers/fake-postgres-executor';

const actor: ActionActor = {
    id: 'user_1',
    type: 'user',
    displayName: 'Test User',
};

const target: ActionTarget = {
    id: 'project_1',
    type: 'project',
    label: 'Demo Project',
};

describe('PostgresStore action runs', () => {
    it('implements the core storage adapter contract', () => {
        const executor = new FakePostgresExecutor();
        const store: StorageAdapter = createPostgresStore({ executor });

        expect(store).toBeDefined();
    });

    it('creates action runs', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const undoExpiresAt = new Date('2026-01-01T00:01:00.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const run = await store.createActionRun({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            target,
            input: {
                projectId: 'project_1',
            },
            inputHash: 'hash_1',
            reversibility: REVERSIBILITY.full,
            undoExpiresAt,
            metadata: {
                source: 'test',
            },
        });

        expect(run).toEqual({
            id: expect.stringMatching(
                /^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
            ),
            name: 'project.archive',
            status: 'created',
            actor,
            tenantId: 'tenant_1',
            target,
            input: {
                projectId: 'project_1',
            },
            inputHash: 'hash_1',
            reversibility: REVERSIBILITY.full,
            createdAt: now,
            undoExpiresAt,
            metadata: {
                source: 'test',
            },
        });

        const insertQuery = executor.queries[0];

        if (insertQuery === undefined || insertQuery.values === undefined) {
            throw new Error('Expected insert query to be recorded.');
        }

        expect(insertQuery.text).toContain('INSERT INTO rollbackkit_action_runs');
        expect(insertQuery.values[0]).toMatch(/^run_/);
        expect(insertQuery.values[1]).toBe('project.archive');
        expect(insertQuery.values[2]).toBe('created');
        expect(insertQuery.values[3]).toBe('user_1');
        expect(insertQuery.values[4]).toBe('user');
        expect(insertQuery.values[6]).toBe('tenant_1');
        expect(insertQuery.values[7]).toBe('project');
        expect(insertQuery.values[8]).toBe('project_1');
        expect(insertQuery.values[12]).toBeNull();
        expect(insertQuery.values[15]).toEqual(undoExpiresAt);
    });

    it('reads action runs by id', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const created = await store.createActionRun({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        await expect(store.getActionRun(created.id)).resolves.toEqual(created);
    });

    it('claims idempotent action runs without creating duplicates', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const first = await store.claimActionRun({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            target,
            input: {
                projectId: 'project_1',
            },
            inputHash: 'fnv1a64:hash_1',
            idempotencyKey: 'request_1',
            reversibility: REVERSIBILITY.full,
        });

        const second = await store.claimActionRun({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            target,
            input: {
                projectId: 'project_1',
            },
            inputHash: 'fnv1a64:hash_1',
            idempotencyKey: 'request_1',
            reversibility: REVERSIBILITY.full,
        });

        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.run).toEqual(first.run);
        expect(first.run.idempotencyKey).toBe('request_1');
        expect(first.run.inputHash).toBe('fnv1a64:hash_1');
        expect(executor.actionRunRows.size).toBe(1);

        const insertQuery = executor.queries.find((query) =>
            query.text.includes('INSERT INTO rollbackkit_action_runs'),
        );

        expect(insertQuery?.text).toContain('ON CONFLICT');
        expect(insertQuery?.text).toContain('idempotency_key');
    });

    it('updates action runs', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const executedAt = new Date('2026-01-01T00:00:01.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const created = await store.createActionRun({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        const updated = await store.updateActionRun(created.id, {
            status: 'completed',
            executedAt,
            result: {
                archived: true,
            },
            metadata: {
                source: 'execute',
            },
        });

        expect(updated).toEqual({
            ...created,
            status: 'completed',
            executedAt,
            result: {
                archived: true,
            },
            metadata: {
                source: 'execute',
            },
        });

        const updateQuery = executor.queries.find((query) =>
            query.text.includes('UPDATE rollbackkit_action_runs'),
        );

        expect(updateQuery?.text).toContain('status = $2');
        expect(updateQuery?.text).toContain('executed_at = $3');
        expect(updateQuery?.text).toContain('result = $4::jsonb');
        expect(updateQuery?.text).toContain('metadata = $5::jsonb');
        expect(updateQuery?.values).toEqual([
            created.id,
            'completed',
            executedAt,
            '{"archived":true}',
            '{"source":"execute"}',
        ]);
    });

    it('preserves JSON null when updating action run result fields', async () => {
        const executor = new FakePostgresExecutor();
        const store = createPostgresStore({ executor });

        const created = await store.createActionRun({
            name: 'project.archive',
            actor,
            input: {},
            reversibility: REVERSIBILITY.full,
        });

        const updated = await store.updateActionRun(created.id, {
            status: 'undone',
            result: null,
            undoResult: null,
        });

        expect(updated).toEqual({
            ...created,
            status: 'undone',
            result: null,
            undoResult: null,
        });

        const updateQuery = executor.queries.find((query) =>
            query.text.includes('UPDATE rollbackkit_action_runs'),
        );

        expect(updateQuery?.values).toEqual([created.id, 'undone', 'null', 'null']);
    });

    it('updates undo fields', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const undoStartedAt = new Date('2026-01-01T00:00:05.000Z');
        const undoneAt = new Date('2026-01-01T00:00:06.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const created = await store.createActionRun({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        const updated = await store.updateActionRun(created.id, {
            status: 'undone',
            undoStartedAt,
            undoneAt,
            undoneBy: actor,
            undoResult: {
                restored: true,
            },
        });

        expect(updated).toEqual({
            ...created,
            status: 'undone',
            undoStartedAt,
            undoneAt,
            undoneBy: actor,
            undoResult: {
                restored: true,
            },
        });
    });

    it('returns existing action run for empty updates', async () => {
        const executor = new FakePostgresExecutor();
        const store = createPostgresStore({ executor });

        const created = await store.createActionRun({
            name: 'project.archive',
            actor,
            input: {},
            reversibility: REVERSIBILITY.full,
        });

        await expect(store.updateActionRun(created.id, {})).resolves.toEqual(created);

        const updateQuery = executor.queries.find((query) =>
            query.text.includes('UPDATE rollbackkit_action_runs'),
        );

        expect(updateQuery).toBeUndefined();
    });

    it('preserves required JSON null action input and snapshot values separately from SQL NULL metadata', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const run = await store.createActionRun({
            name: 'project.archive',
            actor,
            input: null,
            reversibility: REVERSIBILITY.full,
        });

        expect(run.input).toBeNull();

        const snapshot = await store.saveSnapshot({
            actionRunId: run.id,
            key: 'previousState',
            value: null,
        });

        expect(snapshot.value).toBeNull();

        const actionRunInsertQuery = executor.queries.find((query) =>
            query.text.includes('INSERT INTO rollbackkit_action_runs'),
        );
        const snapshotInsertQuery = executor.queries.find((query) =>
            query.text.includes('INSERT INTO rollbackkit_snapshots'),
        );

        expect(actionRunInsertQuery?.values?.[10]).toBe('null');
        expect(actionRunInsertQuery?.values?.[16]).toBeNull();
        expect(snapshotInsertQuery?.values?.[3]).toBe('null');
        expect(snapshotInsertQuery?.values?.[5]).toBeNull();
    });

    it('throws when updating a missing action run', async () => {
        const executor = new FakePostgresExecutor();
        const store = createPostgresStore({ executor });

        await expect(
            store.updateActionRun('missing_run', {
                status: 'completed',
            }),
        ).rejects.toBeInstanceOf(RollbackKitError);
    });

    it('saves snapshots', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const run = await store.createActionRun({
            name: 'member.change_role',
            actor,
            input: {
                memberId: 'member_1',
                role: 'admin',
            },
            reversibility: REVERSIBILITY.full,
        });

        const snapshot = await store.saveSnapshot({
            actionRunId: run.id,
            key: 'previousRole',
            value: {
                role: 'viewer',
            },
            metadata: {
                source: 'execute',
            },
        });

        expect(snapshot).toEqual({
            id: expect.stringMatching(
                /^snapshot_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
            ),
            actionRunId: run.id,
            key: 'previousRole',
            value: {
                role: 'viewer',
            },
            createdAt: now,
            metadata: {
                source: 'execute',
            },
        });

        const insertQuery = executor.queries.find((query) =>
            query.text.includes('INSERT INTO rollbackkit_snapshots'),
        );

        expect(insertQuery?.values).toEqual([
            expect.stringMatching(/^snapshot_/),
            run.id,
            'previousRole',
            '{"role":"viewer"}',
            now,
            '{"source":"execute"}',
        ]);
    });

    it('reads snapshots by action run id', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const run = await store.createActionRun({
            name: 'member.change_role',
            actor,
            input: {
                memberId: 'member_1',
                role: 'admin',
            },
            reversibility: REVERSIBILITY.full,
        });

        const first = await store.saveSnapshot({
            actionRunId: run.id,
            key: 'previousRole',
            value: {
                role: 'viewer',
            },
        });

        const second = await store.saveSnapshot({
            actionRunId: run.id,
            key: 'previousPermissions',
            value: {
                canInvite: false,
            },
        });

        await expect(store.getSnapshots(run.id)).resolves.toEqual([first, second]);
    });

    it('returns an empty snapshot list when action run has no snapshots', async () => {
        const executor = new FakePostgresExecutor();
        const store = createPostgresStore({ executor });

        await expect(store.getSnapshots('run_without_snapshots')).resolves.toEqual([]);
    });

    it('records side effects', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const run = await store.createActionRun({
            name: 'document.archive',
            actor,
            input: {
                documentId: 'document_1',
            },
            reversibility: REVERSIBILITY.partial,
        });

        const sideEffect = await store.recordSideEffect({
            actionRunId: run.id,
            type: 'email.sent',
            status: 'completed',
            reversibility: REVERSIBILITY.irreversible,
            payload: {
                template: 'document_archived',
            },
            metadata: {
                provider: 'test',
            },
        });

        expect(sideEffect).toEqual({
            id: expect.stringMatching(
                /^effect_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
            ),
            actionRunId: run.id,
            type: 'email.sent',
            status: 'completed',
            reversibility: REVERSIBILITY.irreversible,
            payload: {
                template: 'document_archived',
            },
            createdAt: now,
            metadata: {
                provider: 'test',
            },
        });

        const insertQuery = executor.queries.find((query) =>
            query.text.includes('INSERT INTO rollbackkit_side_effects'),
        );

        expect(insertQuery?.values).toEqual([
            expect.stringMatching(/^effect_/),
            run.id,
            'email.sent',
            'completed',
            '{"kind":"irreversible","undoable":false}',
            '{"template":"document_archived"}',
            now,
            '{"provider":"test"}',
        ]);
    });

    it('preserves JSON null side effect payload separately from absent metadata', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const run = await store.createActionRun({
            name: 'document.archive',
            actor,
            input: {},
            reversibility: REVERSIBILITY.partial,
        });

        const sideEffect = await store.recordSideEffect({
            actionRunId: run.id,
            type: 'email.sent',
            status: 'completed',
            reversibility: REVERSIBILITY.irreversible,
            payload: null,
        });

        expect(sideEffect.id).toMatch(
            /^effect_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        expect(sideEffect).toEqual({
            id: sideEffect.id,
            actionRunId: run.id,
            type: 'email.sent',
            status: 'completed',
            reversibility: REVERSIBILITY.irreversible,
            payload: null,
            createdAt: now,
        });

        const insertQuery = executor.queries.find((query) =>
            query.text.includes('INSERT INTO rollbackkit_side_effects'),
        );

        expect(insertQuery?.values?.[5]).toBe('null');
        expect(insertQuery?.values?.[7]).toBeNull();
    });

    it('records side effects without optional payload and metadata', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const run = await store.createActionRun({
            name: 'document.archive',
            actor,
            input: {},
            reversibility: REVERSIBILITY.partial,
        });

        const sideEffect = await store.recordSideEffect({
            actionRunId: run.id,
            type: 'notification.created',
            status: 'planned',
            reversibility: REVERSIBILITY.full,
        });

        expect(sideEffect).toEqual({
            id: expect.stringMatching(/^effect_/),
            actionRunId: run.id,
            type: 'notification.created',
            status: 'planned',
            reversibility: REVERSIBILITY.full,
            createdAt: now,
        });
    });

    it('records conflicts', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const run = await store.createActionRun({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        const conflict = await store.recordConflict({
            actionRunId: run.id,
            reason: 'Expected project to be archived, but it was deleted.',
            details: {
                projectId: 'project_1',
            },
        });

        expect(conflict).toEqual({
            id: expect.stringMatching(
                /^conflict_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
            ),
            actionRunId: run.id,
            reason: 'Expected project to be archived, but it was deleted.',
            details: {
                projectId: 'project_1',
            },
            createdAt: now,
        });

        const insertQuery = executor.queries.find((query) =>
            query.text.includes('INSERT INTO rollbackkit_conflicts'),
        );

        expect(insertQuery?.values).toEqual([
            expect.stringMatching(/^conflict_/),
            run.id,
            'Expected project to be archived, but it was deleted.',
            '{"projectId":"project_1"}',
            now,
        ]);
    });

    it('records conflicts without optional details', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const run = await store.createActionRun({
            name: 'project.archive',
            actor,
            input: {},
            reversibility: REVERSIBILITY.full,
        });

        const conflict = await store.recordConflict({
            actionRunId: run.id,
            reason: 'Target was changed after the original action.',
        });

        expect(conflict).toEqual({
            id: expect.stringMatching(/^conflict_/),
            actionRunId: run.id,
            reason: 'Target was changed after the original action.',
            createdAt: now,
        });
    });

    it('queries action runs with filters', async () => {
        let now = new Date('2026-01-01T00:00:00.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const first = await store.createActionRun({
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

        now = new Date('2026-01-01T00:00:01.000Z');

        const second = await store.createActionRun({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            target: {
                id: 'project_2',
                type: 'project',
            },
            input: {
                projectId: 'project_2',
            },
            reversibility: REVERSIBILITY.full,
        });

        now = new Date('2026-01-01T00:00:02.000Z');

        await store.createActionRun({
            name: 'member.remove',
            actor: {
                id: 'user_2',
                type: 'user',
            },
            tenantId: 'tenant_2',
            target: {
                id: 'member_1',
                type: 'member',
            },
            input: {
                memberId: 'member_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        await expect(
            store.queryActionRuns({
                tenantId: 'tenant_1',
                name: 'project.archive',
            }),
        ).resolves.toEqual([second, first]);

        const historyQuery = executor.queries.find(
            (query) =>
                query.text.includes('FROM rollbackkit_action_runs') &&
                query.text.includes('ORDER BY created_at DESC, id DESC') &&
                query.text.includes('tenant_id ='),
        );

        expect(historyQuery?.text).toContain('tenant_id = $1');
        expect(historyQuery?.text).toContain('name = $2');
        expect(historyQuery?.values).toEqual(['tenant_1', 'project.archive']);
    });

    it('queries action runs by actor, target and status', async () => {
        let now = new Date('2026-01-01T00:00:00.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const first = await store.createActionRun({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            target,
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        const completed = await store.updateActionRun(first.id, {
            status: 'completed',
        });

        now = new Date('2026-01-01T00:00:01.000Z');

        await store.createActionRun({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            target: {
                id: 'project_2',
                type: 'project',
            },
            input: {
                projectId: 'project_2',
            },
            reversibility: REVERSIBILITY.full,
        });

        await expect(
            store.queryActionRuns({
                actorId: actor.id,
                targetType: target.type,
                targetId: target.id,
                status: 'completed',
            }),
        ).resolves.toEqual([completed]);
    });

    it('queries action runs with cursor and limit', async () => {
        let now = new Date('2026-01-01T00:00:00.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const first = await store.createActionRun({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        now = new Date('2026-01-01T00:00:01.000Z');

        const second = await store.createActionRun({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            input: {
                projectId: 'project_2',
            },
            reversibility: REVERSIBILITY.full,
        });

        now = new Date('2026-01-01T00:00:02.000Z');

        const third = await store.createActionRun({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            input: {
                projectId: 'project_3',
            },
            reversibility: REVERSIBILITY.full,
        });

        await expect(
            store.queryActionRuns({
                tenantId: 'tenant_1',
                limit: 2,
            }),
        ).resolves.toEqual([third, second]);

        await expect(
            store.queryActionRuns({
                tenantId: 'tenant_1',
                cursor: third.id,
                limit: 1,
            }),
        ).resolves.toEqual([second]);

        await expect(
            store.queryActionRuns({
                tenantId: 'tenant_1',
                cursor: second.id,
            }),
        ).resolves.toEqual([first]);
    });

    it('ignores missing or non-matching cursors', async () => {
        let now = new Date('2026-01-01T00:00:00.000Z');
        const executor = new FakePostgresExecutor();

        const store = createPostgresStore({
            executor,
            clock: {
                now: () => now,
            },
        });

        const first = await store.createActionRun({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        now = new Date('2026-01-01T00:00:01.000Z');

        const second = await store.createActionRun({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_1',
            input: {
                projectId: 'project_2',
            },
            reversibility: REVERSIBILITY.full,
        });

        const otherTenantCursor = await store.createActionRun({
            name: 'project.archive',
            actor,
            tenantId: 'tenant_2',
            input: {
                projectId: 'project_3',
            },
            reversibility: REVERSIBILITY.full,
        });

        await expect(
            store.queryActionRuns({
                tenantId: 'tenant_1',
                cursor: 'missing_run',
            }),
        ).resolves.toEqual([second, first]);

        await expect(
            store.queryActionRuns({
                tenantId: 'tenant_1',
                cursor: otherTenantCursor.id,
            }),
        ).resolves.toEqual([second, first]);
    });

    it('returns an empty action history when limit is zero', async () => {
        const executor = new FakePostgresExecutor();
        const store = createPostgresStore({ executor });

        await expect(
            store.queryActionRuns({
                limit: 0,
            }),
        ).resolves.toEqual([]);

        const historyQuery = executor.queries.find(
            (query) =>
                query.text.includes('FROM rollbackkit_action_runs') &&
                query.text.includes('ORDER BY created_at DESC, id DESC'),
        );

        expect(historyQuery).toBeUndefined();
    });

    it('runs locked action handlers inside a transaction', async () => {
        const executor = new FakePostgresExecutor();
        const store = createPostgresStore({ executor });

        const created = await store.createActionRun({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        const handlerResult = await store.withActionRunLock(created.id, async (lockedRun) => {
            expect(lockedRun).toEqual(created);

            await store.updateActionRun(lockedRun.id, {
                status: 'completed',
            });

            return {
                ok: true,
            };
        });

        expect(handlerResult).toEqual({
            ok: true,
        });

        const transactionQueries = executor.queries
            .map((query) => query.text.trim())
            .filter(
                (text) =>
                    text === 'BEGIN' ||
                    text === 'COMMIT' ||
                    text === 'ROLLBACK' ||
                    text.includes('FOR UPDATE') ||
                    text.includes('UPDATE rollbackkit_action_runs'),
            );

        expect(transactionQueries).toEqual([
            'BEGIN',
            expect.stringContaining('FOR UPDATE'),
            expect.stringContaining('UPDATE rollbackkit_action_runs'),
            'COMMIT',
        ]);

        await expect(store.getActionRun(created.id)).resolves.toMatchObject({
            status: 'completed',
        });
    });

    it('rolls back locked handlers when the handler throws', async () => {
        const executor = new FakePostgresExecutor();
        const store = createPostgresStore({ executor });

        const created = await store.createActionRun({
            name: 'project.archive',
            actor,
            input: {
                projectId: 'project_1',
            },
            reversibility: REVERSIBILITY.full,
        });

        await expect(
            store.withActionRunLock(created.id, async () => {
                throw new Error('Handler failed.');
            }),
        ).rejects.toThrow('Handler failed.');

        const transactionQueries = executor.queries
            .map((query) => query.text.trim())
            .filter((text) => text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK');

        expect(transactionQueries).toEqual(['BEGIN', 'ROLLBACK']);
    });

    it('rolls back when locking a missing action run', async () => {
        const executor = new FakePostgresExecutor();
        const store = createPostgresStore({ executor });

        await expect(
            store.withActionRunLock('missing_run', async () => {
                throw new Error('Handler should not run.');
            }),
        ).rejects.toBeInstanceOf(RollbackKitError);

        const transactionQueries = executor.queries
            .map((query) => query.text.trim())
            .filter((text) => text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK');

        expect(transactionQueries).toEqual(['BEGIN', 'ROLLBACK']);
    });

    it('returns null when action run does not exist', async () => {
        const executor = new FakePostgresExecutor();
        const store = createPostgresStore({ executor });

        await expect(store.getActionRun('missing_run')).resolves.toBeNull();
    });
});
