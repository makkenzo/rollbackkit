import 'server-only';

import type { PreviewResult } from '@rollbackkit/core';

import { MEMBER_CHANGE_ROLE_ACTION_NAME } from './actions/member-change-role.action';
import {
    type DemoActionResponse,
    type DemoActionRunDto,
    runDemoAction,
    serializeActionRun,
} from './demo-action-service';
import type { DemoRequestContext } from './demo-request-context';
import { withDemoRollbackKit } from './rollbackkit';

type EditableMemberRole = 'admin' | 'viewer';

export async function previewMemberRoleChange(
    memberId: string,
    role: EditableMemberRole,
    context: DemoRequestContext,
): Promise<DemoActionResponse<PreviewResult>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) =>
            rollbackkit.preview({
                name: MEMBER_CHANGE_ROLE_ACTION_NAME,
                actor: context.actor,
                tenantId: context.tenantId,
                input: {
                    workspaceId: context.workspaceId,
                    memberId,
                    role,
                },
            }),
        ),
    );
}

export async function executeMemberRoleChange(
    memberId: string,
    role: EditableMemberRole,
    idempotencyKey: string,
    context: DemoRequestContext,
): Promise<DemoActionResponse<DemoActionRunDto>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) => {
            const run = await rollbackkit.execute({
                name: MEMBER_CHANGE_ROLE_ACTION_NAME,
                actor: context.actor,
                tenantId: context.tenantId,
                idempotencyKey,
                input: {
                    workspaceId: context.workspaceId,
                    memberId,
                    role,
                },
            });

            return serializeActionRun(run);
        }),
    );
}
