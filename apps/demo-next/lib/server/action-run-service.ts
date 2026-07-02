import 'server-only';

import { RollbackKitError } from '@rollbackkit/core';
import { getLatestDemoActionConflict } from './conflict-summary';
import {
    type DemoActionResponse,
    type DemoActionRunDto,
    serializeActionError,
    serializeActionRun,
} from './demo-action-service';
import type { DemoRequestContext } from './demo-request-context';
import { withDemoRollbackKit } from './rollbackkit';

export async function undoDemoActionRun(
    actionRunId: string,
    context: DemoRequestContext,
): Promise<DemoActionResponse<DemoActionRunDto>> {
    return withDemoRollbackKit(async ({ rollbackkit }) => {
        try {
            const existingRun = await rollbackkit.getActionRun(actionRunId);

            if (existingRun !== null && existingRun.tenantId !== context.tenantId) {
                throw new RollbackKitError({
                    code: 'ACTION_PERMISSION_DENIED',
                    message: `Action run "${actionRunId}" does not belong to the current demo tenant.`,
                    details: {
                        actionRunId,
                        tenantId: context.tenantId,
                        ...(existingRun.tenantId === undefined
                            ? {}
                            : { actionRunTenantId: existingRun.tenantId }),
                    },
                });
            }

            const run = await rollbackkit.undo({
                actionRunId,
                actor: context.actor,
                tenantId: context.tenantId,
            });

            return {
                ok: true,
                data: serializeActionRun(run),
            };
        } catch (error) {
            const conflict = getLatestDemoActionConflict(
                await rollbackkit.getConflicts(actionRunId),
            );

            return {
                ok: false,
                error: serializeActionError(error, conflict),
            };
        }
    });
}
