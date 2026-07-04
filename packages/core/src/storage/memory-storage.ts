import { AsyncLocalStorage } from 'node:async_hooks';

import type { SerializedRollbackKitError } from '../errors/rollbackkit-error';
import { RollbackKitError } from '../errors/rollbackkit-error';
import type { ActionRun } from '../lifecycle/lifecycle';
import type { Reversibility } from '../lifecycle/reversibility';
import type { JsonObject, JsonValue } from '../shared/json';
import type { Clock } from '../shared/time';
import { systemClock } from '../shared/time';
import type { CreateSnapshotInput, Snapshot } from './snapshot';
import type {
    ActionConflict,
    ActionHistoryQuery,
    ActionSideEffect,
    ClaimActionRunInput,
    ClaimActionRunResult,
    CreateActionRunInput,
    RecordConflictInput,
    RecordSideEffectInput,
    StorageAdapter,
    UpdateActionRunInput,
} from './storage';

export interface MemoryStorageAdapterOptions {
    readonly clock?: Clock;
    readonly idPrefix?: string;
}

export class MemoryStorageAdapter implements StorageAdapter {
    readonly #clock: Clock;
    readonly #idPrefix: string;

    readonly #actionRuns = new Map<string, ActionRun>();
    readonly #snapshotsByActionRunId = new Map<string, Snapshot[]>();
    readonly #sideEffectsByActionRunId = new Map<string, ActionSideEffect[]>();
    readonly #conflictsByActionRunId = new Map<string, ActionConflict[]>();
    readonly #locks = new Map<string, Promise<void>>();
    readonly #transactionContext = new AsyncLocalStorage<symbol>();
    #transactionLock: Promise<void> = Promise.resolve();

    #nextId = 1;

    constructor(options: MemoryStorageAdapterOptions = {}) {
        this.#clock = options.clock ?? systemClock;
        this.#idPrefix = options.idPrefix ?? '';
    }

