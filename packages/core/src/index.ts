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
    UndoActionContext,
} from './action';
export { defineAction } from './action';

export type { ActionActor, ActorType } from './actor';

export type {
    RollbackKitErrorCode,
    RollbackKitErrorOptions,
    SerializedRollbackKitError,
} from './errors';
export { isRollbackKitError, RollbackKitError } from './errors';

export type { JsonArray, JsonObject, JsonPrimitive, JsonValue } from './json';

export type {
    ActionPhase,
    ActionRun,
    ActionRunStatus,
    ExecuteResult,
    UndoResult,
} from './lifecycle';

export type {
    PreviewImpactItem,
    PreviewResult,
    PreviewSeverity,
    PreviewSideEffect,
} from './preview';

export type { Reversibility, ReversibilityKind } from './reversibility';
export { isUndoable, REVERSIBILITY } from './reversibility';

export type { CreateSnapshotInput, Snapshot, SnapshotReader, SnapshotRecorder } from './snapshot';

export type {
    ActionConflict,
    ActionHistoryQuery,
    ActionSideEffect,
    CreateActionRunInput,
    RecordConflictInput,
    RecordSideEffectInput,
    SideEffectStatus,
    StorageAdapter,
    UpdateActionRunInput,
} from './storage';

export type { ActionTarget, TargetType } from './target';

export type { Clock, DurationMs } from './time';
export { systemClock } from './time';
