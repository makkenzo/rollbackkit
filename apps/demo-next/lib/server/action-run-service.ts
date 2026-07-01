import 'server-only';

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
            const run = await rollbackkit.undo({
                actionRunId,
                actor: context.actor,
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
