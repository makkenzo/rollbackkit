import 'server-only';

import type { PreviewResult } from '@rollbackkit/core';

import { PROJECT_ARCHIVE_ACTION_NAME } from './actions/project-archive.action';
import {
    type DemoActionResponse,
    type DemoActionRunDto,
    runDemoAction,
    serializeActionRun,
} from './demo-action-service';
import type { DemoRequestContext } from './demo-request-context';
import { withDemoRollbackKit } from './rollbackkit';

export async function previewProjectArchive(
    projectId: string,
    context: DemoRequestContext,
): Promise<DemoActionResponse<PreviewResult>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) =>
            rollbackkit.preview({
                name: PROJECT_ARCHIVE_ACTION_NAME,
                actor: context.actor,
                tenantId: context.tenantId,
                input: {
                    workspaceId: context.workspaceId,
                    projectId,
                },
            }),
        ),
    );
}

export async function executeProjectArchive(
    projectId: string,
    idempotencyKey: string,
    context: DemoRequestContext,
): Promise<DemoActionResponse<DemoActionRunDto>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) => {
            const run = await rollbackkit.execute({
                name: PROJECT_ARCHIVE_ACTION_NAME,
                actor: context.actor,
                tenantId: context.tenantId,
                idempotencyKey,
                input: {
                    workspaceId: context.workspaceId,
                    projectId,
                },
            });

            return serializeActionRun(run);
        }),
    );
}
