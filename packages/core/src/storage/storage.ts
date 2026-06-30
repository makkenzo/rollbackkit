import type { SerializedRollbackKitError } from '../errors/rollbackkit-error';
import type { ActionActor } from '../identity/actor';
import type { ActionTarget } from '../identity/target';
import type { ActionRun, ActionRunStatus } from '../lifecycle/lifecycle';
import type { Reversibility } from '../lifecycle/reversibility';
import type { JsonObject, JsonValue } from '../shared/json';
import type { CreateSnapshotInput, Snapshot } from './snapshot';

export interface CreateActionRunInput<TInput extends JsonValue = JsonValue> {
    readonly name: string;
    readonly actor: ActionActor;
    readonly tenantId?: string;
    readonly target?: ActionTarget;
    readonly input: TInput;
    readonly inputHash?: string;
    readonly reversibility: Reversibility;
    readonly undoExpiresAt?: Date;
    readonly metadata?: JsonObject;
}

export interface UpdateActionRunInput<TResult extends JsonValue = JsonValue> {
    readonly status?: ActionRunStatus;
    readonly executedAt?: Date;
    readonly undoStartedAt?: Date;
    readonly undoneAt?: Date;
    readonly undoneBy?: ActionActor;
    readonly result?: TResult;
    readonly undoResult?: JsonValue;
    readonly error?: SerializedRollbackKitError;
    readonly metadata?: JsonObject;
}

export type SideEffectStatus = 'planned' | 'completed' | 'failed' | 'compensated';

export interface ActionSideEffect<TPayload extends JsonValue = JsonValue> {
    readonly id: string;
    readonly actionRunId: string;
    readonly type: string;
    readonly status: SideEffectStatus;
    readonly reversibility: Reversibility;
    readonly payload?: TPayload;
    readonly createdAt: Date;
    readonly metadata?: JsonObject;
}

export interface RecordSideEffectInput<TPayload extends JsonValue = JsonValue> {
    readonly actionRunId: string;
    readonly type: string;
    readonly status: SideEffectStatus;
    readonly reversibility: Reversibility;
    readonly payload?: TPayload;
    readonly metadata?: JsonObject;
}

export interface ActionConflict {
    readonly id: string;
    readonly actionRunId: string;
    readonly reason: string;
    readonly details?: JsonObject;
    readonly createdAt: Date;
}

export interface RecordConflictInput {
    readonly actionRunId: string;
    readonly reason: string;
    readonly details?: JsonObject;
}

export interface ActionHistoryQuery {
    readonly tenantId?: string;
    readonly actorId?: string;
    readonly targetType?: string;
    readonly targetId?: string;
    readonly name?: string;
    readonly status?: ActionRunStatus;
    readonly limit?: number;
    readonly cursor?: string;
}

export interface StorageAdapter {
    createActionRun<TInput extends JsonValue = JsonValue>(
        input: CreateActionRunInput<TInput>,
    ): Promise<ActionRun<TInput>>;

    getActionRun(id: string): Promise<ActionRun | null>;

    updateActionRun<TResult extends JsonValue = JsonValue>(
        id: string,
        input: UpdateActionRunInput<TResult>,
    ): Promise<ActionRun<JsonValue, TResult>>;

    saveSnapshot<TValue extends JsonValue = JsonValue>(
        input: CreateSnapshotInput<TValue>,
    ): Promise<Snapshot<TValue>>;

    getSnapshots(actionRunId: string): Promise<readonly Snapshot[]>;

    recordSideEffect<TPayload extends JsonValue = JsonValue>(
        input: RecordSideEffectInput<TPayload>,
    ): Promise<ActionSideEffect<TPayload>>;

    recordConflict(input: RecordConflictInput): Promise<ActionConflict>;

    queryActionRuns(query: ActionHistoryQuery): Promise<readonly ActionRun[]>;

    withActionRunLock<TValue>(
        actionRunId: string,
        handler: (run: ActionRun) => Promise<TValue>,
    ): Promise<TValue>;
}
