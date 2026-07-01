'use server';

import {
    executeMemberRemove as executeMemberRemoveService,
    previewMemberRemove as previewMemberRemoveService,
} from '@/lib/server/member-remove-service';

export async function previewMemberRemove(memberId: string) {
    return previewMemberRemoveService(memberId);
}

export async function executeMemberRemove(memberId: string, idempotencyKey: string) {
    return executeMemberRemoveService(memberId, idempotencyKey);
}
