import type { BaseActionContext } from '../action/definition';
import type { ActionActor } from '../identity/actor';
import type { ActionTarget } from '../identity/target';
import type { ActionRun } from '../lifecycle/lifecycle';
import type { JsonObject, JsonValue } from '../shared/json';
import type { Clock } from '../shared/time';

interface ActionRequestContext {
    readonly actor: ActionActor;
    readonly tenantId?: string;
    readonly metadata?: JsonObject;
}

export interface CreateBaseActionContextInput {
    readonly actionName: string;
    readonly input: JsonValue;
    readonly request: ActionRequestContext;
    readonly target?: ActionTarget;
    readonly clock: Clock;
}

export interface CreateBaseActionContextFromRunInput {
    readonly actionName: string;
    readonly run: ActionRun;
    readonly actor: ActionActor;
    readonly metadata?: JsonObject;
    readonly clock: Clock;
}

export function createBaseActionContext(
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

export function createBaseActionContextFromRun(
    input: CreateBaseActionContextFromRunInput,
): BaseActionContext<JsonValue> {
    return {
        actionName: input.actionName,
        input: input.run.input,
        actor: input.actor,
        clock: input.clock,
        ...(input.run.tenantId === undefined ? {} : { tenantId: input.run.tenantId }),
        ...(input.run.target === undefined ? {} : { target: input.run.target }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    };
}
