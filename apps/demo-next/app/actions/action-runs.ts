'use server';

import { undoDemoActionRun as undoDemoActionRunService } from '../../lib/server/action-run-service';
import { getDemoRequestContext } from '../../lib/server/demo-request-context';
import { revalidateDemoHome } from './revalidation';

export async function undoDemoActionRun(actionRunId: string) {
    const response = await undoDemoActionRunService(actionRunId, getDemoRequestContext());

    if (response.ok || response.error.conflict !== undefined) {
        revalidateDemoHome();
    }

    return response;
}
