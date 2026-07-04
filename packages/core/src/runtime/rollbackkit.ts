import type { ActionDefinition } from '../action/definition';
import {
    type ActionRegistry,
    createActionRegistry,
    type RegisteredActionDefinition,
} from '../action/registry';
import { RollbackKitError } from '../errors/rollbackkit-error';
import type { ActionActor } from '../identity/actor';
import type { ActionTarget } from '../identity/target';
import type { ActionRun } from '../lifecycle/lifecycle';
import type { PreviewResult } from '../lifecycle/preview';
import { isUndoable } from '../lifecycle/reversibility';
import type { JsonObject, JsonValue } from '../shared/json';
import type { Clock } from '../shared/time';
import { systemClock } from '../shared/time';
import { createMemoryStorageAdapter } from '../storage/memory-storage';
import type { Snapshot } from '../storage/snapshot';
import type {
    ActionConflict,
    ActionHistoryQuery,
    ActionRunRecordQuery,
    ActionSideEffect,
    StorageAdapter,
} from '../storage/storage';
import { parseActionInput } from './action-input';
import { resolveActionTarget } from './action-target';
import { authorizeAction } from './authorization';
import { createBaseActionContext, createBaseActionContextFromRun } from './contexts';
import {
    assertIdempotencyKeyForStorage,
    assertIdempotentRequestMatches,
    createActionInputFingerprint,
} from './idempotency';
import { assertJsonObjectForStorage, assertJsonValueForStorage } from './json-assertions';
import { applyDefaultUndoWindow, createUndoExpiration, mergeMetadata } from './lifecycle-helpers';
import {
    assertActionRunCanBeUndone,
    assertUndoTenantMatches,
    createActionDefinitionNotUndoableError,
    createActionNotUndoableError,
    createActionRunNotFoundError,
    createIrreversibleSideEffectError,
    createPersistedConflictError,
    createRecordedConflictError,
    normalizeExecutionError,
    normalizeUndoError,
} from './runtime-errors';
import {
    BoundSideEffectRecorder,
    BoundSnapshotReader,
    BoundSnapshotRecorder,
    DeferredConflictRecorder,
} from './snapshot-bindings';

export interface RollbackKitOptions {
    readonly registry?: ActionRegistry;
    readonly actions?: readonly RegisteredActionDefinition[];
    readonly storage?: StorageAdapter;
    readonly clock?: Clock;
}

export interface UndoActionRequest {
    readonly actionRunId: string;
    readonly actor: ActionActor;
    readonly tenantId?: string;
    readonly metadata?: JsonObject;
}

export interface PreviewActionRequest {
    readonly name: string;
    readonly input?: unknown;
    readonly actor: ActionActor;
    readonly tenantId?: string;
    readonly target?: ActionTarget;
    readonly metadata?: JsonObject;
}

export interface ExecuteActionRequest {
    readonly name: string;
    readonly input?: unknown;
    readonly idempotencyKey?: string;
    readonly actor: ActionActor;
    readonly tenantId?: string;
    readonly target?: ActionTarget;
    readonly metadata?: JsonObject;
}

export class RollbackKit {
    readonly registry: ActionRegistry;

    readonly #clock: Clock;
    readonly #storage: StorageAdapter;

    constructor(options: RollbackKitOptions = {}) {
        this.registry = options.registry ?? createActionRegistry(options.actions ?? []);
        this.#clock = options.clock ?? systemClock;
        this.#storage = options.storage ?? createMemoryStorageAdapter({ clock: this.#clock });
    }

    registerAction<
        TInput extends JsonValue = JsonObject,
        TExecuteData extends JsonValue = JsonValue,
        TUndoData extends JsonValue = JsonValue,
    >(definition: ActionDefinition<TInput, TExecuteData, TUndoData>): this {
        this.registry.register(definition);

        return this;
    }

    async preview(request: PreviewActionRequest): Promise<PreviewResult> {
        const action = this.registry.require(request.name);
        const input = await parseActionInput(action, request.input);

        const initialContext = createBaseActionContext({
            actionName: action.name,
            input,
            request,
            clock: this.#clock,
            ...(request.target === undefined ? {} : { target: request.target }),
        });

        const target = await resolveActionTarget(action, initialContext);

        const baseContext = createBaseActionContext({
            actionName: action.name,
            input,
            request,
            clock: this.#clock,
            ...(target === undefined ? {} : { target }),
        });

        await authorizeAction(action, {
            ...baseContext,
            phase: 'preview',
        });

        const preview = await action.preview({
            ...baseContext,
            phase: 'preview',
        });

        return applyDefaultUndoWindow(preview, action.undoWindowMs);
    }

