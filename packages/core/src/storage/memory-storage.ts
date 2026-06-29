import { RollbackKitError } from '../errors/rollbackkit-error';
import type { ActionRun } from '../lifecycle/lifecycle';
import type { JsonValue } from '../shared/json';
import type { Clock } from '../shared/time';
import { systemClock } from '../shared/time';
import type { CreateSnapshotInput, Snapshot } from './snapshot';
import type {
    ActionConflict,
    ActionHistoryQuery,
    ActionSideEffect,
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

    #nextId = 1;

    constructor(options: MemoryStorageAdapterOptions = {}) {
        this.#clock = options.clock ?? systemClock;
        this.#idPrefix = options.idPrefix ?? '';
    }

    async createActionRun<TInput extends JsonValue = JsonValue>(
        input: CreateActionRunInput<TInput>,
    ): Promise<ActionRun<TInput>> {
        const run: ActionRun<TInput> = {
            id: this.#createId('run'),
            name: input.name,
            status: 'created',
            actor: input.actor,
            input: input.input,
            reversibility: input.reversibility,
            createdAt: this.#clock.now(),
            ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
            ...(input.target === undefined ? {} : { target: input.target }),
            ...(input.inputHash === undefined ? {} : { inputHash: input.inputHash }),
            ...(input.undoExpiresAt === undefined ? {} : { undoExpiresAt: input.undoExpiresAt }),
            ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        };

        this.#actionRuns.set(run.id, run as ActionRun);

        return run;
    }

    async getActionRun(id: string): Promise<ActionRun | null> {
        return this.#actionRuns.get(id) ?? null;
    }

    async updateActionRun<TResult extends JsonValue = JsonValue>(
        id: string,
        input: UpdateActionRunInput<TResult>,
    ): Promise<ActionRun<JsonValue, TResult>> {
        const existing = this.#requireActionRun(id);

        const updated = {
            ...existing,
            ...(input.status === undefined ? {} : { status: input.status }),
            ...(input.executedAt === undefined ? {} : { executedAt: input.executedAt }),
            ...(input.undoStartedAt === undefined ? {} : { undoStartedAt: input.undoStartedAt }),
            ...(input.undoneAt === undefined ? {} : { undoneAt: input.undoneAt }),
            ...(input.undoneBy === undefined ? {} : { undoneBy: input.undoneBy }),
            ...(input.result === undefined ? {} : { result: input.result }),
            ...(input.error === undefined ? {} : { error: input.error }),
            ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        } as ActionRun<JsonValue, TResult>;

        this.#actionRuns.set(id, updated as ActionRun);

        return updated;
    }

    async saveSnapshot<TValue extends JsonValue = JsonValue>(
        input: CreateSnapshotInput<TValue>,
    ): Promise<Snapshot<TValue>> {
        this.#requireActionRun(input.actionRunId);

        const snapshot: Snapshot<TValue> = {
            id: this.#createId('snapshot'),
            actionRunId: input.actionRunId,
            key: input.key,
            value: input.value,
            createdAt: this.#clock.now(),
            ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        };

        const snapshots = this.#snapshotsByActionRunId.get(input.actionRunId) ?? [];
        snapshots.push(snapshot as Snapshot);

        this.#snapshotsByActionRunId.set(input.actionRunId, snapshots);

        return snapshot;
    }

    async getSnapshots(actionRunId: string): Promise<readonly Snapshot[]> {
        return [...(this.#snapshotsByActionRunId.get(actionRunId) ?? [])];
    }

    async recordSideEffect<TPayload extends JsonValue = JsonValue>(
        input: RecordSideEffectInput<TPayload>,
    ): Promise<ActionSideEffect<TPayload>> {
        this.#requireActionRun(input.actionRunId);

        const sideEffect: ActionSideEffect<TPayload> = {
            id: this.#createId('effect'),
            actionRunId: input.actionRunId,
            type: input.type,
            status: input.status,
            reversibility: input.reversibility,
            createdAt: this.#clock.now(),
            ...(input.payload === undefined ? {} : { payload: input.payload }),
            ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        };

        const sideEffects = this.#sideEffectsByActionRunId.get(input.actionRunId) ?? [];
        sideEffects.push(sideEffect as ActionSideEffect);

        this.#sideEffectsByActionRunId.set(input.actionRunId, sideEffects);

        return sideEffect;
    }

    async recordConflict(input: RecordConflictInput): Promise<ActionConflict> {
        this.#requireActionRun(input.actionRunId);

        const conflict: ActionConflict = {
            id: this.#createId('conflict'),
            actionRunId: input.actionRunId,
            reason: input.reason,
            createdAt: this.#clock.now(),
            ...(input.details === undefined ? {} : { details: input.details }),
        };

        const conflicts = this.#conflictsByActionRunId.get(input.actionRunId) ?? [];
        conflicts.push(conflict);

        this.#conflictsByActionRunId.set(input.actionRunId, conflicts);

        return conflict;
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

        return runs;
    }

    async withActionRunLock<TValue>(
        actionRunId: string,
        handler: (run: ActionRun) => Promise<TValue>,
    ): Promise<TValue> {
        const previous = this.#locks.get(actionRunId) ?? Promise.resolve();

        let release = () => {};

        const current = new Promise<void>((resolve) => {
            release = () => resolve();
        });

        const queued = previous.catch(() => undefined).then(() => current);

        this.#locks.set(actionRunId, queued);

        await previous.catch(() => undefined);

        try {
            return await handler(this.#requireActionRun(actionRunId));
        } finally {
            release();

            if (this.#locks.get(actionRunId) === queued) {
                this.#locks.delete(actionRunId);
            }
        }
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

    #createId(kind: string): string {
        const id = `${this.#idPrefix}${kind}_${this.#nextId}`;
        this.#nextId += 1;

        return id;
    }
}

export function createMemoryStorageAdapter(
    options?: MemoryStorageAdapterOptions,
): MemoryStorageAdapter {
    return new MemoryStorageAdapter(options);
}
