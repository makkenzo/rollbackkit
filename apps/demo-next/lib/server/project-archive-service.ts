import 'server-only';

import type { PreviewResult } from '@rollbackkit/core';

import { PROJECT_ARCHIVE_ACTION_NAME } from './actions/project-archive.action';
import {
    type DemoActionResponse,
    type DemoActionRunDto,
    executeDemoAction,
    previewDemoAction,
} from './demo-action-service';
import type { DemoRequestContext } from './demo-request-context';

export async function previewProjectArchive(
    projectId: string,
    context: DemoRequestContext,
): Promise<DemoActionResponse<PreviewResult>> {
    return previewDemoAction(
        PROJECT_ARCHIVE_ACTION_NAME,
        {
            workspaceId: context.workspaceId,
            projectId,
        },
        context,
    );
}

export async function executeProjectArchive(
    projectId: string,
    idempotencyKey: string,
    context: DemoRequestContext,
): Promise<DemoActionResponse<DemoActionRunDto>> {
    return executeDemoAction(
        PROJECT_ARCHIVE_ACTION_NAME,
        {
            workspaceId: context.workspaceId,
            projectId,
        },
        idempotencyKey,
        context,
    );
}
