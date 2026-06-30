import type { ActionDefinition, BaseActionContext } from '../action/definition';
import type { ActionTarget } from '../identity/target';
import type { JsonValue } from '../shared/json';

export async function resolveActionTarget(
    action: ActionDefinition<JsonValue, JsonValue, JsonValue>,
    context: BaseActionContext<JsonValue>,
): Promise<ActionTarget | undefined> {
    if (action.resolveTarget === undefined) {
        return context.target;
    }

    const target = await action.resolveTarget(context);

    return target ?? undefined;
}
