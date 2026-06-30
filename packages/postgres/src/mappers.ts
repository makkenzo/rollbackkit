import type {
    ActionActor,
    ActionConflict,
    ActionRun,
    ActionRunStatus,
    ActionSideEffect,
    ActionTarget,
    JsonObject,
    JsonValue,
    Reversibility,
    SerializedRollbackKitError,
    SideEffectStatus,
    Snapshot,
} from '@rollbackkit/core';
import type { QueryResultRow } from 'pg';

export interface ActionRunRow extends QueryResultRow {
    readonly id: string;
    readonly name: string;
    readonly status: ActionRunStatus;

    readonly actor_id: string;
    readonly actor_type: string;
    readonly actor: ActionActor;

    readonly tenant_id: string | null;

    readonly target_type: string | null;
    readonly target_id: string | null;
    readonly target: ActionTarget | null;

    readonly input: JsonValue;
    readonly input_hash: string | null;
    readonly reversibility: Reversibility;

    readonly created_at: Date | string;
    readonly executed_at: Date | string | null;
    readonly undo_expires_at: Date | string | null;
    readonly undo_started_at: Date | string | null;
    readonly undone_at: Date | string | null;
    readonly undone_by: ActionActor | null;

    readonly result: JsonValue | null;
    readonly undo_result: JsonValue | null;
    readonly error: SerializedRollbackKitError | null;
    readonly metadata: JsonObject | null;
}

export interface SnapshotRow extends QueryResultRow {
    readonly id: string;
    readonly action_run_id: string;
    readonly key: string;
    readonly value: JsonValue;
    readonly created_at: Date | string;
    readonly metadata: JsonObject | null;
}

export interface ActionSideEffectRow extends QueryResultRow {
    readonly id: string;
    readonly action_run_id: string;
    readonly type: string;
    readonly status: SideEffectStatus;
    readonly reversibility: Reversibility;
    readonly payload: JsonValue | null;
    readonly created_at: Date | string;
    readonly metadata: JsonObject | null;
}

export interface ActionConflictRow extends QueryResultRow {
    readonly id: string;
    readonly action_run_id: string;
    readonly reason: string;
    readonly details: JsonObject | null;
    readonly created_at: Date | string;
}

export function mapActionRunRow(row: ActionRunRow): ActionRun {
    const executedAt = mapNullableDate(row.executed_at, 'executed_at');
    const undoExpiresAt = mapNullableDate(row.undo_expires_at, 'undo_expires_at');
    const undoStartedAt = mapNullableDate(row.undo_started_at, 'undo_started_at');
    const undoneAt = mapNullableDate(row.undone_at, 'undone_at');

    return {
        id: row.id,
        name: row.name,
        status: row.status,
        actor: row.actor,
        input: row.input,
        reversibility: row.reversibility,
        createdAt: mapDate(row.created_at, 'created_at'),
        ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
        ...(row.target === null ? {} : { target: row.target }),
        ...(row.input_hash === null ? {} : { inputHash: row.input_hash }),
        ...(executedAt === undefined ? {} : { executedAt }),
        ...(undoExpiresAt === undefined ? {} : { undoExpiresAt }),
        ...(undoStartedAt === undefined ? {} : { undoStartedAt }),
        ...(undoneAt === undefined ? {} : { undoneAt }),
        ...(row.undone_by === null ? {} : { undoneBy: row.undone_by }),
        ...(row.result === null ? {} : { result: row.result }),
        ...(row.undo_result === null ? {} : { undoResult: row.undo_result }),
        ...(row.error === null ? {} : { error: row.error }),
        ...(row.metadata === null ? {} : { metadata: row.metadata }),
    };
}

export function mapSnapshotRow(row: SnapshotRow): Snapshot {
    return {
        id: row.id,
        actionRunId: row.action_run_id,
        key: row.key,
        value: row.value,
        createdAt: mapDate(row.created_at, 'created_at'),
        ...(row.metadata === null ? {} : { metadata: row.metadata }),
    };
}

export function mapActionSideEffectRow(row: ActionSideEffectRow): ActionSideEffect {
    return {
        id: row.id,
        actionRunId: row.action_run_id,
        type: row.type,
        status: row.status,
        reversibility: row.reversibility,
        createdAt: mapDate(row.created_at, 'created_at'),
        ...(row.payload === null ? {} : { payload: row.payload }),
        ...(row.metadata === null ? {} : { metadata: row.metadata }),
    };
}

export function mapActionConflictRow(row: ActionConflictRow): ActionConflict {
    return {
        id: row.id,
        actionRunId: row.action_run_id,
        reason: row.reason,
        createdAt: mapDate(row.created_at, 'created_at'),
        ...(row.details === null ? {} : { details: row.details }),
    };
}

function mapNullableDate(value: Date | string | null, fieldName: string): Date | undefined {
    if (value === null) {
        return undefined;
    }

    return mapDate(value, fieldName);
}

function mapDate(value: Date | string, fieldName: string): Date {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new TypeError(`Invalid PostgreSQL timestamp value for "${fieldName}".`);
    }

    return date;
}