    async withTransaction<TValue>(handler: () => Promise<TValue>): Promise<TValue> {
        if (this.#transactionContext.getStore() !== undefined) {
            return handler();
        }

        const previous = this.#transactionLock;
        let release = () => {};
        const current = new Promise<void>((resolve) => {
            release = () => resolve();
        });
        const queued = previous.catch(() => undefined).then(() => current);

        this.#transactionLock = queued;

        await previous.catch(() => undefined);

        const token = Symbol('memory-storage-transaction');

        try {
            return await this.#transactionContext.run(token, async () => {
                const state = this.#captureState();

                try {
                    return await handler();
                } catch (error) {
                    this.#restoreState(state);

                    throw error;
                }
            });
        } finally {
            release();

            if (this.#transactionLock === queued) {
                this.#transactionLock = Promise.resolve();
            }
        }
    }

    async createActionRun<TInput extends JsonValue = JsonValue>(
        input: CreateActionRunInput<TInput>,
    ): Promise<ActionRun<TInput>> {
        return this.#withWriteAccess(async () => {
            const run: ActionRun<TInput> = {
                id: this.#createId('run'),
                name: input.name,
                status: 'created',
                actor: cloneActor(input.actor),
                input: cloneJsonValue(input.input),
                reversibility: cloneReversibility(input.reversibility),
                createdAt: this.#clock.now(),
                ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
                ...(input.target === undefined ? {} : { target: cloneTarget(input.target) }),
                ...(input.inputHash === undefined ? {} : { inputHash: input.inputHash }),
                ...(input.idempotencyKey === undefined
                    ? {}
                    : { idempotencyKey: input.idempotencyKey }),
                ...(input.undoExpiresAt === undefined
                    ? {}
                    : { undoExpiresAt: cloneDate(input.undoExpiresAt) }),
                ...(input.metadata === undefined
                    ? {}
                    : { metadata: cloneJsonObject(input.metadata) }),
            };

            this.#actionRuns.set(run.id, run as ActionRun);

            return cloneActionRun(run);
        });
    }

    async claimActionRun<TInput extends JsonValue = JsonValue>(
        input: ClaimActionRunInput<TInput>,
    ): Promise<ClaimActionRunResult<TInput>> {
        return this.#withWriteAccess(async () => {
            const existing = this.#findClaimedActionRun(input);

            if (existing !== null) {
                return {
                    run: cloneActionRun(existing) as ActionRun<TInput>,
                    created: false,
                };
            }

            return {
                run: await this.createActionRun(input),
                created: true,
            };
        });
    }

    async getActionRun(id: string): Promise<ActionRun | null> {
        const run = this.#actionRuns.get(id);

        return run === undefined ? null : cloneActionRun(run);
    }

    async updateActionRun<TResult extends JsonValue = JsonValue>(
        id: string,
        input: UpdateActionRunInput<TResult>,
    ): Promise<ActionRun<JsonValue, TResult>> {
        return this.#withWriteAccess(async () => {
            const existing = this.#requireActionRun(id);

            const updated = {
                ...existing,
                ...(input.status === undefined ? {} : { status: input.status }),
                ...(input.executedAt === undefined
                    ? {}
                    : { executedAt: cloneDate(input.executedAt) }),
                ...(input.undoStartedAt === undefined
                    ? {}
                    : { undoStartedAt: cloneDate(input.undoStartedAt) }),
                ...(input.undoneAt === undefined ? {} : { undoneAt: cloneDate(input.undoneAt) }),
                ...(input.undoneBy === undefined ? {} : { undoneBy: cloneActor(input.undoneBy) }),
                ...(input.result === undefined ? {} : { result: cloneJsonValue(input.result) }),
                ...(input.undoResult === undefined
                    ? {}
                    : { undoResult: cloneJsonValue(input.undoResult) }),
                ...(input.error === undefined ? {} : { error: cloneSerializedError(input.error) }),
                ...(input.metadata === undefined
                    ? {}
                    : { metadata: cloneJsonObject(input.metadata) }),
            } as ActionRun<JsonValue, TResult>;

            this.#actionRuns.set(id, updated as ActionRun);

            return cloneActionRun(updated);
        });
    }

    async saveSnapshot<TValue extends JsonValue = JsonValue>(
        input: CreateSnapshotInput<TValue>,
    ): Promise<Snapshot<TValue>> {
        return this.#withWriteAccess(async () => {
            this.#requireActionRun(input.actionRunId);

            const snapshot: Snapshot<TValue> = {
                id: this.#createId('snapshot'),
                actionRunId: input.actionRunId,
                key: input.key,
                value: cloneJsonValue(input.value),
                createdAt: this.#clock.now(),
                ...(input.metadata === undefined
                    ? {}
                    : { metadata: cloneJsonObject(input.metadata) }),
            };

            const snapshots = this.#snapshotsByActionRunId.get(input.actionRunId) ?? [];
            snapshots.push(snapshot as Snapshot);

            this.#snapshotsByActionRunId.set(input.actionRunId, snapshots);

            return cloneSnapshot(snapshot);
        });
    }

    async getSnapshots(actionRunId: string): Promise<readonly Snapshot[]> {
        return (this.#snapshotsByActionRunId.get(actionRunId) ?? []).map(cloneSnapshot);
    }

    async recordSideEffect<TPayload extends JsonValue = JsonValue>(
        input: RecordSideEffectInput<TPayload>,
    ): Promise<ActionSideEffect<TPayload>> {
        return this.#withWriteAccess(async () => {
            this.#requireActionRun(input.actionRunId);

            const sideEffect: ActionSideEffect<TPayload> = {
                id: this.#createId('effect'),
                actionRunId: input.actionRunId,
                type: input.type,
                status: input.status,
                reversibility: cloneReversibility(input.reversibility),
                createdAt: this.#clock.now(),
                ...(input.payload === undefined ? {} : { payload: cloneJsonValue(input.payload) }),
                ...(input.metadata === undefined
                    ? {}
                    : { metadata: cloneJsonObject(input.metadata) }),
            };

            const sideEffects = this.#sideEffectsByActionRunId.get(input.actionRunId) ?? [];
            sideEffects.push(sideEffect as ActionSideEffect);

            this.#sideEffectsByActionRunId.set(input.actionRunId, sideEffects);

            return cloneSideEffect(sideEffect);
        });
    }

    async getSideEffects(actionRunId: string): Promise<readonly ActionSideEffect[]> {
        return (this.#sideEffectsByActionRunId.get(actionRunId) ?? []).map(cloneSideEffect);
    }

    async recordConflict(input: RecordConflictInput): Promise<ActionConflict> {
        return this.#withWriteAccess(async () => {
            this.#requireActionRun(input.actionRunId);

            const conflict: ActionConflict = {
                id: this.#createId('conflict'),
                actionRunId: input.actionRunId,
                reason: input.reason,
                createdAt: this.#clock.now(),
                ...(input.details === undefined ? {} : { details: cloneJsonObject(input.details) }),
            };

            const conflicts = this.#conflictsByActionRunId.get(input.actionRunId) ?? [];
            conflicts.push(conflict);

            this.#conflictsByActionRunId.set(input.actionRunId, conflicts);

            return cloneConflict(conflict);
        });
    }

    async getConflicts(actionRunId: string): Promise<readonly ActionConflict[]> {
        return (this.#conflictsByActionRunId.get(actionRunId) ?? []).map(cloneConflict);
    }

    async queryActionRuns(query: ActionHistoryQuery): Promise<readonly ActionRun[]> {
        let runs = Array.from(this.#actionRuns.values())
            .filter((run) => {
                if (query.tenantId !== undefined && run.tenantId !== query.tenantId) {
                    return false;
                }

                if (query.actorId !== undefined && run.actor.id !== query.actorId) {
                    return false;
                }

                if (query.actorType !== undefined && run.actor.type !== query.actorType) {
                    return false;
                }

                if (query.targetType !== undefined && run.target?.type !== query.targetType) {
                    return false;
                }

                if (query.targetId !== undefined && run.target?.id !== query.targetId) {
                    return false;
                }

                if (query.name !== undefined && run.name !== query.name) {
                    return false;
                }

                if (query.status !== undefined && run.status !== query.status) {
                    return false;
                }

                return true;
            })
            .sort((first, second) => {
                const byCreatedAt = second.createdAt.getTime() - first.createdAt.getTime();

                if (byCreatedAt !== 0) {
                    return byCreatedAt;
                }

                return second.id.localeCompare(first.id);
            });

        if (query.cursor !== undefined) {
            const cursorIndex = runs.findIndex((run) => run.id === query.cursor);

            if (cursorIndex >= 0) {
                runs = runs.slice(cursorIndex + 1);
            }
        }

        if (query.limit !== undefined) {
            runs = runs.slice(0, Math.max(0, query.limit));
        }

        return runs.map(cloneActionRun);
    }

    async withActionRunLock<TValue>(
        actionRunId: string,
        handler: (run: ActionRun) => Promise<TValue>,
    ): Promise<TValue> {
        return this.#withWriteAccess(async () => {
            const previous = this.#locks.get(actionRunId) ?? Promise.resolve();

            let release = () => {};

            const current = new Promise<void>((resolve) => {
                release = () => resolve();
            });

            const queued = previous.catch(() => undefined).then(() => current);

            this.#locks.set(actionRunId, queued);

            await previous.catch(() => undefined);

            try {
                return await handler(cloneActionRun(this.#requireActionRun(actionRunId)));
            } finally {
                release();

                if (this.#locks.get(actionRunId) === queued) {
                    this.#locks.delete(actionRunId);
                }
            }
        });
    }

    #requireActionRun(id: string): ActionRun {
        const run = this.#actionRuns.get(id);

        if (run === undefined) {
            throw new RollbackKitError({
                code: 'ACTION_NOT_FOUND',
                message: `Action run "${id}" was not found.`,
                details: {
                    actionRunId: id,
                },
            });
        }

        return run;
    }

    #findClaimedActionRun(input: ClaimActionRunInput): ActionRun | null {
        for (const run of this.#actionRuns.values()) {
            if (
                run.name === input.name &&
                run.actor.id === input.actor.id &&
                run.actor.type === input.actor.type &&
                run.tenantId === input.tenantId &&
                run.idempotencyKey === input.idempotencyKey
            ) {
                return run;
            }
        }

        return null;
    }

    #createId(kind: string): string {
        const id = `${this.#idPrefix}${kind}_${this.#nextId}`;
        this.#nextId += 1;

        return id;
    }

    #captureState(): MemoryStorageState {
        return {
            nextId: this.#nextId,
            actionRuns: new Map(
                Array.from(this.#actionRuns, ([id, run]) => [id, cloneActionRun(run)]),
            ),
            snapshotsByActionRunId: new Map(
                Array.from(this.#snapshotsByActionRunId, ([id, snapshots]) => [
                    id,
                    snapshots.map(cloneSnapshot),
                ]),
            ),
            sideEffectsByActionRunId: new Map(
                Array.from(this.#sideEffectsByActionRunId, ([id, sideEffects]) => [
                    id,
                    sideEffects.map(cloneSideEffect),
                ]),
            ),
            conflictsByActionRunId: new Map(
                Array.from(this.#conflictsByActionRunId, ([id, conflicts]) => [
                    id,
                    conflicts.map(cloneConflict),
                ]),
            ),
        };
    }

    #restoreState(state: MemoryStorageState): void {
        this.#nextId = state.nextId;

        replaceMap(this.#actionRuns, state.actionRuns);
        replaceMap(this.#snapshotsByActionRunId, state.snapshotsByActionRunId);
        replaceMap(this.#sideEffectsByActionRunId, state.sideEffectsByActionRunId);
        replaceMap(this.#conflictsByActionRunId, state.conflictsByActionRunId);
    }

    async #withWriteAccess<TValue>(handler: () => Promise<TValue>): Promise<TValue> {
        if (this.#transactionContext.getStore() !== undefined) {
            return handler();
        }

        return this.withTransaction(handler);
    }
}

interface MemoryStorageState {
    readonly nextId: number;
    readonly actionRuns: Map<string, ActionRun>;
    readonly snapshotsByActionRunId: Map<string, Snapshot[]>;
    readonly sideEffectsByActionRunId: Map<string, ActionSideEffect[]>;
    readonly conflictsByActionRunId: Map<string, ActionConflict[]>;
}

export function createMemoryStorageAdapter(
    options?: MemoryStorageAdapterOptions,
): MemoryStorageAdapter {
    return new MemoryStorageAdapter(options);
}

function cloneActionRun<
    TInput extends JsonValue = JsonValue,
    TResult extends JsonValue = JsonValue,
>(run: ActionRun<TInput, TResult>): ActionRun<TInput, TResult> {
    return {
        ...run,
        actor: cloneActor(run.actor),
        input: cloneJsonValue(run.input),
        reversibility: cloneReversibility(run.reversibility),
        createdAt: cloneDate(run.createdAt),
        ...(run.tenantId === undefined ? {} : { tenantId: run.tenantId }),
        ...(run.target === undefined ? {} : { target: cloneTarget(run.target) }),
        ...(run.inputHash === undefined ? {} : { inputHash: run.inputHash }),
        ...(run.idempotencyKey === undefined ? {} : { idempotencyKey: run.idempotencyKey }),
        ...(run.executedAt === undefined ? {} : { executedAt: cloneDate(run.executedAt) }),
        ...(run.undoExpiresAt === undefined ? {} : { undoExpiresAt: cloneDate(run.undoExpiresAt) }),
        ...(run.undoStartedAt === undefined ? {} : { undoStartedAt: cloneDate(run.undoStartedAt) }),
        ...(run.undoneAt === undefined ? {} : { undoneAt: cloneDate(run.undoneAt) }),
        ...(run.undoneBy === undefined ? {} : { undoneBy: cloneActor(run.undoneBy) }),
        ...(run.result === undefined ? {} : { result: cloneJsonValue(run.result) }),
        ...(run.undoResult === undefined ? {} : { undoResult: cloneJsonValue(run.undoResult) }),
        ...(run.error === undefined ? {} : { error: cloneSerializedError(run.error) }),
        ...(run.metadata === undefined ? {} : { metadata: cloneJsonObject(run.metadata) }),
    };
}

function cloneSnapshot<TValue extends JsonValue = JsonValue>(
    snapshot: Snapshot<TValue>,
): Snapshot<TValue> {
    return {
        ...snapshot,
        value: cloneJsonValue(snapshot.value),
        createdAt: cloneDate(snapshot.createdAt),
        ...(snapshot.metadata === undefined
            ? {}
            : { metadata: cloneJsonObject(snapshot.metadata) }),
    };
}

function cloneSideEffect<TPayload extends JsonValue = JsonValue>(
    sideEffect: ActionSideEffect<TPayload>,
): ActionSideEffect<TPayload> {
    return {
        ...sideEffect,
        reversibility: cloneReversibility(sideEffect.reversibility),
        createdAt: cloneDate(sideEffect.createdAt),
        ...(sideEffect.payload === undefined
            ? {}
            : { payload: cloneJsonValue(sideEffect.payload) }),
        ...(sideEffect.metadata === undefined
            ? {}
            : { metadata: cloneJsonObject(sideEffect.metadata) }),
    };
}

function cloneConflict(conflict: ActionConflict): ActionConflict {
    return {
        ...conflict,
        createdAt: cloneDate(conflict.createdAt),
        ...(conflict.details === undefined ? {} : { details: cloneJsonObject(conflict.details) }),
    };
}

function cloneActor<TActor extends { readonly metadata?: JsonObject }>(actor: TActor): TActor {
    return {
        ...actor,
        ...(actor.metadata === undefined ? {} : { metadata: cloneJsonObject(actor.metadata) }),
    };
}

function cloneTarget<TTarget extends { readonly metadata?: JsonObject }>(target: TTarget): TTarget {
    return {
        ...target,
        ...(target.metadata === undefined ? {} : { metadata: cloneJsonObject(target.metadata) }),
    };
}

function cloneReversibility<TValue extends Reversibility>(reversibility: TValue): TValue {
    return {
        ...reversibility,
        ...(reversibility.metadata === undefined
            ? {}
            : { metadata: cloneJsonObject(reversibility.metadata) }),
    };
}

function cloneSerializedError(error: SerializedRollbackKitError): SerializedRollbackKitError {
    return {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: cloneJsonObject(error.details) }),
    };
}

function cloneJsonObject<TValue extends JsonObject>(value: TValue): TValue {
    return cloneJsonValue(value) as TValue;
}

function cloneJsonValue<TValue extends JsonValue>(value: TValue): TValue {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    return JSON.parse(JSON.stringify(value)) as TValue;
}

function cloneDate(value: Date): Date {
    return new Date(value.getTime());
}

function replaceMap<TKey, TValue>(target: Map<TKey, TValue>, source: Map<TKey, TValue>): void {
    target.clear();

    for (const [key, value] of source) {
        target.set(key, value);
    }
}
