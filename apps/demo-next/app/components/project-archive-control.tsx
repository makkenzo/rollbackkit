'use client';

import type { DemoProjectStatus } from '@/lib/demo/view-models';
import { executeProjectArchive, previewProjectArchive } from '../actions/project-archive';
import { ActionPreviewDialog } from './action-preview-dialog';
import { createDemoIdempotencyKey } from './demo-idempotency-key';
import { usePreviewableDemoAction } from './use-previewable-demo-action';

interface ProjectArchiveControlProps {
    readonly projectId: string;
    readonly projectName: string;
    readonly status: DemoProjectStatus;
}

export function ProjectArchiveControl({
    projectId,
    projectName,
    status,
}: ProjectArchiveControlProps) {
    const isArchived = status === 'archived';
    const action = usePreviewableDemoAction({
        createIdempotencyKey: () => createDemoIdempotencyKey(`project.archive:${projectId}`),
        preview: () => previewProjectArchive(projectId),
        execute: (requestId) => executeProjectArchive(projectId, requestId),
    });

    return (
        <div className="project-action-cell">
            <button
                className="button secondary"
                disabled={isArchived || action.isBusy}
                type="button"
                onClick={action.openPreview}
            >
                {isArchived ? 'Archived' : 'Archive'}
            </button>

            {action.isDialogOpen ? (
                <ActionPreviewDialog
                    confirmLabel="Archive project"
                    error={action.error}
                    fallbackTitle={`Archive ${projectName}`}
                    id="project-archive-dialog"
                    isBusy={action.isBusy}
                    preview={action.preview}
                    onCancel={action.closeDialog}
                    onConfirm={action.confirm}
                />
            ) : null}

            {action.error !== null && !action.isDialogOpen ? (
                <p className="inline-error" role="alert">
                    {action.error.message}
                </p>
            ) : null}
        </div>
    );
}
