import {
    type ActionActor,
    type ActionRunStatus,
    type ActionTarget,
    createRollbackKit,
    defineAction,
    type JsonObject,
    type JsonValue,
    REVERSIBILITY,
    type Reversibility,
    type SerializedRollbackKitError,
} from '@rollbackkit/core';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { ActionRunRow, SnapshotRow } from './mappers';
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

    async query<TResult extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: unknown[],
    ): Promise<QueryResult<TResult>> {
        this.queries.push(values === undefined ? { text } : { text, values });

        if (text.trim() === 'BEGIN' || text.trim() === 'COMMIT' || text.trim() === 'ROLLBACK') {
            return createQueryResult([]);
        }

        if (text.includes('INSERT INTO rollbackkit_action_runs')) {
            if (values === undefined) {
                throw new Error('Expected action run insert values.');
            }

            const row = createActionRunRowFromInsertValues(values);
            this.actionRunRows.set(row.id, row);

            return createQueryResult([row] as unknown as TResult[]);
        }

        if (text.includes('UPDATE rollbackkit_action_runs')) {
            if (values === undefined) {
                throw new Error('Expected action run update values.');
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
                throw new Error('Expected snapshot insert values.');
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

    return values[Number(match[1]) - 1];
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
