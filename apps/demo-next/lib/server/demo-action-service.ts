import 'server-only';

import {
    type ActionRun,
    type ExecuteActionRequest,
    isRollbackKitError,
    type PreviewActionRequest,
    type PreviewResult,
} from '@rollbackkit/core';
import type {
    DemoActionConflictDto,
    DemoActionError,
    DemoActionResponse,
    DemoActionRunDto,
} from '../demo-action-types';
import type { DemoRequestContext } from './demo-request-context';
import { withDemoRollbackKit } from './rollbackkit';

export type { DemoActionError, DemoActionResponse, DemoActionRunDto };

export async function previewDemoAction(
    actionName: string,
    input: PreviewActionRequest['input'],
    context: DemoRequestContext,
): Promise<DemoActionResponse<PreviewResult>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) =>
            rollbackkit.preview({
                name: actionName,
                actor: context.actor,
                tenantId: context.tenantId,
                input,
            }),
        ),
    );
}

export async function executeDemoAction(
    actionName: string,
    input: ExecuteActionRequest['input'],
    idempotencyKey: string,
    context: DemoRequestContext,
): Promise<DemoActionResponse<DemoActionRunDto>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) => {
            const run = await rollbackkit.execute({
                name: actionName,
                actor: context.actor,
                tenantId: context.tenantId,
                idempotencyKey,
                input,
            });

            return serializeActionRun(run);
        }),
    );
}

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

export function serializeActionError(
    error: unknown,
    conflict?: DemoActionConflictDto,
): DemoActionError {
    if (isRollbackKitError(error)) {
        return {
            code: error.code,
            message: error.message,
            ...(conflict === undefined ? {} : { conflict }),
        };
    }

    if (error instanceof Error) {
        return {
            message: error.message,
            ...(conflict === undefined ? {} : { conflict }),
        };
    }

    return {
        message: 'Unknown demo action error.',
        ...(conflict === undefined ? {} : { conflict }),
    };
}
