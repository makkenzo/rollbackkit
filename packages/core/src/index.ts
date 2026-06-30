export const rollbackkitVersion = '0.0.0';

export type {
    ActionDefinition,
    AuthorizationContext,
    BaseActionContext,
    ExecuteActionContext,
    InputValidator,
    MaybePromise,
    PermissionDecision,
    PreviewActionContext,
    RegisteredActionDefinition,
    UndoActionContext,
} from './action';
export { ActionRegistry, createActionRegistry, defineAction } from './action';
export type {
    RollbackKitErrorCode,
    RollbackKitErrorOptions,
    SerializedRollbackKitError,
} from './errors';
export { isRollbackKitError, RollbackKitError } from './errors';
export type { ActionActor, ActionTarget, ActorType, TargetType } from './identity';
export type {
    ActionPhase,
    ActionRun,
    ActionRunStatus,
    ExecuteResult,
    PreviewImpactItem,
    PreviewResult,
    PreviewSeverity,
    PreviewSideEffect,
    Reversibility,
    ReversibilityKind,
    UndoResult,
} from './lifecycle';
export { isUndoable, REVERSIBILITY } from './lifecycle';
export type {
    ExecuteActionRequest,
    PreviewActionRequest,
    RollbackKitOptions,
    UndoActionRequest,
} from './runtime';
export { createRollbackKit, RollbackKit } from './runtime';
export type { Clock, DurationMs, JsonArray, JsonObject, JsonPrimitive, JsonValue } from './shared';
export { isJsonValue, systemClock } from './shared';
export type {
    ActionConflict,
    ActionHistoryQuery,
    ActionSideEffect,
    ClaimActionRunInput,
    ClaimActionRunResult,
    CreateActionRunInput,
    CreateSnapshotInput,
    MemoryStorageAdapterOptions,
    RecordConflictInput,
    RecordSideEffectInput,
    SideEffectStatus,
    Snapshot,
    SnapshotReader,
    SnapshotRecorder,
    StorageAdapter,
    UpdateActionRunInput,
} from './storage';
export { createMemoryStorageAdapter, MemoryStorageAdapter } from './storage';
