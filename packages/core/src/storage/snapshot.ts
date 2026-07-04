import type { JsonObject, JsonValue } from '../shared/json';

export interface Snapshot<TValue extends JsonValue = JsonValue> {
    readonly id: string;
    readonly actionRunId: string;
    readonly key: string;
    readonly value: TValue;
    readonly createdAt: Date;
    readonly metadata?: JsonObject;
}

export interface CreateSnapshotInput<TValue extends JsonValue = JsonValue> {
    readonly actionRunId: string;
    readonly key: string;
    readonly value: TValue;
    readonly metadata?: JsonObject;
}

export interface SnapshotRecorder {
    save<TValue extends JsonValue>(
        key: string,
        value: TValue,
        metadata?: JsonObject,
    ): Promise<Snapshot<TValue>>;
}

export interface SnapshotReader {
    get<TValue extends JsonValue = JsonValue>(key: string): Promise<Snapshot<TValue> | null>;
    require<TValue extends JsonValue = JsonValue>(key: string): Promise<Snapshot<TValue>>;
    list(): Promise<readonly Snapshot[]>;
}
