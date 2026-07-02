import 'server-only';

import type { PreviewResult } from '@rollbackkit/core';

import { MEMBER_CHANGE_ROLE_ACTION_NAME } from './actions/member-change-role.action';
import {
    type DemoActionResponse,
    type DemoActionRunDto,
    executeDemoAction,
    previewDemoAction,
} from './demo-action-service';
import type { DemoRequestContext } from './demo-request-context';

type EditableMemberRole = 'admin' | 'viewer';

export async function previewMemberRoleChange(
    memberId: string,
    role: EditableMemberRole,
    context: DemoRequestContext,
): Promise<DemoActionResponse<PreviewResult>> {
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
    context: DemoRequestContext,
): Promise<DemoActionResponse<DemoActionRunDto>> {
    return executeDemoAction(
        MEMBER_CHANGE_ROLE_ACTION_NAME,
        {
            workspaceId: context.workspaceId,
            memberId,
            role,
        },
        idempotencyKey,
        context,
    );
}
