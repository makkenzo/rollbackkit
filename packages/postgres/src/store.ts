import {
    type ActionConflict,
    type ActionHistoryQuery,
    type ActionRun,
    type ActionSideEffect,
    type ClaimActionRunInput,
    type ClaimActionRunResult,
    type Clock,
    type CreateActionRunInput,
    type CreateSnapshotInput,
    type JsonValue,
    type RecordConflictInput,
    type RecordSideEffectInput,
    RollbackKitError,
    type Snapshot,
    type StorageAdapter,
    systemClock,
    type UpdateActionRunInput,
} from '@rollbackkit/core';

import { createActionRunUpdateQuery } from './action-run-update-query';
import { createRollbackKitPostgresId } from './id';
import { encodeJsonb, encodeOptionalJsonb } from './jsonb';
import {
    type ActionConflictRow,
    type ActionRunRow,
    type ActionSideEffectRow,
    mapActionConflictRow,
    mapActionRunRow,
    mapActionSideEffectRow,
    mapSnapshotRow,
    type SnapshotRow,
} from './mappers';
import { assertSingleConnectionExecutor, type PostgresQueryExecutor } from './migration-runner';
import {
    ACTION_RUN_COLUMNS_SQL,
    CONFLICT_COLUMNS_SQL,
    SIDE_EFFECT_COLUMNS_SQL,
    SNAPSHOT_COLUMNS_SQL,
} from './sql-columns';

export interface PostgresStoreOptions {
    /**
     * Query executor used by the store.
     *
     * For lock-safe undo, pass a transaction-capable single-connection executor,
     * such as `pg.Client` or `pg.PoolClient`.
     *
     * Do not pass a bare `pg.Pool` when using `withActionRunLock`, because
     * `pool.query("BEGIN")` and later queries are not guaranteed to use the same connection.
     */
    readonly executor: PostgresQueryExecutor;
    readonly clock?: Clock;
}

export class PostgresStore implements StorageAdapter {
    readonly #executor: PostgresQueryExecutor;
    readonly #clock: Clock;

    constructor(options: PostgresStoreOptions) {
        assertSingleConnectionExecutor(
            options.executor,
            'PostgresStore requires a single PostgreSQL connection executor for transaction-safe storage. Do not pass pg.Pool directly.',
        );

        this.#executor = options.executor;
        this.#clock = options.clock ?? systemClock;
    }

    async withTransaction<TValue>(handler: () => Promise<TValue>): Promise<TValue> {
        await this.#executor.query('BEGIN');

        try {
            const value = await handler();

            await this.#executor.query('COMMIT');

            return value;
        } catch (error) {
            await this.#executor.query('ROLLBACK').catch(() => undefined);

            throw error;
        }
    }

