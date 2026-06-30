import {
    type ActionActor,
    type ActionRunStatus,
    type ActionTarget,
    type JsonObject,
    type JsonValue,
    REVERSIBILITY,
    type Reversibility,
    RollbackKitError,
    type SerializedRollbackKitError,
    type SideEffectStatus,
    type StorageAdapter,
} from '@rollbackkit/core';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { ActionConflictRow, ActionRunRow, ActionSideEffectRow, SnapshotRow } from './mappers';
import type { PostgresQueryExecutor } from './migration-runner';
import { createPostgresStore } from './store';

interface RecordedQuery {
    readonly text: string;
    readonly values?: unknown[];
}

class FakePostgresExecutor implements PostgresQueryExecutor {
    readonly queries: RecordedQuery[] = [];
    readonly actionRunRows = new Map<string, ActionRunRow>();
    readonly snapshotRows = new Map<string, SnapshotRow[]>();
    readonly sideEffectRows = new Map<string, ActionSideEffectRow[]>();
    readonly conflictRows = new Map<string, ActionConflictRow[]>();

    async query<TResult extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: unknown[],
    ): Promise<QueryResult<TResult>> {
        this.queries.push(values === undefined ? { text } : { text, values });

        if (text.includes('INSERT INTO rollbackkit_action_runs')) {
            if (values === undefined) {
                throw new Error('Expected insert query values.');
            }

            const row = createActionRunRowFromInsertValues(values);
            this.actionRunRows.set(row.id, row);

            return createQueryResult([row] as unknown as TResult[]);
        }

        if (text.includes('UPDATE rollbackkit_action_runs')) {
            if (values === undefined) {
                throw new Error('Expected update query values.');
            }

            const id = String(values[0]);
            const existing = this.actionRunRows.get(id);

            if (existing === undefined) {
                return createQueryResult([]);
            }

            const updated = applyActionRunUpdateQuery(existing, text, values);
            this.actionRunRows.set(id, updated);

            return createQueryResult([updated] as unknown as TResult[]);
        }

        if (text.includes('INSERT INTO rollbackkit_snapshots')) {
            if (values === undefined) {
                throw new Error('Expected snapshot insert query values.');
            }

            const row = createSnapshotRowFromInsertValues(values);
            const snapshots = this.snapshotRows.get(row.action_run_id) ?? [];

            snapshots.push(row);
            this.snapshotRows.set(row.action_run_id, snapshots);

            return createQueryResult([row] as unknown as TResult[]);
        }

        if (
            text.includes('FROM rollbackkit_snapshots') &&
            text.includes('WHERE action_run_id = $1')
        ) {
            const actionRunId = String(values?.[0]);
            const rows = this.snapshotRows.get(actionRunId) ?? [];

            return createQueryResult([...rows] as unknown as TResult[]);
        }

        if (text.includes('INSERT INTO rollbackkit_side_effects')) {
            if (values === undefined) {
                throw new Error('Expected side effect insert query values.');
            }

            const row = createActionSideEffectRowFromInsertValues(values);
            const sideEffects = this.sideEffectRows.get(row.action_run_id) ?? [];

            sideEffects.push(row);
            this.sideEffectRows.set(row.action_run_id, sideEffects);

            return createQueryResult([row] as unknown as TResult[]);
        }

        if (text.includes('INSERT INTO rollbackkit_conflicts')) {
            if (values === undefined) {
                throw new Error('Expected conflict insert query values.');
            }

            const row = createActionConflictRowFromInsertValues(values);
            const conflicts = this.conflictRows.get(row.action_run_id) ?? [];

            conflicts.push(row);
            this.conflictRows.set(row.action_run_id, conflicts);

            return createQueryResult([row] as unknown as TResult[]);
        }

        if (text.includes('FROM rollbackkit_action_runs') && text.includes('WHERE id = $1')) {
            const id = String(values?.[0]);
            const row = this.actionRunRows.get(id);

            return createQueryResult((row === undefined ? [] : [row]) as unknown as TResult[]);
        }

        if (
            text.includes('FROM rollbackkit_action_runs') &&
            text.includes('ORDER BY created_at DESC, id DESC')
        ) {
            const rows = applyActionHistoryQuery(
                Array.from(this.actionRunRows.values()),
                text,
                values ?? [],
            );

            return createQueryResult(rows as unknown as TResult[]);
        }

        if (text.includes('FROM rollbackkit_action_runs') && text.includes('WHERE id = $1')) {
            const id = String(values?.[0]);
            const row = this.actionRunRows.get(id);

            return createQueryResult((row === undefined ? [] : [row]) as unknown as TResult[]);
        }

        return createQueryResult([]);
    }
}

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
        expect(insertQuery.values[14]).toEqual(undoExpiresAt);
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
            {
                archived: true,
            },
            {
                source: 'execute',
            },
        ]);
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
            {
                role: 'viewer',
            },
            now,
            {
                source: 'execute',
            },
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
            REVERSIBILITY.irreversible,
            {
                template: 'document_archived',
            },
            now,
            {
                provider: 'test',
            },
        ]);
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
            {
                projectId: 'project_1',
            },
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

