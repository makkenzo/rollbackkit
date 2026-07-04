'use server';

import type { DemoActionRunDto } from '@/lib/demo-action-types';
import { MEMBER_REMOVE_ACTION_NAME } from '@/lib/server/actions/member-remove.action';
import { executeDemoAction, previewDemoAction } from '@/lib/server/demo-action-service';
import {
    createDemoMutationDeniedResponse,
    isDemoMutationAllowed,
} from '@/lib/server/demo-mutation-guard';
import { getDemoRequestContext } from '@/lib/server/demo-request-context';
import { revalidateDemoHome } from './revalidation';

export async function previewMemberRemove(memberId: string) {
    const context = getDemoRequestContext();

    return previewDemoAction(
        MEMBER_REMOVE_ACTION_NAME,
        {
            workspaceId: context.workspaceId,
            memberId,
        },
        context,
    );
}

export async function executeMemberRemove(memberId: string, idempotencyKey: string) {
    if (!isDemoMutationAllowed()) {
        return createDemoMutationDeniedResponse<DemoActionRunDto>();
    }

    const context = getDemoRequestContext();
    const response = await executeDemoAction(
        MEMBER_REMOVE_ACTION_NAME,
        {
            workspaceId: context.workspaceId,
            memberId,
        },
        idempotencyKey,
        context,
    );

    if (response.ok) {
        revalidateDemoHome();
    }

    return response;
}
