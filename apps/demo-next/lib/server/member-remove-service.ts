import 'server-only';

import type { PreviewResult } from '@rollbackkit/core';

import { MEMBER_REMOVE_ACTION_NAME } from './actions/member-remove.action';
import {
    type DemoActionResponse,
    type DemoActionRunDto,
    executeDemoAction,
    previewDemoAction,
} from './demo-action-service';
import type { DemoRequestContext } from './demo-request-context';

export async function previewMemberRemove(
    memberId: string,
    context: DemoRequestContext,
): Promise<DemoActionResponse<PreviewResult>> {
    return previewDemoAction(
        MEMBER_REMOVE_ACTION_NAME,
        {
            workspaceId: context.workspaceId,
            memberId,
        },
        context,
    );
}

export async function executeMemberRemove(
    memberId: string,
    idempotencyKey: string,
    context: DemoRequestContext,
): Promise<DemoActionResponse<DemoActionRunDto>> {
    return executeDemoAction(
        MEMBER_REMOVE_ACTION_NAME,
        {
            workspaceId: context.workspaceId,
            memberId,
        },
        idempotencyKey,
        context,
    );
}