    async execute(request: ExecuteActionRequest): Promise<ActionRun> {
        const action = this.registry.require(request.name);
        const input = await parseActionInput(action, request.input);
        const inputFingerprint = createActionInputFingerprint(input);

        if (isUndoable(action.reversibility) && action.undo === undefined) {
            throw createActionDefinitionNotUndoableError(
                action.name,
                'Undoable actions must provide an undo handler before execution.',
            );
        }

        const initialContext = createBaseActionContext({
            actionName: action.name,
            input,
            request,
            clock: this.#clock,
            ...(request.target === undefined ? {} : { target: request.target }),
        });

        const target = await resolveActionTarget(action, initialContext);

        const baseContext = createBaseActionContext({
            actionName: action.name,
            input,
            request,
            clock: this.#clock,
            ...(target === undefined ? {} : { target }),
        });

        await authorizeAction(action, {
            ...baseContext,
            phase: 'execute',
        });

        const idempotencyKey = request.idempotencyKey;

        if (idempotencyKey !== undefined) {
            assertIdempotencyKeyForStorage(idempotencyKey);
        }

        const createInput = {
            name: action.name,
            actor: request.actor,
            input,
            inputHash: inputFingerprint.inputHash,
            reversibility: action.reversibility,
            ...(request.tenantId === undefined ? {} : { tenantId: request.tenantId }),
            ...(target === undefined ? {} : { target }),
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
            ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
            ...createUndoExpiration(action.reversibility, action.undoWindowMs, this.#clock.now()),
        };

        const actionRunClaim =
            idempotencyKey === undefined
                ? {
                      run: await this.#storage.createActionRun(createInput),
                      created: true,
                  }
                : await this.#storage.claimActionRun({
                      ...createInput,
                      idempotencyKey,
                  });

        const run = actionRunClaim.run;

        if (!actionRunClaim.created) {
            if (idempotencyKey === undefined) {
                throw new RollbackKitError({
                    code: 'STORAGE_ERROR',
                    message: 'Storage returned an existing action run without an idempotency key.',
                    details: {
                        actionName: action.name,
                        actionRunId: run.id,
                    },
                });
            }

            assertIdempotentRequestMatches(run, {
                actionName: action.name,
                idempotencyKey,
                canonicalInput: inputFingerprint.canonicalInput,
                inputHash: inputFingerprint.inputHash,
                ...(target === undefined ? {} : { target }),
            });

            return run;
        }

