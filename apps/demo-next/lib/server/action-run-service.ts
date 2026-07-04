import 'server-only';

import { isRollbackKitError, RollbackKitError } from '@rollbackkit/core';
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
                return {
                    ok: false,
                    error: serializeActionError(createTenantDeniedError()),
                };
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
            const conflict =
                isRollbackKitError(error) && error.code === 'ACTION_PERMISSION_DENIED'
                    ? undefined
                    : getLatestDemoActionConflict(await rollbackkit.getConflicts(actionRunId));

            return {
                ok: false,
                error: serializeActionError(error, conflict),
            };
        }
    });
}

function createTenantDeniedError(): RollbackKitError {
    return new RollbackKitError({
        code: 'ACTION_PERMISSION_DENIED',
        message: 'Action run cannot be undone in the current demo tenant.',
    });
}
