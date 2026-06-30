'use server';

import { undoDemoActionRun as undoDemoActionRunService } from '../../lib/server/action-run-service';

export async function undoDemoActionRun(actionRunId: string) {
    return undoDemoActionRunService(actionRunId);
}
