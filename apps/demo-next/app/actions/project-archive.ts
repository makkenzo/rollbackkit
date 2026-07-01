'use server';

import {
    executeProjectArchive as executeProjectArchiveService,
    previewProjectArchive as previewProjectArchiveService,
} from '@/lib/server/project-archive-service';

export async function previewProjectArchive(projectId: string) {
    return previewProjectArchiveService(projectId);
}

export async function executeProjectArchive(projectId: string, idempotencyKey: string) {
    return executeProjectArchiveService(projectId, idempotencyKey);
}
