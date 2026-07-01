import 'server-only';

import {
    type DemoActionResponse,
    type DemoActionRunDto,
    runDemoAction,
    serializeActionRun,
} from './demo-action-service';
import type { DemoRequestContext } from './demo-request-context';
import { withDemoRollbackKit } from './rollbackkit';

export async function undoDemoActionRun(
    actionRunId: string,
    context: DemoRequestContext,
): Promise<DemoActionResponse<DemoActionRunDto>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) => {
            const run = await rollbackkit.undo({
                actionRunId,
                actor: context.actor,
            });

            return serializeActionRun(run);
        }),
    );
}
