import type {
    ActionDefinition,
    AuthorizationContext,
    PermissionDecision,
} from '../action/definition';
import { RollbackKitError } from '../errors/rollbackkit-error';
import type { ActionPhase } from '../lifecycle/lifecycle';
import type { JsonObject, JsonValue } from '../shared/json';

export async function authorizeAction(
    action: ActionDefinition<JsonValue, JsonValue, JsonValue>,
    context: AuthorizationContext<JsonValue>,
): Promise<void> {
    if (action.authorize === undefined) {
        return;
    }

    const decision = await action.authorize(context);

    if (isPermissionAllowed(decision)) {
        return;
    }

    throw new RollbackKitError({
        code: 'ACTION_PERMISSION_DENIED',
        message: createPermissionDeniedMessage(action.name, context.phase, decision),
        details: createPermissionDeniedDetails(action.name, context.phase, decision),
    });
}

function isPermissionAllowed(decision: PermissionDecision): boolean {
    return typeof decision === 'boolean' ? decision : decision.allowed;
}

function createPermissionDeniedMessage(
    actionName: string,
    phase: ActionPhase,
    decision: PermissionDecision,
): string {
    const reason = typeof decision === 'boolean' ? undefined : decision.reason;

    if (reason === undefined) {
        return `Action "${actionName}" permission denied during ${phase}.`;
    }

    return `Action "${actionName}" permission denied during ${phase}: ${reason}`;
}

function createPermissionDeniedDetails(
    actionName: string,
    phase: ActionPhase,
    decision: PermissionDecision,
): JsonObject {
    if (typeof decision === 'boolean') {
        return {
            actionName,
            phase,
        };
    }

    return {
        actionName,
        phase,
        ...(decision.reason === undefined ? {} : { reason: decision.reason }),
        ...(decision.metadata === undefined ? {} : { metadata: decision.metadata }),
    };
}
