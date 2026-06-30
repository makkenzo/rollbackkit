import 'server-only';

import type { PreviewResult } from '@rollbackkit/core';

import { MEMBER_REMOVE_ACTION_NAME } from './actions/member-remove';
import {
    DEMO_ACTOR,
    DEMO_TENANT_ID,
    type DemoActionResponse,
    type DemoActionRunDto,
    runDemoAction,
    serializeActionRun,
} from './demo-action-service';
import { withDemoRollbackKit } from './rollbackkit';

export async function previewMemberRemove(
    memberId: string,
): Promise<DemoActionResponse<PreviewResult>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) =>
            rollbackkit.preview({
                name: MEMBER_REMOVE_ACTION_NAME,
                actor: DEMO_ACTOR,
                tenantId: DEMO_TENANT_ID,
                input: {
                    memberId,
                },
            }),
        ),
    );
}

export async function executeMemberRemove(
    memberId: string,
): Promise<DemoActionResponse<DemoActionRunDto>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) => {
            const run = await rollbackkit.execute({
                name: MEMBER_REMOVE_ACTION_NAME,
                actor: DEMO_ACTOR,
                tenantId: DEMO_TENANT_ID,
                input: {
                    memberId,
                },
            });

            return serializeActionRun(run);
        }),
    );
}