function createActionRunRowFromInsertValues(values: readonly unknown[]): ActionRunRow {
    return {
        id: String(values[0]),
        name: String(values[1]),
        status: values[2] as ActionRunStatus,

        actor_id: String(values[3]),
        actor_type: String(values[4]),
        actor: values[5] as ActionActor,

        tenant_id: values[6] as string | null,

        target_type: values[7] as string | null,
        target_id: values[8] as string | null,
        target: values[9] as ActionTarget | null,

        input: values[10] as JsonValue,
        input_hash: values[11] as string | null,
        reversibility: values[12] as Reversibility,

        created_at: values[13] as Date,
        executed_at: null,
        undo_expires_at: values[14] as Date | null,
        undo_started_at: null,
        undone_at: null,
        undone_by: null,

        result: null,
        undo_result: null,
        error: null,
        metadata: values[15] as JsonObject | null,
    };
}

function createSnapshotRowFromInsertValues(values: readonly unknown[]): SnapshotRow {
    return {
        id: String(values[0]),
        action_run_id: String(values[1]),
        key: String(values[2]),
        value: values[3] as JsonValue,
        created_at: values[4] as Date,
        metadata: values[5] as JsonObject | null,
    };
}

function createActionSideEffectRowFromInsertValues(
    values: readonly unknown[],
): ActionSideEffectRow {
    return {
        id: String(values[0]),
        action_run_id: String(values[1]),
        type: String(values[2]),
        status: values[3] as SideEffectStatus,
        reversibility: values[4] as Reversibility,
        payload: values[5] as JsonValue | null,
        created_at: values[6] as Date,
        metadata: values[7] as JsonObject | null,
    };
}

function createActionConflictRowFromInsertValues(values: readonly unknown[]): ActionConflictRow {
    return {
        id: String(values[0]),
        action_run_id: String(values[1]),
        reason: String(values[2]),
        details: values[3] as JsonObject | null,
        created_at: values[4] as Date,
    };
}

function applyActionRunUpdateQuery(
    row: ActionRunRow,
    text: string,
    values: readonly unknown[],
): ActionRunRow {
    return {
        ...row,
        status: readUpdatedValue(text, values, 'status', row.status) as ActionRunStatus,
        executed_at: readUpdatedValue(text, values, 'executed_at', row.executed_at) as Date | null,
        undo_started_at: readUpdatedValue(
            text,
            values,
            'undo_started_at',
            row.undo_started_at,
        ) as Date | null,
        undone_at: readUpdatedValue(text, values, 'undone_at', row.undone_at) as Date | null,
        undone_by: readUpdatedValue(text, values, 'undone_by', row.undone_by) as ActionActor | null,
        result: readUpdatedValue(text, values, 'result', row.result) as JsonValue | null,
        undo_result: readUpdatedValue(
            text,
            values,
            'undo_result',
            row.undo_result,
        ) as JsonValue | null,
        error: readUpdatedValue(
            text,
            values,
            'error',
            row.error,
        ) as SerializedRollbackKitError | null,
        metadata: readUpdatedValue(text, values, 'metadata', row.metadata) as JsonObject | null,
    };
}

