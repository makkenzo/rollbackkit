'use server';

import { getDemoRequestContext } from '@/lib/server/demo-request-context';
import {
    executeMemberRemove as executeMemberRemoveService,
    previewMemberRemove as previewMemberRemoveService,
} from '@/lib/server/member-remove-service';
import { revalidateDemoHome } from './revalidation';

export async function previewMemberRemove(memberId: string) {
    return previewMemberRemoveService(memberId, getDemoRequestContext());
}

export async function executeMemberRemove(memberId: string, idempotencyKey: string) {
    const response = await executeMemberRemoveService(
        memberId,
        idempotencyKey,
        getDemoRequestContext(),
    );

    if (response.ok) {
        revalidateDemoHome();
    }

    return response;
}
