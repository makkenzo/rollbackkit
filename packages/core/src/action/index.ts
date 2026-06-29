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
} from './definition';
export { defineAction } from './definition';

export type { RegisteredActionDefinition } from './registry';
export { ActionRegistry, createActionRegistry } from './registry';
