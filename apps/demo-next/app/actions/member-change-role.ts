'use server';

import {
    executeMemberRoleChange as executeMemberRoleChangeService,
    previewMemberRoleChange as previewMemberRoleChangeService,
} from '@/lib/server/member-change-role-service';

type EditableMemberRole = 'admin' | 'viewer';

export async function previewMemberRoleChange(memberId: string, role: EditableMemberRole) {
    return previewMemberRoleChangeService(memberId, role);
}

export async function executeMemberRoleChange(
    memberId: string,
    role: EditableMemberRole,
    idempotencyKey: string,
) {
    return executeMemberRoleChangeService(memberId, role, idempotencyKey);
}
