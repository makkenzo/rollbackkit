import type { ActionActor } from './actor';
import type { JsonObject, JsonValue } from './json';
import type { ActionPhase, ActionRun, ExecuteResult, UndoResult } from './lifecycle';
import type { PreviewResult } from './preview';
import type { Reversibility } from './reversibility';
import type { SnapshotReader, SnapshotRecorder } from './snapshot';
import type { ActionTarget } from './target';
import type { Clock, DurationMs } from './time';

export type MaybePromise<TValue> = TValue | Promise<TValue>;

export interface InputValidator<TInput extends JsonValue> {
    parse(input: unknown): MaybePromise<TInput>;
}

export type PermissionDecision =
    | boolean
    | {
          readonly allowed: boolean;
          readonly reason?: string;
          readonly metadata?: JsonObject;
      };

export interface BaseActionContext<TInput extends JsonValue = JsonValue> {
    readonly actionName: string;
    readonly input: TInput;
    readonly actor: ActionActor;
    readonly tenantId?: string;
    readonly target?: ActionTarget;
    readonly metadata?: JsonObject;
    readonly clock: Clock;
}

export interface AuthorizationContext<TInput extends JsonValue = JsonValue>
    extends BaseActionContext<TInput> {
    readonly phase: ActionPhase;
}

export interface PreviewActionContext<TInput extends JsonValue = JsonValue>
    extends BaseActionContext<TInput> {
    readonly phase: 'preview';
}

export interface ExecuteActionContext<TInput extends JsonValue = JsonValue>
    extends BaseActionContext<TInput> {
    readonly phase: 'execute';
    readonly run: ActionRun<TInput>;
    readonly snapshots: SnapshotRecorder;
}

export interface UndoActionContext<TInput extends JsonValue = JsonValue>
    extends BaseActionContext<TInput> {
    readonly phase: 'undo';
    readonly run: ActionRun<TInput>;
    readonly snapshots: SnapshotReader;
}

export interface ActionDefinition<
    TInput extends JsonValue = JsonObject,
    TExecuteData extends JsonValue = JsonValue,
    TUndoData extends JsonValue = JsonValue,
> {
    readonly name: string;
    readonly input?: InputValidator<TInput>;
    readonly reversibility: Reversibility;
    readonly undoWindowMs?: DurationMs;
    readonly metadata?: JsonObject;

    resolveTarget?: (context: BaseActionContext<TInput>) => MaybePromise<ActionTarget | null>;

    authorize?: (context: AuthorizationContext<TInput>) => MaybePromise<PermissionDecision>;

    preview: (context: PreviewActionContext<TInput>) => MaybePromise<PreviewResult>;

    execute: (context: ExecuteActionContext<TInput>) => MaybePromise<ExecuteResult<TExecuteData>>;

    undo?: (context: UndoActionContext<TInput>) => MaybePromise<UndoResult<TUndoData>>;
}

export function defineAction<
    TInput extends JsonValue = JsonObject,
    TExecuteData extends JsonValue = JsonValue,
    TUndoData extends JsonValue = JsonValue,
>(
    definition: ActionDefinition<TInput, TExecuteData, TUndoData>,
): ActionDefinition<TInput, TExecuteData, TUndoData> {
    return definition;
}
