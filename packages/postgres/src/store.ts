import {
    type ActionRun,
    type Clock,
    type CreateActionRunInput,
    type JsonValue,
    RollbackKitError,
    systemClock,
} from '@rollbackkit/core';

import { createRollbackKitPostgresId } from './id';
import { type ActionRunRow, mapActionRunRow } from './mappers';
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
}

export function createPostgresStore(options: PostgresStoreOptions): PostgresStore {
    return new PostgresStore(options);
}
