import type { SerializedRollbackKitError } from '../errors/rollbackkit-error';
import type { ActionActor } from '../identity/actor';
import type { ActionTarget } from '../identity/target';
import type { JsonObject, JsonValue } from '../shared/json';
import type { Reversibility } from './reversibility';

export type ActionPhase = 'preview' | 'execute' | 'undo';

export type ActionRunStatus =
    | 'created'
    | 'running'
    | 'completed'
    | 'failed'
    | 'undo_running'
    | 'undone'
    | 'undo_failed'
    | 'expired';

export interface ActionRun<
    TInput extends JsonValue = JsonValue,
    TResult extends JsonValue = JsonValue,
> {
    readonly id: string;
    readonly name: string;
    readonly status: ActionRunStatus;
    readonly actor: ActionActor;
    readonly tenantId?: string;
    readonly target?: ActionTarget;
    readonly input: TInput;
    readonly inputHash?: string;
    readonly idempotencyKey?: string;
    readonly reversibility: Reversibility;
    readonly createdAt: Date;
    readonly executedAt?: Date;
    readonly undoExpiresAt?: Date;
    readonly undoStartedAt?: Date;
    readonly undoneAt?: Date;
    readonly undoneBy?: ActionActor;
    readonly result?: TResult;
    readonly undoResult?: JsonValue;
    readonly error?: SerializedRollbackKitError;
    readonly metadata?: JsonObject;
}

export interface ExecuteResult<TData extends JsonValue = JsonValue> {
    readonly data?: TData;
    readonly metadata?: JsonObject;
}

export interface UndoResult<TData extends JsonValue = JsonValue> {
    readonly data?: TData;
    readonly metadata?: JsonObject;
}