    async createActionRun<TInput extends JsonValue = JsonValue>(
        input: CreateActionRunInput<TInput>,
    ): Promise<ActionRun<TInput>> {
        const row = await this.#insertActionRun(input);

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

    async claimActionRun<TInput extends JsonValue = JsonValue>(
        input: ClaimActionRunInput<TInput>,
    ): Promise<ClaimActionRunResult<TInput>> {
        const row = await this.#insertActionRun(input, createIdempotencyConflictSql(input));

        if (row !== undefined) {
            return {
                run: mapActionRunRow(row) as ActionRun<TInput>,
                created: true,
            };
        }

        const existingRun = await this.#getActionRunByIdempotencyKey(input);

        if (existingRun === null) {
            throw new RollbackKitError({
                code: 'STORAGE_ERROR',
                message: 'PostgreSQL did not return an idempotent action run after conflict.',
                details: {
                    operation: 'claimActionRun',
                    actionName: input.name,
                    actorId: input.actor.id,
                    actorType: input.actor.type,
                    idempotencyKey: input.idempotencyKey,
                    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
                },
            });
        }

        return {
            run: existingRun as ActionRun<TInput>,
            created: false,
        };
    }

    async #insertActionRun<TInput extends JsonValue = JsonValue>(
        input: CreateActionRunInput<TInput>,
        conflictSql = '',
    ): Promise<ActionRunRow | undefined> {
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
    idempotency_key,
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
    $13,
    $14::jsonb,
    $15,
    $16,
    $17::jsonb
)
${conflictSql}
RETURNING ${ACTION_RUN_COLUMNS_SQL}
`,
            [
                id,
                input.name,
                'created',
                input.actor.id,
                input.actor.type,
                encodeJsonb(input.actor),
                input.tenantId === undefined ? null : input.tenantId,
                input.target === undefined ? null : input.target.type,
                input.target === undefined ? null : input.target.id,
                encodeOptionalJsonb(input.target),
                encodeJsonb(input.input),
                input.inputHash === undefined ? null : input.inputHash,
                input.idempotencyKey === undefined ? null : input.idempotencyKey,
                encodeJsonb(input.reversibility),
                createdAt,
                input.undoExpiresAt === undefined ? null : input.undoExpiresAt,
                encodeOptionalJsonb(input.metadata),
            ],
        );

        return result.rows[0];
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

    async #getActionRunByIdempotencyKey(input: ClaimActionRunInput): Promise<ActionRun | null> {
        const values: unknown[] = [
            input.name,
            input.actor.type,
            input.actor.id,
            input.idempotencyKey,
        ];

        let tenantSql = 'tenant_id IS NULL';

        if (input.tenantId !== undefined) {
            values.push(input.tenantId);
            tenantSql = `tenant_id = $${values.length}`;
        }

        const result = await this.#executor.query<ActionRunRow>(
            `
SELECT ${ACTION_RUN_COLUMNS_SQL}
FROM rollbackkit_action_runs
WHERE name = $1
    AND actor_type = $2
    AND actor_id = $3
    AND idempotency_key = $4
    AND ${tenantSql}
`,
            values,
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
                encodeJsonb(input.value),
                createdAt,
                encodeOptionalJsonb(input.metadata),
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

    async recordSideEffect<TPayload extends JsonValue = JsonValue>(
        input: RecordSideEffectInput<TPayload>,
    ): Promise<ActionSideEffect<TPayload>> {
        const id = createRollbackKitPostgresId('effect');
        const createdAt = this.#clock.now();

        const result = await this.#executor.query<ActionSideEffectRow>(
            `
INSERT INTO rollbackkit_side_effects (
    id,
    action_run_id,
    type,
    status,
    reversibility,
    payload,
    created_at,
    metadata
)
VALUES (
    $1,
    $2,
    $3,
    $4,
    $5::jsonb,
    $6::jsonb,
    $7,
    $8::jsonb
)
RETURNING ${SIDE_EFFECT_COLUMNS_SQL}
`,
            [
                id,
                input.actionRunId,
                input.type,
                input.status,
                encodeJsonb(input.reversibility),
                encodeOptionalJsonb(input.payload),
                createdAt,
                encodeOptionalJsonb(input.metadata),
            ],
        );

        const row = result.rows[0];

        if (row === undefined) {
            throw new RollbackKitError({
                code: 'STORAGE_ERROR',
                message: 'PostgreSQL did not return a side effect after insert.',
                details: {
                    operation: 'recordSideEffect',
                    actionRunId: input.actionRunId,
                    type: input.type,
                },
            });
        }

        return mapActionSideEffectRow(row) as ActionSideEffect<TPayload>;
    }

    async getSideEffects(actionRunId: string): Promise<readonly ActionSideEffect[]> {
        const result = await this.#executor.query<ActionSideEffectRow>(
            `
SELECT ${SIDE_EFFECT_COLUMNS_SQL}
FROM rollbackkit_side_effects
WHERE action_run_id = $1
ORDER BY created_at ASC, id ASC
`,
            [actionRunId],
        );

        return result.rows.map(mapActionSideEffectRow);
    }

    async recordConflict(input: RecordConflictInput): Promise<ActionConflict> {
        const id = createRollbackKitPostgresId('conflict');
        const createdAt = this.#clock.now();

        const result = await this.#executor.query<ActionConflictRow>(
            `
INSERT INTO rollbackkit_conflicts (
    id,
    action_run_id,
    reason,
    details,
    created_at
)
VALUES (
    $1,
    $2,
    $3,
    $4::jsonb,
    $5
)
RETURNING ${CONFLICT_COLUMNS_SQL}
`,
            [id, input.actionRunId, input.reason, encodeOptionalJsonb(input.details), createdAt],
        );

        const row = result.rows[0];

        if (row === undefined) {
            throw new RollbackKitError({
                code: 'STORAGE_ERROR',
                message: 'PostgreSQL did not return a conflict after insert.',
                details: {
                    operation: 'recordConflict',
                    actionRunId: input.actionRunId,
                    reason: input.reason,
                },
            });
        }

        return mapActionConflictRow(row);
    }

    async getConflicts(actionRunId: string): Promise<readonly ActionConflict[]> {
        const result = await this.#executor.query<ActionConflictRow>(
            `
SELECT ${CONFLICT_COLUMNS_SQL}
FROM rollbackkit_conflicts
WHERE action_run_id = $1
ORDER BY created_at ASC, id ASC
`,
            [actionRunId],
        );

        return result.rows.map(mapActionConflictRow);
    }

    async queryActionRuns(query: ActionHistoryQuery): Promise<readonly ActionRun[]> {
        if (query.limit !== undefined && query.limit <= 0) {
            return [];
        }

        const conditions: string[] = [];
        const values: unknown[] = [];

        const addCondition = (condition: string, value: unknown) => {
            values.push(value);
            conditions.push(`${condition} $${values.length}`);
        };

        if (query.tenantId !== undefined) {
            addCondition('tenant_id =', query.tenantId);
        }

        if (query.actorId !== undefined) {
            addCondition('actor_id =', query.actorId);
        }

        if (query.targetType !== undefined) {
            addCondition('target_type =', query.targetType);
        }

        if (query.targetId !== undefined) {
            addCondition('target_id =', query.targetId);
        }

        if (query.name !== undefined) {
            addCondition('name =', query.name);
        }

        if (query.status !== undefined) {
            addCondition('status =', query.status);
        }

        if (query.cursor !== undefined) {
            const cursorRun = await this.getActionRun(query.cursor);

            if (cursorRun !== null && actionRunMatchesHistoryQuery(cursorRun, query)) {
                values.push(cursorRun.createdAt);
                const cursorCreatedAtParameter = values.length;

                values.push(cursorRun.id);
                const cursorIdParameter = values.length;

                conditions.push(
                    `(created_at < $${cursorCreatedAtParameter} OR (created_at = $${cursorCreatedAtParameter} AND id < $${cursorIdParameter}))`,
                );
            }
        }

        const whereSql = conditions.length === 0 ? '' : `WHERE ${conditions.join('\n    AND ')}`;

        let limitSql = '';

        if (query.limit !== undefined) {
            values.push(query.limit);
            limitSql = `LIMIT $${values.length}`;
        }

        const result = await this.#executor.query<ActionRunRow>(
            `
SELECT ${ACTION_RUN_COLUMNS_SQL}
FROM rollbackkit_action_runs
${whereSql}
ORDER BY created_at DESC, id DESC
${limitSql}
`,
            values,
        );

        return result.rows.map(mapActionRunRow);
    }

    async withActionRunLock<TValue>(
        actionRunId: string,
        handler: (run: ActionRun) => Promise<TValue>,
    ): Promise<TValue> {
        await this.#executor.query('BEGIN');

        try {
            const result = await this.#executor.query<ActionRunRow>(
                `
SELECT ${ACTION_RUN_COLUMNS_SQL}
FROM rollbackkit_action_runs
WHERE id = $1
FOR UPDATE
`,
                [actionRunId],
            );

            const row = result.rows[0];

            if (row === undefined) {
                throw createActionRunNotFoundError(actionRunId);
            }

            const value = await handler(mapActionRunRow(row));

            await this.#executor.query('COMMIT');

            return value;
        } catch (error) {
            await this.#executor.query('ROLLBACK').catch(() => undefined);

            throw error;
        }
    }
}

export function createPostgresStore(options: PostgresStoreOptions): PostgresStore {
    return new PostgresStore(options);
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

function createIdempotencyConflictSql(input: ClaimActionRunInput): string {
    if (input.tenantId === undefined) {
        return `
ON CONFLICT (name, actor_type, actor_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND tenant_id IS NULL
DO NOTHING
`;
    }

    return `
ON CONFLICT (tenant_id, name, actor_type, actor_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND tenant_id IS NOT NULL
DO NOTHING
`;
}

function actionRunMatchesHistoryQuery(run: ActionRun, query: ActionHistoryQuery): boolean {
    if (query.tenantId !== undefined && run.tenantId !== query.tenantId) {
        return false;
    }

    if (query.actorId !== undefined && run.actor.id !== query.actorId) {
        return false;
    }

    if (query.targetType !== undefined && run.target?.type !== query.targetType) {
        return false;
    }

    if (query.targetId !== undefined && run.target?.id !== query.targetId) {
        return false;
    }

    if (query.name !== undefined && run.name !== query.name) {
        return false;
    }

    if (query.status !== undefined && run.status !== query.status) {
        return false;
    }

    return true;
}
