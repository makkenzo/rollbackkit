'use server';

import {
    executeProjectArchive as executeProjectArchiveService,
    previewProjectArchive as previewProjectArchiveService,
    undoDemoActionRun as undoDemoActionRunService,
} from '../../lib/server/project-archive-service';

export async function previewProjectArchive(projectId: string) {
    return previewProjectArchiveService(projectId);
}

export async function executeProjectArchive(projectId: string) {
    return executeProjectArchiveService(projectId);
}

export async function undoDemoActionRun(actionRunId: string) {
    return undoDemoActionRunService(actionRunId);
}