        try {
            return await this.#storage.withTransaction(async () => {
                const runningRun = await this.#storage.updateActionRun(run.id, {
                    status: 'running',
                });

                const result = await action.execute({
                    ...baseContext,
                    phase: 'execute',
                    run: runningRun,
                    snapshots: new BoundSnapshotRecorder(this.#storage, run.id),
                    sideEffects: new BoundSideEffectRecorder(this.#storage, run.id),
                });

                if (result.data !== undefined) {
                    assertJsonValueForStorage(result.data, 'execute.result.data');
                }

                if (result.metadata !== undefined) {
                    assertJsonObjectForStorage(result.metadata, 'execute.result.metadata');
                }

                const completedMetadata = mergeMetadata(runningRun.metadata, result.metadata);

                return this.#storage.updateActionRun(run.id, {
                    status: 'completed',
                    executedAt: this.#clock.now(),
                    ...(result.data === undefined ? {} : { result: result.data }),
                    ...(completedMetadata === undefined ? {} : { metadata: completedMetadata }),
                });
            });
        } catch (error) {
            const rollbackError = normalizeExecutionError(action.name, error);

            await this.#storage.updateActionRun(run.id, {
                status: 'failed',
                executedAt: this.#clock.now(),
                error: rollbackError.toJSON(),
            });

            throw rollbackError;
        }
    }

    async undo(request: UndoActionRequest): Promise<ActionRun> {
        const existingRun = await this.#storage.getActionRun(request.actionRunId);

        if (existingRun === null) {
            throw createActionRunNotFoundError(request.actionRunId);
        }

        assertUndoTenantMatches(existingRun, request.tenantId);

        const action = this.registry.require(existingRun.name);
        const authContext = createBaseActionContextFromRun({
            actionName: action.name,
            run: existingRun,
            actor: request.actor,
            clock: this.#clock,
            ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
        });

        await authorizeAction(action, {
            ...authContext,
            phase: 'undo',
        });

        const undoHandler = action.undo;

        if (undoHandler === undefined) {
            throw createActionNotUndoableError(
                existingRun,
                'Action definition does not provide an undo handler.',
            );
        }

        let conflicts: DeferredConflictRecorder | undefined;

        try {
            const undoRunningRun = await this.#storage.withActionRunLock(
                request.actionRunId,
                async (lockedRun) => {
                    assertActionRunCanBeUndone(lockedRun, this.#clock.now());

                    return this.#storage.updateActionRun(lockedRun.id, {
                        status: 'undo_running',
                        undoStartedAt: this.#clock.now(),
                    });
                },
            );

            conflicts = new DeferredConflictRecorder(undoRunningRun.id, this.#clock);

            const baseContext = createBaseActionContextFromRun({
                actionName: action.name,
                run: undoRunningRun,
                actor: request.actor,
                clock: this.#clock,
                ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
            });

            const undoContext = {
                ...baseContext,
                phase: 'undo',
                run: undoRunningRun,
                snapshots: new BoundSnapshotReader(this.#storage, undoRunningRun.id),
                conflicts,
            } as const;

            const undoneRun = await this.#storage.withTransaction(async () => {
                const recordQuery = createActionRunRecordQuery(undoRunningRun);
                const persistedConflicts = await this.#storage.getConflicts(recordQuery);

                if (persistedConflicts.length > 0) {
                    throw createPersistedConflictError(undoRunningRun, persistedConflicts.length);
                }

                const irreversibleSideEffect = (
                    await this.#storage.getSideEffects(recordQuery)
                ).find(
                    (sideEffect) =>
                        sideEffect.status === 'completed' && !isUndoable(sideEffect.reversibility),
                );

                if (irreversibleSideEffect !== undefined) {
                    throw createIrreversibleSideEffectError(undoRunningRun, irreversibleSideEffect);
                }

                await action.checkConflicts?.(undoContext);

                if (conflicts?.hasRecords()) {
                    throw createRecordedConflictError(undoRunningRun);
                }

                const result = await undoHandler(undoContext);

                if (result.data !== undefined) {
                    assertJsonValueForStorage(result.data, 'undo.result.data');
                }

                if (result.metadata !== undefined) {
                    assertJsonObjectForStorage(result.metadata, 'undo.result.metadata');
                }

                const undoneMetadata = mergeMetadata(undoRunningRun.metadata, result.metadata);

                return this.#storage.updateActionRun(undoRunningRun.id, {
                    status: 'undone',
                    undoneAt: this.#clock.now(),
                    undoneBy: request.actor,
                    ...(result.data === undefined ? {} : { undoResult: result.data }),
                    ...(undoneMetadata === undefined ? {} : { metadata: undoneMetadata }),
                });
            });

            conflicts = undefined;

            return undoneRun;
        } catch (error) {
            if (conflicts === undefined) {
                throw error;
            }

            const rollbackError = normalizeUndoError(action.name, error);

            await this.#storage.updateActionRun(existingRun.id, {
                status: 'undo_failed',
                error: rollbackError.toJSON(),
            });

            await conflicts.flush(this.#storage);

            throw rollbackError;
        }
    }

    async getActionRun(id: string): Promise<ActionRun | null> {
        return this.#storage.getActionRun(id);
    }

    async getSnapshots(actionRunId: string): Promise<readonly Snapshot[]> {
        return this.#storage.getSnapshots(actionRunId);
    }

    async getSideEffects(query: ActionRunRecordQuery): Promise<readonly ActionSideEffect[]> {
        return this.#storage.getSideEffects(query);
    }

    async getConflicts(query: ActionRunRecordQuery): Promise<readonly ActionConflict[]> {
        return this.#storage.getConflicts(query);
    }

    async queryActionRuns(query: ActionHistoryQuery): Promise<readonly ActionRun[]> {
        return this.#storage.queryActionRuns(query);
    }
}

export function createRollbackKit(options?: RollbackKitOptions): RollbackKit {
    return new RollbackKit(options);
}

function createActionRunRecordQuery(run: ActionRun): ActionRunRecordQuery {
    return {
        actionRunId: run.id,
        ...(run.tenantId === undefined ? {} : { tenantId: run.tenantId }),
        actorId: run.actor.id,
        actorType: run.actor.type,
    };
}
