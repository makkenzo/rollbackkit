import type { JsonObject } from '../shared';

export type RollbackKitErrorCode =
    | 'ACTION_NOT_FOUND'
    | 'ACTION_ALREADY_REGISTERED'
    | 'ACTION_INPUT_INVALID'
    | 'ACTION_PERMISSION_DENIED'
    | 'ACTION_EXECUTION_FAILED'
    | 'ACTION_UNDO_FAILED'
    | 'ACTION_NOT_UNDOABLE'
    | 'ACTION_ALREADY_UNDONE'
    | 'ACTION_UNDO_EXPIRED'
    | 'ACTION_CONFLICT'
    | 'IDEMPOTENCY_CONFLICT'
    | 'SNAPSHOT_NOT_FOUND'
    | 'STORAGE_ERROR';

export interface SerializedRollbackKitError {
    readonly code: RollbackKitErrorCode;
    readonly message: string;
    readonly details?: JsonObject;
}

export interface RollbackKitErrorOptions {
    readonly code: RollbackKitErrorCode;
    readonly message: string;
    readonly details?: JsonObject;
    readonly cause?: unknown;
}

export class RollbackKitError extends Error {
    readonly code: RollbackKitErrorCode;
    readonly details?: JsonObject;

    constructor(options: RollbackKitErrorOptions) {
        super(
            options.message,
            options.cause === undefined
                ? undefined
                : {
                      cause: options.cause,
                  },
        );

        this.name = 'RollbackKitError';
        this.code = options.code;

        if (options.details !== undefined) {
            this.details = options.details;
        }
    }

    toJSON(): SerializedRollbackKitError {
        if (this.details === undefined) {
            return {
                code: this.code,
                message: this.message,
            };
        }

        return {
            code: this.code,
            message: this.message,
            details: this.details,
        };
    }
}

export function isRollbackKitError(error: unknown): error is RollbackKitError {
    return error instanceof RollbackKitError;
}
