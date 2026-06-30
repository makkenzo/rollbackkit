import {
    type ActionRun,
    type Clock,
    type CreateActionRunInput,
    type CreateSnapshotInput,
    type JsonValue,
    RollbackKitError,
    type Snapshot,
    systemClock,
    type UpdateActionRunInput,
} from '@rollbackkit/core';

import { createRollbackKitPostgresId } from './id';
import { type ActionRunRow, mapActionRunRow, mapSnapshotRow, type SnapshotRow } from './mappers';
import type { PostgresQueryExecutor } from './migration-runner';

const ACTION_RUN_COLUMNS_SQL = `
id,
name,
status,
actor_id,
actor_type,
actor,
tenant_id,
target_type,
target_id,
target,
input,
input_hash,
reversibility,
created_at,
executed_at,
undo_expires_at,
undo_started_at,
undone_at,
undone_by,
result,
undo_result,
error,
metadata
`;

const SNAPSHOT_COLUMNS_SQL = `
id,
action_run_id,
key,
value,
created_at,
metadata
`;

export interface PostgresStoreOptions {
    readonly executor: PostgresQueryExecutor;
    readonly clock?: Clock;
}

export class PostgresStore {
    readonly #executor: PostgresQueryExecutor;
    readonly #clock: Clock;

    constructor(options: PostgresStoreOptions) {
        this.#executor = options.executor;
        this.#clock = options.clock ?? systemClock;
    }

    async createActionRun<TInput extends JsonValue = JsonValue>(
        input: CreateActionRunInput<TInput>,
    ): Promise<ActionRun<TInput>> {
        const id = createRollbackKitPostgresId('run');
        const createdAt = this.#clock.now();

        const result = await this.#executor.query<ActionRunRow>(
            `
INSERT INTO rollbackkit_action_runs (
    id,
    name,
    status,
    actor_id,
    actor_type,
    actor,
    tenant_id,
    target_type,
    target_id,
    target,
    input,
    input_hash,
    reversibility,
    created_at,
    undo_expires_at,
    metadata
)
VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6::jsonb,
    $7,
    $8,
    $9,
    $10::jsonb,
    $11::jsonb,
    $12,
    $13::jsonb,
    $14,
    $15,
    $16::jsonb
)
RETURNING ${ACTION_RUN_COLUMNS_SQL}
`,
            [
                id,
                input.name,
                'created',
                input.actor.id,
                input.actor.type,
                input.actor,
                input.tenantId === undefined ? null : input.tenantId,
                input.target === undefined ? null : input.target.type,
                input.target === undefined ? null : input.target.id,
                input.target === undefined ? null : input.target,
                input.input,
                input.inputHash === undefined ? null : input.inputHash,
                input.reversibility,
                createdAt,
                input.undoExpiresAt === undefined ? null : input.undoExpiresAt,
                input.metadata === undefined ? null : input.metadata,
            ],
        );

        const row = result.rows[0];

        if (row === undefined) {
            throw new RollbackKitError({
                code: 'STORAGE_ERROR',
                message: 'PostgreSQL did not return an action run after insert.',
                details: {
                    operation: 'createActionRun',
                },
            });
        }

