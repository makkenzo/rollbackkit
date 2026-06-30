import { RollbackKitError } from '../errors/rollbackkit-error';
import type { ActionRun } from '../lifecycle/lifecycle';
import type { JsonObject, JsonValue } from '../shared/json';

const FNV_64_OFFSET = 0xcbf29ce484222325n;
const FNV_64_PRIME = 0x100000001b3n;
const FNV_64_MASK = 0xffffffffffffffffn;

export interface ActionInputFingerprint {
    readonly canonicalInput: string;
    readonly inputHash: string;
}

export function createActionInputFingerprint(input: JsonValue): ActionInputFingerprint {
    const canonicalInput = stringifyCanonicalJson(input);

    return {
        canonicalInput,
        inputHash: `fnv1a64:${createFnv1a64Hash(canonicalInput)}`,
    };
}

export function assertIdempotentInputMatches(
    run: ActionRun,
    request: {
        readonly actionName: string;
        readonly idempotencyKey: string;
        readonly canonicalInput: string;
        readonly inputHash: string;
    },
): void {
    if (stringifyCanonicalJson(run.input) === request.canonicalInput) {
        return;
    }

    throw new RollbackKitError({
        code: 'IDEMPOTENCY_CONFLICT',
        message: `Idempotency key "${request.idempotencyKey}" was already used for action "${request.actionName}" with different input.`,
        details: {
            actionName: request.actionName,
            actionRunId: run.id,
            idempotencyKey: request.idempotencyKey,
            existingInputHash: run.inputHash ?? createActionInputFingerprint(run.input).inputHash,
            requestedInputHash: request.inputHash,
        },
    });
}

function stringifyCanonicalJson(value: JsonValue): string {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
        return JSON.stringify(value);
    }

    if (typeof value === 'string') {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map(stringifyCanonicalJson).join(',')}]`;
    }

    const entries = Object.entries(value as JsonObject).sort(([left], [right]) =>
        left.localeCompare(right),
    );

    return `{${entries
        .map(([key, entryValue]) => `${JSON.stringify(key)}:${stringifyCanonicalJson(entryValue)}`)
        .join(',')}}`;
}

function createFnv1a64Hash(value: string): string {
    let hash = FNV_64_OFFSET;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= BigInt(value.charCodeAt(index));
        hash = (hash * FNV_64_PRIME) & FNV_64_MASK;
    }

    return hash.toString(16).padStart(16, '0');
}
