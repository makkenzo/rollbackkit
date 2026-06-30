import {
    type ActionActor,
    type ActionRunStatus,
    type ActionTarget,
    type JsonObject,
    type JsonValue,
    REVERSIBILITY,
    type Reversibility,
} from '@rollbackkit/core';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { ActionRunRow } from './mappers';
import type { PostgresQueryExecutor } from './migration-runner';
import { createPostgresStore } from './store';

interface RecordedQuery {
    readonly text: string;
    readonly values?: unknown[];
}

class FakePostgresExecutor implements PostgresQueryExecutor {
    readonly queries: RecordedQuery[] = [];
    readonly actionRunRows = new Map<string, ActionRunRow>();

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

function createQueryResult<TResult extends QueryResultRow>(rows: TResult[]): QueryResult<TResult> {
    return {
        command: '',
        rowCount: rows.length,
        oid: 0,
        fields: [],
        rows,
    };
}
