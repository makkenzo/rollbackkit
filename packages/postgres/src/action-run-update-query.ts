import type { JsonValue, UpdateActionRunInput } from '@rollbackkit/core';
import { encodeJsonb } from './jsonb';
import { ACTION_RUN_COLUMNS_SQL } from './sql-columns';

export interface BuiltActionRunUpdateQuery {
    readonly text: string;
    readonly values: unknown[];
}

export function createActionRunUpdateQuery<TResult extends JsonValue>(
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
        pushAssignment('undone_by', encodeJsonb(input.undoneBy), '::jsonb');
    }

    if (input.result !== undefined) {
        pushAssignment('result', encodeJsonb(input.result), '::jsonb');
    }

    if (input.undoResult !== undefined) {
        pushAssignment('undo_result', encodeJsonb(input.undoResult), '::jsonb');
    }

    if (input.error !== undefined) {
        pushAssignment('error', encodeJsonb(input.error), '::jsonb');
    }

    if (input.metadata !== undefined) {
        pushAssignment('metadata', encodeJsonb(input.metadata), '::jsonb');
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
