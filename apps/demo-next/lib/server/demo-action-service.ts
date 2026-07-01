import 'server-only';

import { type ActionRun, isRollbackKitError } from '@rollbackkit/core';
import type { DemoActionError, DemoActionResponse, DemoActionRunDto } from '../demo-action-types';

export type { DemoActionError, DemoActionResponse, DemoActionRunDto };

export async function runDemoAction<TData>(
    handler: () => Promise<TData>,
): Promise<DemoActionResponse<TData>> {
    try {
        return {
            ok: true,
            data: await handler(),
        };
    } catch (error) {
        return {
            ok: false,
            error: serializeActionError(error),
        };
    }
}

export function serializeActionRun(run: ActionRun): DemoActionRunDto {
    return {
        id: run.id,
        name: run.name,
        status: run.status,
        createdAt: run.createdAt.toISOString(),
        canUndo:
            run.status === 'completed' &&
            run.reversibility.undoable &&
            run.undoExpiresAt !== undefined,
        ...(run.target === undefined
            ? {}
            : {
                  target: {
                      id: run.target.id,
                      type: run.target.type,
                      ...(run.target.label === undefined ? {} : { label: run.target.label }),
                  },
              }),
        ...(run.executedAt === undefined ? {} : { executedAt: run.executedAt.toISOString() }),
        ...(run.undoExpiresAt === undefined
            ? {}
            : { undoExpiresAt: run.undoExpiresAt.toISOString() }),
        ...(run.undoStartedAt === undefined
            ? {}
            : { undoStartedAt: run.undoStartedAt.toISOString() }),
        ...(run.undoneAt === undefined ? {} : { undoneAt: run.undoneAt.toISOString() }),
    };
}

function serializeActionError(error: unknown): DemoActionError {
    if (isRollbackKitError(error)) {
        return {
            code: error.code,
            message: error.message,
        };
    }

    if (error instanceof Error) {
        return {
            message: error.message,
        };
    }

    return {
        message: 'Unknown demo action error.',
    };
}
