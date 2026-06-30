import type { JsonObject, JsonValue } from '../shared/json';
import type { Snapshot, SnapshotReader, SnapshotRecorder } from '../storage/snapshot';
import type { StorageAdapter } from '../storage/storage';

export class BoundSnapshotRecorder implements SnapshotRecorder {
    readonly #storage: StorageAdapter;
    readonly #actionRunId: string;

    constructor(storage: StorageAdapter, actionRunId: string) {
        this.#storage = storage;
        this.#actionRunId = actionRunId;
    }

    async save<TValue extends JsonValue>(
        key: string,
        value: TValue,
        metadata?: JsonObject,
    ): Promise<Snapshot<TValue>> {
        return this.#storage.saveSnapshot({
            actionRunId: this.#actionRunId,
            key,
            value,
            ...(metadata === undefined ? {} : { metadata }),
        });
    }
}

export class BoundSnapshotReader implements SnapshotReader {
    readonly #storage: StorageAdapter;
    readonly #actionRunId: string;

    constructor(storage: StorageAdapter, actionRunId: string) {
        this.#storage = storage;
        this.#actionRunId = actionRunId;
    }

    async get<TValue extends JsonValue = JsonValue>(key: string): Promise<Snapshot<TValue> | null> {
        const snapshots = await this.#storage.getSnapshots(this.#actionRunId);
        const snapshot = [...snapshots].reverse().find((item) => item.key === key);

        return snapshot === undefined ? null : (snapshot as Snapshot<TValue>);
    }

    async list(): Promise<readonly Snapshot[]> {
        return this.#storage.getSnapshots(this.#actionRunId);
    }
}
