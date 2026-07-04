'use server';

import type { DemoActionRunDto } from '../../lib/demo-action-types';
import { undoDemoActionRun as undoDemoActionRunService } from '../../lib/server/action-run-service';
import {
    createDemoMutationDeniedResponse,
    isDemoMutationAllowed,
} from '../../lib/server/demo-mutation-guard';
import { getDemoRequestContext } from '../../lib/server/demo-request-context';
import { revalidateDemoHome } from './revalidation';

export async function undoDemoActionRun(actionRunId: string) {
    if (!isDemoMutationAllowed()) {
        return createDemoMutationDeniedResponse<DemoActionRunDto>();
    }

    const response = await undoDemoActionRunService(actionRunId, getDemoRequestContext());

    if (response.ok || response.error.conflict !== undefined) {
        revalidateDemoHome();
    }

    return response;
}
