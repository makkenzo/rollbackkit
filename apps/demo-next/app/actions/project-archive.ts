'use server';

import { getDemoRequestContext } from '@/lib/server/demo-request-context';
import {
    executeProjectArchive as executeProjectArchiveService,
    previewProjectArchive as previewProjectArchiveService,
} from '@/lib/server/project-archive-service';
import { revalidateDemoHome } from './revalidation';

export async function previewProjectArchive(projectId: string) {
    return previewProjectArchiveService(projectId, getDemoRequestContext());
}

export async function executeProjectArchive(projectId: string, idempotencyKey: string) {
    const response = await executeProjectArchiveService(
        projectId,
        idempotencyKey,
        getDemoRequestContext(),
    );

    if (response.ok) {
        revalidateDemoHome();
    }

    return response;
}
