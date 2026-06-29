import type { ActionDefinition } from './action';
import { RollbackKitError } from './errors';
import type { JsonObject, JsonValue } from './json';

export type RegisteredActionDefinition = ActionDefinition<JsonValue, JsonValue, JsonValue>;

export class ActionRegistry {
    readonly #actions = new Map<string, RegisteredActionDefinition>();

    constructor(definitions: readonly ActionDefinition[] = []) {
        this.registerMany(definitions);
    }

    register<
        TInput extends JsonValue = JsonObject,
        TExecuteData extends JsonValue = JsonValue,
        TUndoData extends JsonValue = JsonValue,
    >(definition: ActionDefinition<TInput, TExecuteData, TUndoData>): this {
        if (this.#actions.has(definition.name)) {
            throw new RollbackKitError({
                code: 'ACTION_ALREADY_REGISTERED',
                message: `Action "${definition.name}" is already registered.`,
                details: {
                    actionName: definition.name,
                },
            });
        }

        this.#actions.set(definition.name, definition as unknown as RegisteredActionDefinition);

        return this;
    }

    registerMany(definitions: readonly ActionDefinition[]): this {
        for (const definition of definitions) {
            this.register(definition);
        }

        return this;
    }

    has(name: string): boolean {
        return this.#actions.has(name);
    }

    get(name: string): RegisteredActionDefinition | null {
        return this.#actions.get(name) ?? null;
    }

    require(name: string): RegisteredActionDefinition {
        const action = this.get(name);

        if (action === null) {
            throw new RollbackKitError({
                code: 'ACTION_NOT_FOUND',
                message: `Action "${name}" is not registered.`,
                details: {
                    actionName: name,
                },
            });
        }

        return action;
    }

    list(): readonly RegisteredActionDefinition[] {
        return Array.from(this.#actions.values());
    }

    get size(): number {
        return this.#actions.size;
    }
}

export function createActionRegistry(
    definitions: readonly ActionDefinition[] = [],
): ActionRegistry {
    return new ActionRegistry(definitions);
}
