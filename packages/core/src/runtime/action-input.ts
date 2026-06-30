import type { ActionDefinition } from '../action/definition';
import { isRollbackKitError, RollbackKitError } from '../errors/rollbackkit-error';
import { isJsonValue, type JsonValue } from '../shared/json';

export async function parseActionInput(
    action: ActionDefinition<JsonValue, JsonValue, JsonValue>,
    rawInput: unknown,
): Promise<JsonValue> {
    const candidateInput = action.input === undefined && rawInput === undefined ? {} : rawInput;

    try {
        const parsed =
            action.input === undefined ? candidateInput : await action.input.parse(candidateInput);

        if (!isJsonValue(parsed)) {
            throw new RollbackKitError({
                code: 'ACTION_INPUT_INVALID',
                message: `Action "${action.name}" input must be JSON-serializable.`,
                details: {
                    actionName: action.name,
                },
            });
        }

        return parsed;
    } catch (error) {
        if (isRollbackKitError(error)) {
            throw error;
        }

        throw new RollbackKitError({
            code: 'ACTION_INPUT_INVALID',
            message: `Action "${action.name}" input is invalid.`,
            details: {
                actionName: action.name,
            },
            cause: error,
        });
    }
}
