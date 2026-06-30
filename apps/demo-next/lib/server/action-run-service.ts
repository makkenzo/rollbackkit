import 'server-only';

import {
    type DemoActionResponse,
    type DemoActionRunDto,
    runDemoAction,
    serializeActionRun,
} from './demo-action-service';
import { DEMO_ACTOR } from './demo-request-context';
import { withDemoRollbackKit } from './rollbackkit';

export async function undoDemoActionRun(
    actionRunId: string,
): Promise<DemoActionResponse<DemoActionRunDto>> {
    return runDemoAction(async () =>
        withDemoRollbackKit(async ({ rollbackkit }) => {
            const run = await rollbackkit.undo({
                actionRunId,
                actor: DEMO_ACTOR,
            });

            return serializeActionRun(run);
        }),
    );
}
