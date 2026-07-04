'use server';

import type { DemoActionRunDto } from '@/lib/demo-action-types';
import { PROJECT_ARCHIVE_ACTION_NAME } from '@/lib/server/actions/project-archive.action';
import { executeDemoAction, previewDemoAction } from '@/lib/server/demo-action-service';
import {
    createDemoMutationDeniedResponse,
    isDemoMutationAllowed,
} from '@/lib/server/demo-mutation-guard';
import { getDemoRequestContext } from '@/lib/server/demo-request-context';
import { revalidateDemoHome } from './revalidation';

export async function previewProjectArchive(projectId: string) {
    const context = getDemoRequestContext();

    return previewDemoAction(
        PROJECT_ARCHIVE_ACTION_NAME,
        {
            workspaceId: context.workspaceId,
            projectId,
        },
        context,
    );
}

export async function executeProjectArchive(projectId: string, idempotencyKey: string) {
    if (!isDemoMutationAllowed()) {
        return createDemoMutationDeniedResponse<DemoActionRunDto>();
    }

    const context = getDemoRequestContext();
    const response = await executeDemoAction(
        PROJECT_ARCHIVE_ACTION_NAME,
        {
            workspaceId: context.workspaceId,
            projectId,
        },
        idempotencyKey,
        context,
    );

    if (response.ok) {
        revalidateDemoHome();
    }

    return response;
}