        return mapActionRunRow(row) as ActionRun<TInput>;
    }

    async getActionRun(id: string): Promise<ActionRun | null> {
        const result = await this.#executor.query<ActionRunRow>(
            `
SELECT ${ACTION_RUN_COLUMNS_SQL}
FROM rollbackkit_action_runs
WHERE id = $1
`,
            [id],
        );

        const row = result.rows[0];

        return row === undefined ? null : mapActionRunRow(row);
    }

    async updateActionRun<TResult extends JsonValue = JsonValue>(
        id: string,
        input: UpdateActionRunInput<TResult>,
    ): Promise<ActionRun<JsonValue, TResult>> {
        const update = createActionRunUpdateQuery(id, input);

        if (update === null) {
            const existingRun = await this.getActionRun(id);

            if (existingRun === null) {
                throw createActionRunNotFoundError(id);
            }

            return existingRun as ActionRun<JsonValue, TResult>;
        }

        const result = await this.#executor.query<ActionRunRow>(update.text, update.values);
        const row = result.rows[0];

        if (row === undefined) {
            throw createActionRunNotFoundError(id);
        }

        return mapActionRunRow(row) as ActionRun<JsonValue, TResult>;
    }

    async saveSnapshot<TValue extends JsonValue = JsonValue>(
        input: CreateSnapshotInput<TValue>,
    ): Promise<Snapshot<TValue>> {
        const id = createRollbackKitPostgresId('snapshot');
        const createdAt = this.#clock.now();

        const result = await this.#executor.query<SnapshotRow>(
            `
INSERT INTO rollbackkit_snapshots (
    id,
    action_run_id,
    key,
    value,
    created_at,
    metadata
)
VALUES (
    $1,
    $2,
    $3,
    $4::jsonb,
    $5,
    $6::jsonb
)
RETURNING ${SNAPSHOT_COLUMNS_SQL}
`,
            [
                id,
                input.actionRunId,
                input.key,
                input.value,
                createdAt,
                input.metadata === undefined ? null : input.metadata,
            ],
        );

        const row = result.rows[0];

        if (row === undefined) {
            throw new RollbackKitError({
                code: 'STORAGE_ERROR',
                message: 'PostgreSQL did not return a snapshot after insert.',
                details: {
                    operation: 'saveSnapshot',
                    actionRunId: input.actionRunId,
                    key: input.key,
                },
            });
        }

        return mapSnapshotRow(row) as Snapshot<TValue>;
    }

    async getSnapshots(actionRunId: string): Promise<readonly Snapshot[]> {
        const result = await this.#executor.query<SnapshotRow>(
            `
SELECT ${SNAPSHOT_COLUMNS_SQL}
FROM rollbackkit_snapshots
WHERE action_run_id = $1
ORDER BY created_at ASC, id ASC
`,
            [actionRunId],
        );

        return result.rows.map(mapSnapshotRow);
    }
}

export function createPostgresStore(options: PostgresStoreOptions): PostgresStore {
    return new PostgresStore(options);
}

interface BuiltActionRunUpdateQuery {
    readonly text: string;
    readonly values: unknown[];
}

function createActionRunUpdateQuery<TResult extends JsonValue>(
    id: string,
    input: UpdateActionRunInput<TResult>,
): BuiltActionRunUpdateQuery | null {
    const values: unknown[] = [id];
    const assignments: string[] = [];

    const pushAssignment = (column: string, value: unknown, cast = '') => {
        values.push(value);
        assignments.push(`${column} = $${values.length}${cast}`);
    };

    if (input.status !== undefined) {
        pushAssignment('status', input.status);
    }

    if (input.executedAt !== undefined) {
        pushAssignment('executed_at', input.executedAt);
    }

    if (input.undoStartedAt !== undefined) {
        pushAssignment('undo_started_at', input.undoStartedAt);
    }

    if (input.undoneAt !== undefined) {
        pushAssignment('undone_at', input.undoneAt);
    }

    if (input.undoneBy !== undefined) {
        pushAssignment('undone_by', input.undoneBy, '::jsonb');
    }

    if (input.result !== undefined) {
        pushAssignment('result', input.result, '::jsonb');
    }

    if (input.undoResult !== undefined) {
        pushAssignment('undo_result', input.undoResult, '::jsonb');
    }

    if (input.error !== undefined) {
        pushAssignment('error', input.error, '::jsonb');
    }

    if (input.metadata !== undefined) {
        pushAssignment('metadata', input.metadata, '::jsonb');
    }

    if (assignments.length === 0) {
        return null;
    }

    return {
        text: `
UPDATE rollbackkit_action_runs
SET ${assignments.join(',\n    ')}
WHERE id = $1
RETURNING ${ACTION_RUN_COLUMNS_SQL}
`,
        values,
    };
}

function createActionRunNotFoundError(actionRunId: string): RollbackKitError {
    return new RollbackKitError({
        code: 'ACTION_NOT_FOUND',
        message: `Action run "${actionRunId}" was not found.`,
        details: {
            actionRunId,
        },
    });
}
