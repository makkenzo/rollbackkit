'use server';

import { MEMBER_CHANGE_ROLE_ACTION_NAME } from '@/lib/server/actions/member-change-role.action';
import { executeDemoAction, previewDemoAction } from '@/lib/server/demo-action-service';
import { getDemoRequestContext } from '@/lib/server/demo-request-context';
import { revalidateDemoHome } from './revalidation';

type EditableMemberRole = 'admin' | 'viewer';

export async function previewMemberRoleChange(memberId: string, role: EditableMemberRole) {
    const context = getDemoRequestContext();

    return previewDemoAction(
        MEMBER_CHANGE_ROLE_ACTION_NAME,
        {
            workspaceId: context.workspaceId,
            memberId,
            role,
        },
        context,
    );
}

export async function executeMemberRoleChange(
    memberId: string,
    role: EditableMemberRole,
    idempotencyKey: string,
) {
    const context = getDemoRequestContext();
    const response = await executeDemoAction(
        MEMBER_CHANGE_ROLE_ACTION_NAME,
        {
            workspaceId: context.workspaceId,
            memberId,
            role,
        },
        idempotencyKey,
        context,
    );

    if (response.ok) {
        revalidateDemoHome();
    }

    return response;
}
