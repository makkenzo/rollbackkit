'use client';

import type { PreviewResult } from '@rollbackkit/core';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { executeProjectArchive, previewProjectArchive } from '../actions/project-archive';
import { ActionPreviewDialog, type ActionPreviewError } from './action-preview-dialog';
import { createDemoIdempotencyKey } from './demo-idempotency-key';

interface ProjectArchiveControlProps {
    readonly projectId: string;
    readonly projectName: string;
    readonly status: 'Active' | 'Archived';
}

export function ProjectArchiveControl({
    projectId,
    projectName,
    status,
}: ProjectArchiveControlProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [error, setError] = useState<ActionPreviewError | null>(null);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

    const isArchived = status === 'Archived';
    const isBusy = isPending;

    function openPreview() {
        setError(null);
        setPreview(null);
        setIdempotencyKey(createDemoIdempotencyKey(`project.archive:${projectId}`));
        setIsDialogOpen(true);

        startTransition(async () => {
            const response = await previewProjectArchive(projectId);

            if (!response.ok) {
                setError(response.error);
                return;
            }

            setPreview(response.data);
        });
    }

    function closeDialog() {
        if (isBusy) {
            return;
        }

        setIsDialogOpen(false);
        setPreview(null);
        setError(null);
        setIdempotencyKey(null);
    }

    function archiveProject() {
        setError(null);

        startTransition(async () => {
            const requestId =
                idempotencyKey ?? createDemoIdempotencyKey(`project.archive:${projectId}`);

            setIdempotencyKey(requestId);

            const response = await executeProjectArchive(projectId, requestId);

            if (!response.ok) {
                setError(response.error);
                return;
            }

            setIsDialogOpen(false);
            setPreview(null);
            setIdempotencyKey(null);
            router.refresh();
        });
    }

    return (
        <div className="project-action-cell">
            <button
                className="button secondary"
                disabled={isArchived || isBusy}
                type="button"
                onClick={openPreview}
            >
                {isArchived ? 'Archived' : 'Archive'}
            </button>

            {isDialogOpen ? (
                <ActionPreviewDialog
                    confirmLabel="Archive project"
                    error={error}
                    fallbackTitle={`Archive ${projectName}`}
                    id="project-archive-dialog"
                    isBusy={isBusy}
                    preview={preview}
                    onCancel={closeDialog}
                    onConfirm={archiveProject}
                />
            ) : null}

            {error !== null && !isDialogOpen ? (
                <p className="inline-error" role="alert">
                    {error.message}
                </p>
            ) : null}
        </div>
    );
}
