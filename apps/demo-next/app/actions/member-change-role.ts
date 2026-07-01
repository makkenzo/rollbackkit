'use server';

import { getDemoRequestContext } from '@/lib/server/demo-request-context';
import {
    executeMemberRoleChange as executeMemberRoleChangeService,
    previewMemberRoleChange as previewMemberRoleChangeService,
} from '@/lib/server/member-change-role-service';
import { revalidateDemoHome } from './revalidation';

type EditableMemberRole = 'admin' | 'viewer';

export async function previewMemberRoleChange(memberId: string, role: EditableMemberRole) {
    return previewMemberRoleChangeService(memberId, role, getDemoRequestContext());
}

export async function executeMemberRoleChange(
    memberId: string,
    role: EditableMemberRole,
    idempotencyKey: string,
) {
    const response = await executeMemberRoleChangeService(
        memberId,
        role,
        idempotencyKey,
        getDemoRequestContext(),
    );

    if (response.ok) {
        revalidateDemoHome();
    }

    return response;
}
