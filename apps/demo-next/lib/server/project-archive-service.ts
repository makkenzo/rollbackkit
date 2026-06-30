import 'server-only';

import {
    type ActionActor,
    type ActionRun,
    isRollbackKitError,
    type JsonObject,
    type JsonValue,
    type PreviewResult,
} from '@rollbackkit/core';

import { PROJECT_ARCHIVE_ACTION_NAME } from './actions/project-archive';
import { withDemoRollbackKit } from './rollbackkit';

const DEMO_TENANT_ID = 'workspace_acme';

const DEMO_ACTOR: ActionActor = {
    id: 'member_ada',
    type: 'user',
    displayName: 'Ada Lovelace',
};

export type DemoActionResponse<TData> =
    | {
          readonly ok: true;
          readonly data: TData;
      }
    | {
          readonly ok: false;
          readonly error: DemoActionError;
      };

export interface DemoActionError {
    readonly code?: string;
    readonly message: string;
    readonly details?: JsonObject;
}

export interface DemoActionRunDto {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly createdAt: string;
    readonly actor: ActionActor;
    readonly tenantId?: string;
    readonly target?: {
        readonly id: string;
        readonly type: string;
        readonly label?: string;
        readonly metadata?: JsonObject;
    };
    readonly executedAt?: string;
    readonly undoExpiresAt?: string;
    readonly undoStartedAt?: string;
    readonly undoneAt?: string;
    readonly undoneBy?: ActionActor;
    readonly result?: JsonValue;
    readonly undoResult?: JsonValue;
    readonly error?: {
        readonly code: string;
        readonly message: string;
        readonly details?: JsonObject;
    };
    readonly metadata?: JsonObject;
}

export async function previewProjectArchive(
    projectId: string,
): Promise<DemoActionResponse<PreviewResult>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) =>
            rollbackkit.preview({
                name: PROJECT_ARCHIVE_ACTION_NAME,
                actor: DEMO_ACTOR,
                tenantId: DEMO_TENANT_ID,
                input: {
                    projectId,
                },
            }),
        ),
    );
}

export async function executeProjectArchive(
    projectId: string,
): Promise<DemoActionResponse<DemoActionRunDto>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) => {
            const run = await rollbackkit.execute({
                name: PROJECT_ARCHIVE_ACTION_NAME,
                actor: DEMO_ACTOR,
                tenantId: DEMO_TENANT_ID,
                input: {
                    projectId,
                },
            });

            return serializeActionRun(run);
        }),
    );
}

export async function undoDemoActionRun(
    actionRunId: string,
): Promise<DemoActionResponse<DemoActionRunDto>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) => {
            const run = await rollbackkit.undo({
                actionRunId,
                actor: DEMO_ACTOR,
            });

            return serializeActionRun(run);
        }),
    );
}

async function runDemoAction<TData>(
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

function serializeActionRun(run: ActionRun): DemoActionRunDto {
    return {
        id: run.id,
        name: run.name,
        status: run.status,
        actor: run.actor,
        createdAt: run.createdAt.toISOString(),
        ...(run.tenantId === undefined ? {} : { tenantId: run.tenantId }),
        ...(run.target === undefined ? {} : { target: run.target }),
        ...(run.executedAt === undefined ? {} : { executedAt: run.executedAt.toISOString() }),
        ...(run.undoExpiresAt === undefined
            ? {}
            : { undoExpiresAt: run.undoExpiresAt.toISOString() }),
        ...(run.undoStartedAt === undefined
            ? {}
            : { undoStartedAt: run.undoStartedAt.toISOString() }),
        ...(run.undoneAt === undefined ? {} : { undoneAt: run.undoneAt.toISOString() }),
        ...(run.undoneBy === undefined ? {} : { undoneBy: run.undoneBy }),
        ...(run.result === undefined ? {} : { result: run.result }),
        ...(run.undoResult === undefined ? {} : { undoResult: run.undoResult }),
        ...(run.error === undefined ? {} : { error: run.error }),
        ...(run.metadata === undefined ? {} : { metadata: run.metadata }),
    };
}

function serializeActionError(error: unknown): DemoActionError {
    if (isRollbackKitError(error)) {
        return {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
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
