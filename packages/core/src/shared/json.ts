export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export interface JsonObject {
    readonly [key: string]: JsonValue;
}

export type JsonArray = readonly JsonValue[];

export function isJsonValue(value: unknown): value is JsonValue {
    if (value === null) {
        return true;
    }

    if (typeof value === 'string' || typeof value === 'boolean') {
        return true;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value);
    }

    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }

    if (typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);

    if (prototype !== Object.prototype && prototype !== null) {
        return false;
    }

    return Object.values(value).every(isJsonValue);
}
