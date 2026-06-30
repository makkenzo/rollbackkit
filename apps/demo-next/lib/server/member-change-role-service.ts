import 'server-only';

import type { PreviewResult } from '@rollbackkit/core';

import { MEMBER_CHANGE_ROLE_ACTION_NAME } from './actions/member-change-role.action';
import {
    type DemoActionResponse,
    type DemoActionRunDto,
    runDemoAction,
    serializeActionRun,
} from './demo-action-service';
import { DEMO_ACTOR, DEMO_TENANT_ID } from './demo-request-context';
import { withDemoRollbackKit } from './rollbackkit';

type EditableMemberRole = 'admin' | 'viewer';

export async function previewMemberRoleChange(
    memberId: string,
    role: EditableMemberRole,
): Promise<DemoActionResponse<PreviewResult>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) =>
            rollbackkit.preview({
                name: MEMBER_CHANGE_ROLE_ACTION_NAME,
                actor: DEMO_ACTOR,
                tenantId: DEMO_TENANT_ID,
                input: {
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
): Promise<DemoActionResponse<DemoActionRunDto>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) => {
            const run = await rollbackkit.execute({
                name: MEMBER_CHANGE_ROLE_ACTION_NAME,
                actor: DEMO_ACTOR,
                tenantId: DEMO_TENANT_ID,
                idempotencyKey,
                input: {
                    memberId,
                    role,
                },
            });

            return serializeActionRun(run);
        }),
    );
}