function readUpdatedValue(
    text: string,
    values: readonly unknown[],
    column: string,
    currentValue: unknown,
): unknown {
    const match = new RegExp(`\\b${column}\\s*=\\s*\\$(\\d+)`).exec(text);

    if (match?.[1] === undefined) {
        return currentValue;
    }

    const valueIndex = Number(match[1]) - 1;

    return values[valueIndex];
}

function applyActionHistoryQuery(
    rows: readonly ActionRunRow[],
    text: string,
    values: readonly unknown[],
): ActionRunRow[] {
    let result = [...rows];

    result = filterBySqlColumn(result, text, values, 'tenant_id');
    result = filterBySqlColumn(result, text, values, 'actor_id');
    result = filterBySqlColumn(result, text, values, 'target_type');
    result = filterBySqlColumn(result, text, values, 'target_id');
    result = filterBySqlColumn(result, text, values, 'name');
    result = filterBySqlColumn(result, text, values, 'status');

    result = applyCursorFilter(result, text, values);

    result.sort((first, second) => {
        const firstCreatedAt = toTime(first.created_at);
        const secondCreatedAt = toTime(second.created_at);
        const byCreatedAt = secondCreatedAt - firstCreatedAt;

        if (byCreatedAt !== 0) {
            return byCreatedAt;
        }

        return second.id.localeCompare(first.id);
    });

    const limit = readLimit(text, values);

    return limit === undefined ? result : result.slice(0, limit);
}

function filterBySqlColumn(
    rows: ActionRunRow[],
    text: string,
    values: readonly unknown[],
    column: keyof ActionRunRow,
): ActionRunRow[] {
    const value = readSqlEqualsValue(text, values, String(column));

    if (value === undefined) {
        return rows;
    }

    return rows.filter((row) => row[column] === value);
}

function applyCursorFilter(
    rows: ActionRunRow[],
    text: string,
    values: readonly unknown[],
): ActionRunRow[] {
    const cursorCreatedAt = readSqlLessThanValue(text, values, 'created_at');
    const cursorId = readSqlLessThanValue(text, values, 'id');

    if (cursorCreatedAt === undefined || cursorId === undefined) {
        return rows;
    }

    const cursorCreatedAtTime = toTime(cursorCreatedAt as Date | string);
    const cursorIdValue = String(cursorId);

    return rows.filter((row) => {
        const createdAtTime = toTime(row.created_at);

        return (
            createdAtTime < cursorCreatedAtTime ||
            (createdAtTime === cursorCreatedAtTime && row.id < cursorIdValue)
        );
    });
}

function readSqlEqualsValue(text: string, values: readonly unknown[], column: string): unknown {
    const match = new RegExp(`\\b${column}\\s*=\\s*\\$(\\d+)`).exec(text);

    if (match?.[1] === undefined) {
        return undefined;
    }

    return values[Number(match[1]) - 1];
}

function readSqlLessThanValue(text: string, values: readonly unknown[], column: string): unknown {
    const match = new RegExp(`\\b${column}\\s*<\\s*\\$(\\d+)`).exec(text);

    if (match?.[1] === undefined) {
        return undefined;
    }

    return values[Number(match[1]) - 1];
}

function readLimit(text: string, values: readonly unknown[]): number | undefined {
    const match = /\bLIMIT\s+\$(\d+)/.exec(text);

    if (match?.[1] === undefined) {
        return undefined;
    }

    return Number(values[Number(match[1]) - 1]);
}

function toTime(value: Date | string): number {
    return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function createQueryResult<TResult extends QueryResultRow>(rows: TResult[]): QueryResult<TResult> {
    return {
        command: '',
        rowCount: rows.length,
        oid: 0,
        fields: [],
        rows,
    };
}
