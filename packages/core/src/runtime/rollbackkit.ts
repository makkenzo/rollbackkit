import type {
    ActionDefinition,
    AuthorizationContext,
    BaseActionContext,
    PermissionDecision,
} from '../action/definition';
import { type ActionRegistry, createActionRegistry } from '../action/registry';
import { isRollbackKitError, RollbackKitError } from '../errors/rollbackkit-error';
import type { ActionActor } from '../identity/actor';
import type { ActionTarget } from '../identity/target';
import type { ActionPhase, ActionRun } from '../lifecycle/lifecycle';
import type { PreviewResult } from '../lifecycle/preview';
import type { Reversibility } from '../lifecycle/reversibility';
import { isJsonValue, type JsonObject, type JsonValue } from '../shared/json';
import type { Clock } from '../shared/time';
import { systemClock } from '../shared/time';
import { createMemoryStorageAdapter } from '../storage/memory-storage';
import type { Snapshot, SnapshotRecorder } from '../storage/snapshot';
import type { StorageAdapter } from '../storage/storage';

export interface RollbackKitOptions {
    readonly registry?: ActionRegistry;
    readonly actions?: readonly ActionDefinition[];
    readonly storage?: StorageAdapter;
    readonly clock?: Clock;
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
    readonly actor: ActionActor;
    readonly tenantId?: string;
    readonly target?: ActionTarget;
    readonly metadata?: JsonObject;
}

export class RollbackKit {
    readonly registry: ActionRegistry;
    readonly storage: StorageAdapter;

    readonly #clock: Clock;

    constructor(options: RollbackKitOptions = {}) {
        this.registry = options.registry ?? createActionRegistry(options.actions ?? []);
        this.#clock = options.clock ?? systemClock;
        this.storage = options.storage ?? createMemoryStorageAdapter({ clock: this.#clock });
    }

    registerAction(definition: ActionDefinition): this {
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

        const run = await this.storage.createActionRun({
            name: action.name,
            actor: request.actor,
            input,
            reversibility: action.reversibility,
            ...(request.tenantId === undefined ? {} : { tenantId: request.tenantId }),
            ...(target === undefined ? {} : { target }),
            ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
            ...createUndoExpiration(action.reversibility, action.undoWindowMs, this.#clock.now()),
        });

        const runningRun = await this.storage.updateActionRun(run.id, {
            status: 'running',
        });

        try {
            const result = await action.execute({
                ...baseContext,
                phase: 'execute',
                run: runningRun,
                snapshots: new BoundSnapshotRecorder(this.storage, run.id),
            });

            const completedMetadata = mergeMetadata(runningRun.metadata, result.metadata);

            return await this.storage.updateActionRun(run.id, {
                status: 'completed',
                executedAt: this.#clock.now(),
                ...(result.data === undefined ? {} : { result: result.data }),
                ...(completedMetadata === undefined ? {} : { metadata: completedMetadata }),
            });
        } catch (error) {
            const rollbackError = normalizeExecutionError(action.name, error);

            await this.storage.updateActionRun(run.id, {
                status: 'failed',
                executedAt: this.#clock.now(),
                error: rollbackError.toJSON(),
            });

            throw rollbackError;
        }
    }
}

export function createRollbackKit(options?: RollbackKitOptions): RollbackKit {
    return new RollbackKit(options);
}

interface CreateBaseActionContextInput {
    readonly actionName: string;
    readonly input: JsonValue;
    readonly request: PreviewActionRequest | ExecuteActionRequest;
    readonly target?: ActionTarget;
    readonly clock: Clock;
}

class BoundSnapshotRecorder implements SnapshotRecorder {
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

function createBaseActionContext(
    input: CreateBaseActionContextInput,
): BaseActionContext<JsonValue> {
    return {
        actionName: input.actionName,
        input: input.input,
        actor: input.request.actor,
        clock: input.clock,
        ...(input.request.tenantId === undefined ? {} : { tenantId: input.request.tenantId }),
        ...(input.target === undefined ? {} : { target: input.target }),
        ...(input.request.metadata === undefined ? {} : { metadata: input.request.metadata }),
    };
}

async function parseActionInput(
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

async function resolveActionTarget(
    action: ActionDefinition<JsonValue, JsonValue, JsonValue>,
    context: BaseActionContext<JsonValue>,
): Promise<ActionTarget | undefined> {
    if (action.resolveTarget === undefined) {
        return context.target;
    }

    const target = await action.resolveTarget(context);

    return target ?? undefined;
}

async function authorizeAction(
    action: ActionDefinition<JsonValue, JsonValue, JsonValue>,
    context: AuthorizationContext<JsonValue>,
): Promise<void> {
    if (action.authorize === undefined) {
        return;
    }

    const decision = await action.authorize(context);

    if (isPermissionAllowed(decision)) {
        return;
    }

    throw new RollbackKitError({
        code: 'ACTION_PERMISSION_DENIED',
        message: createPermissionDeniedMessage(action.name, context.phase, decision),
        details: createPermissionDeniedDetails(action.name, context.phase, decision),
    });
}

function isPermissionAllowed(decision: PermissionDecision): boolean {
    return typeof decision === 'boolean' ? decision : decision.allowed;
}

function createPermissionDeniedMessage(
    actionName: string,
    phase: ActionPhase,
    decision: PermissionDecision,
): string {
    const reason = typeof decision === 'boolean' ? undefined : decision.reason;

    if (reason === undefined) {
        return `Action "${actionName}" permission denied during ${phase}.`;
    }

    return `Action "${actionName}" permission denied during ${phase}: ${reason}`;
}

function createPermissionDeniedDetails(
    actionName: string,
    phase: ActionPhase,
    decision: PermissionDecision,
): JsonObject {
    if (typeof decision === 'boolean') {
        return {
            actionName,
            phase,
        };
    }

    return {
        actionName,
        phase,
        ...(decision.reason === undefined ? {} : { reason: decision.reason }),
        ...(decision.metadata === undefined ? {} : { metadata: decision.metadata }),
    };
}

function applyDefaultUndoWindow(preview: PreviewResult, undoWindowMs?: number): PreviewResult {
    if (preview.undoWindowMs !== undefined || undoWindowMs === undefined) {
        return preview;
    }

    return {
        ...preview,
        undoWindowMs,
    };
}

function createUndoExpiration(
    reversibility: Reversibility,
    undoWindowMs: number | undefined,
    now: Date,
): { readonly undoExpiresAt?: Date } {
    if (!reversibility.undoable || undoWindowMs === undefined) {
        return {};
    }

    return {
        undoExpiresAt: new Date(now.getTime() + undoWindowMs),
    };
}

function mergeMetadata(
    existing: JsonObject | undefined,
    next: JsonObject | undefined,
): JsonObject | undefined {
    if (existing === undefined) {
        return next;
    }

    if (next === undefined) {
        return existing;
    }

    return {
        ...existing,
        ...next,
    };
}

function normalizeExecutionError(actionName: string, error: unknown): RollbackKitError {
    if (isRollbackKitError(error)) {
        return error;
    }

    return new RollbackKitError({
        code: 'ACTION_EXECUTION_FAILED',
        message: `Action "${actionName}" execution failed.`,
        details: {
            actionName,
        },
        cause: error,
    });
}
