import { RollbackKitError } from '../errors/rollbackkit-error';
import { isJsonValue, type JsonObject, type JsonValue } from '../shared/json';

export function assertJsonValueForStorage(
    value: unknown,
    path: string,
): asserts value is JsonValue {
    if (isJsonValue(value)) {
        return;
    }

    throw new RollbackKitError({
        code: 'STORAGE_ERROR',
        message: `RollbackKit can only store JSON-compatible values at "${path}".`,
        details: {
            path,
        },
    });
}

export function assertJsonObjectForStorage(
    value: unknown,
    path: string,
): asserts value is JsonObject {
    if (
        isJsonValue(value) &&
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
    ) {
        return;
    }

    throw new RollbackKitError({
        code: 'STORAGE_ERROR',
        message: `RollbackKit can only store JSON-compatible objects at "${path}".`,
        details: {
            path,
        },
    });
}
