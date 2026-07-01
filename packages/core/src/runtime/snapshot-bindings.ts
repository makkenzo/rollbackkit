import type { JsonObject, JsonValue } from '../shared/json';
import type { Clock } from '../shared/time';
import type { Snapshot, SnapshotReader, SnapshotRecorder } from '../storage/snapshot';
import type {
    ActionConflict,
    ActionSideEffect,
    ConflictRecorder,
    RecordBoundSideEffectInput,
    SideEffectRecorder,
    StorageAdapter,
} from '../storage/storage';

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

export class BoundSideEffectRecorder implements SideEffectRecorder {
    readonly #storage: StorageAdapter;
    readonly #actionRunId: string;

    constructor(storage: StorageAdapter, actionRunId: string) {
        this.#storage = storage;
        this.#actionRunId = actionRunId;
    }

    async record<TPayload extends JsonValue = JsonValue>(
        input: RecordBoundSideEffectInput<TPayload>,
    ): Promise<ActionSideEffect<TPayload>> {
        return this.#storage.recordSideEffect({
            actionRunId: this.#actionRunId,
            ...input,
        });
    }
}

export class BoundConflictRecorder implements ConflictRecorder {
    readonly #storage: StorageAdapter;
    readonly #actionRunId: string;

    constructor(storage: StorageAdapter, actionRunId: string) {
        this.#storage = storage;
        this.#actionRunId = actionRunId;
    }

    async record(reason: string, details?: JsonObject): Promise<ActionConflict> {
        return this.#storage.recordConflict({
            actionRunId: this.#actionRunId,
            reason,
            ...(details === undefined ? {} : { details }),
        });
    }
}

export class DeferredConflictRecorder implements ConflictRecorder {
    readonly #actionRunId: string;
    readonly #clock: Clock;
    readonly #records: ActionConflict[] = [];

    constructor(actionRunId: string, clock: Clock) {
        this.#actionRunId = actionRunId;
        this.#clock = clock;
    }

    async record(reason: string, details?: JsonObject): Promise<ActionConflict> {
        const conflict: ActionConflict = {
            id: `pending_conflict_${this.#records.length + 1}`,
            actionRunId: this.#actionRunId,
            reason,
            createdAt: this.#clock.now(),
            ...(details === undefined ? {} : { details }),
        };

        this.#records.push(conflict);

        return conflict;
    }

    async flush(storage: StorageAdapter): Promise<void> {
        const records = this.#records.splice(0);

        for (const record of records) {
            await storage.recordConflict({
                actionRunId: record.actionRunId,
                reason: record.reason,
                ...(record.details === undefined ? {} : { details: record.details }),
            });
        }
    }
}
