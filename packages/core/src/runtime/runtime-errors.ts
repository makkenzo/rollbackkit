import { isRollbackKitError, RollbackKitError } from '../errors/rollbackkit-error';
import type { ActionRun } from '../lifecycle/lifecycle';
import { isUndoable } from '../lifecycle/reversibility';

export function normalizeExecutionError(actionName: string, error: unknown): RollbackKitError {
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

export function assertActionRunCanBeUndone(run: ActionRun, now: Date): void {
    if (run.status === 'undone') {
        throw new RollbackKitError({
            code: 'ACTION_ALREADY_UNDONE',
            message: `Action run "${run.id}" has already been undone.`,
            details: {
                actionRunId: run.id,
                actionName: run.name,
            },
        });
    }

    if (run.status !== 'completed') {
        throw createActionNotUndoableError(
            run,
            `Action run status is "${run.status}". Only completed action runs can be undone.`,
        );
    }

    if (!isUndoable(run.reversibility)) {
        throw createActionNotUndoableError(run, 'Action run reversibility is not undoable.');
    }

    if (run.undoExpiresAt !== undefined && run.undoExpiresAt.getTime() <= now.getTime()) {
        throw new RollbackKitError({
            code: 'ACTION_UNDO_EXPIRED',
            message: `Action run "${run.id}" undo window has expired.`,
            details: {
                actionRunId: run.id,
                actionName: run.name,
                undoExpiresAt: run.undoExpiresAt.toISOString(),
            },
        });
    }
}

export function assertUndoTenantMatches(run: ActionRun, tenantId: string | undefined): void {
    if (tenantId === undefined || run.tenantId === tenantId) {
        return;
    }

    throw new RollbackKitError({
        code: 'ACTION_PERMISSION_DENIED',
        message: `Action run "${run.id}" does not belong to tenant "${tenantId}".`,
        details: {
            actionRunId: run.id,
            actionName: run.name,
            tenantId,
            ...(run.tenantId === undefined ? {} : { actionRunTenantId: run.tenantId }),
        },
    });
}

export function createRecordedConflictError(run: ActionRun): RollbackKitError {
    return new RollbackKitError({
        code: 'ACTION_CONFLICT',
        message: `Action run "${run.id}" cannot be undone because conflict checks recorded unsafe state.`,
        details: {
            actionRunId: run.id,
            actionName: run.name,
        },
    });
}

export function createActionRunNotFoundError(actionRunId: string): RollbackKitError {
    return new RollbackKitError({
        code: 'ACTION_NOT_FOUND',
        message: `Action run "${actionRunId}" was not found.`,
        details: {
            actionRunId,
        },
    });
}

export function createActionNotUndoableError(run: ActionRun, reason: string): RollbackKitError {
    return new RollbackKitError({
        code: 'ACTION_NOT_UNDOABLE',
        message: `Action run "${run.id}" cannot be undone: ${reason}`,
        details: {
            actionRunId: run.id,
            actionName: run.name,
            status: run.status,
            reason,
        },
    });
}

export function createActionDefinitionNotUndoableError(
    actionName: string,
    reason: string,
): RollbackKitError {
    return new RollbackKitError({
        code: 'ACTION_NOT_UNDOABLE',
        message: `Action "${actionName}" cannot create an undoable run: ${reason}`,
        details: {
            actionName,
            reason,
        },
    });
}

export function normalizeUndoError(actionName: string, error: unknown): RollbackKitError {
    if (isRollbackKitError(error)) {
        return error;
    }

    return new RollbackKitError({
        code: 'ACTION_UNDO_FAILED',
        message: `Action "${actionName}" undo failed.`,
        details: {
            actionName,
        },
        cause: error,
    });
}
