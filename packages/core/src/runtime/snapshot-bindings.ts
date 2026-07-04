import { RollbackKitError } from '../errors/rollbackkit-error';
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
import { assertJsonObjectForStorage, assertJsonValueForStorage } from './json-assertions';

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
        assertJsonValueForStorage(value, `snapshots.${key}.value`);

        if (metadata !== undefined) {
            assertJsonObjectForStorage(metadata, `snapshots.${key}.metadata`);
        }

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

    async require<TValue extends JsonValue = JsonValue>(key: string): Promise<Snapshot<TValue>> {
        const snapshot = await this.get<TValue>(key);

        if (snapshot !== null) {
            return snapshot;
        }

        throw new RollbackKitError({
            code: 'SNAPSHOT_NOT_FOUND',
            message: `Snapshot "${key}" was not found for action run "${this.#actionRunId}".`,
            details: {
                actionRunId: this.#actionRunId,
                snapshotKey: key,
            },
        });
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
        if (input.payload !== undefined) {
            assertJsonValueForStorage(input.payload, `sideEffects.${input.type}.payload`);
        }

        if (input.metadata !== undefined) {
            assertJsonObjectForStorage(input.metadata, `sideEffects.${input.type}.metadata`);
        }

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
        if (details !== undefined) {
            assertJsonObjectForStorage(details, 'conflicts.details');
        }

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
        if (details !== undefined) {
            assertJsonObjectForStorage(details, 'conflicts.details');
        }

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

    hasRecords(): boolean {
        return this.#records.length > 0;
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
