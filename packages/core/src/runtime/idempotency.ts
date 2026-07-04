import { RollbackKitError } from '../errors/rollbackkit-error';
import type { ActionTarget } from '../identity/target';
import type { ActionRun } from '../lifecycle/lifecycle';
import type { JsonObject, JsonValue } from '../shared/json';

const FNV_64_OFFSET = 0xcbf29ce484222325n;
const FNV_64_PRIME = 0x100000001b3n;
const FNV_64_MASK = 0xffffffffffffffffn;

export const MAX_IDEMPOTENCY_KEY_BYTES = 255;

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

export function assertIdempotencyKeyForStorage(idempotencyKey: string): void {
    const sizeBytes = Buffer.byteLength(idempotencyKey, 'utf8');

    if (sizeBytes <= MAX_IDEMPOTENCY_KEY_BYTES) {
        return;
    }

    throw new RollbackKitError({
        code: 'ACTION_INPUT_INVALID',
        message: `Idempotency key must be ${MAX_IDEMPOTENCY_KEY_BYTES} bytes or less.`,
        details: {
            field: 'idempotencyKey',
            maxBytes: MAX_IDEMPOTENCY_KEY_BYTES,
            actualBytes: sizeBytes,
        },
    });
}

export function assertIdempotentRequestMatches(
    run: ActionRun,
    request: {
        readonly actionName: string;
        readonly idempotencyKey: string;
        readonly canonicalInput: string;
        readonly inputHash: string;
        readonly target?: ActionTarget;
    },
): void {
    if (stringifyCanonicalJson(run.input) !== request.canonicalInput) {
        throw new RollbackKitError({
            code: 'IDEMPOTENCY_CONFLICT',
            message: `Idempotency key "${request.idempotencyKey}" was already used for action "${request.actionName}" with different input.`,
            details: {
                actionName: request.actionName,
                actionRunId: run.id,
                idempotencyKey: request.idempotencyKey,
                existingInputHash:
                    run.inputHash ?? createActionInputFingerprint(run.input).inputHash,
                requestedInputHash: request.inputHash,
            },
        });
    }

    const existingTarget = stringifyCanonicalJson(actionTargetToJsonValue(run.target));
    const requestedTarget = stringifyCanonicalJson(actionTargetToJsonValue(request.target));

    if (existingTarget === requestedTarget) {
        return;
    }

    throw new RollbackKitError({
        code: 'IDEMPOTENCY_CONFLICT',
        message: `Idempotency key "${request.idempotencyKey}" was already used for action "${request.actionName}" with different target.`,
        details: {
            actionName: request.actionName,
            actionRunId: run.id,
            idempotencyKey: request.idempotencyKey,
        },
    });
}

function actionTargetToJsonValue(target: ActionTarget | undefined): JsonValue {
    if (target === undefined) {
        return null;
    }

    return {
        id: target.id,
        type: target.type,
    };
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
