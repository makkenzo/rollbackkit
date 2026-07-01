import 'server-only';

import type { PreviewResult } from '@rollbackkit/core';

import { MEMBER_REMOVE_ACTION_NAME } from './actions/member-remove.action';
import {
    type DemoActionResponse,
    type DemoActionRunDto,
    runDemoAction,
    serializeActionRun,
} from './demo-action-service';
import type { DemoRequestContext } from './demo-request-context';
import { withDemoRollbackKit } from './rollbackkit';

export async function previewMemberRemove(
    memberId: string,
    context: DemoRequestContext,
): Promise<DemoActionResponse<PreviewResult>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) =>
            rollbackkit.preview({
                name: MEMBER_REMOVE_ACTION_NAME,
                actor: context.actor,
                tenantId: context.tenantId,
                input: {
                    workspaceId: context.workspaceId,
                    memberId,
                },
            }),
        ),
    );
}

export async function executeMemberRemove(
    memberId: string,
    idempotencyKey: string,
    context: DemoRequestContext,
): Promise<DemoActionResponse<DemoActionRunDto>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) => {
            const run = await rollbackkit.execute({
                name: MEMBER_REMOVE_ACTION_NAME,
                actor: context.actor,
                tenantId: context.tenantId,
                idempotencyKey,
                input: {
                    workspaceId: context.workspaceId,
                    memberId,
                },
            });

            return serializeActionRun(run);
        }),
    );
}
