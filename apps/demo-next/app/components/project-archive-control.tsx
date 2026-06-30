'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
    executeProjectArchive,
    previewProjectArchive,
    undoDemoActionRun,
} from '../actions/project-archive';

interface ProjectArchiveControlProps {
    readonly projectId: string;
    readonly projectName: string;
    readonly status: 'Active' | 'Archived';
}

interface PreviewState {
    readonly title: string;
    readonly summary?: string;
    readonly impact: readonly {
        readonly label: string;
        readonly description?: string;
        readonly severity?: 'info' | 'warning' | 'danger';
    }[];
    readonly warnings?: readonly string[];
}

interface ActionRunState {
    readonly id: string;
    readonly status: string;
}

interface ActionErrorState {
    readonly code?: string;
    readonly message: string;
}

export function ProjectArchiveControl({
    projectId,
    projectName,
    status,
}: ProjectArchiveControlProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [preview, setPreview] = useState<PreviewState | null>(null);
    const [lastRun, setLastRun] = useState<ActionRunState | null>(null);
    const [error, setError] = useState<ActionErrorState | null>(null);

    const isArchived = status === 'Archived';
    const isBusy = isPending;

    function openPreview() {
        setError(null);
        setPreview(null);
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
    }

    function archiveProject() {
        setError(null);

        startTransition(async () => {
            const response = await executeProjectArchive(projectId);

            if (!response.ok) {
                setError(response.error);
                return;
            }

            setLastRun({
                id: response.data.id,
                status: response.data.status,
            });

            setIsDialogOpen(false);
            setPreview(null);
            router.refresh();
        });
    }

    function undoProjectArchive() {
        const actionRunId = lastRun?.id;

        if (actionRunId === undefined) {
            return;
        }

        setError(null);

        startTransition(async () => {
            const response = await undoDemoActionRun(actionRunId);

            if (!response.ok) {
                setError(response.error);
                return;
            }

            setLastRun(null);
            router.refresh();
        });
    }

    return (
        <div className="project-action-cell">
            {lastRun === null ? (
                <button
                    className="button secondary"
                    disabled={isArchived || isBusy}
                    type="button"
                    onClick={openPreview}
                >
                    {isArchived ? 'Archived' : 'Archive'}
                </button>
            ) : (
                <div className="inline-action-result" role="status">
                    <span>Project archived</span>
                    <button
                        className="button ghost"
                        disabled={isBusy}
                        type="button"
                        onClick={undoProjectArchive}
                    >
                        Undo
                    </button>
                </div>
            )}

            {isDialogOpen ? (
                <div className="dialog-backdrop" role="presentation">
                    <div
                        aria-labelledby="project-archive-dialog-title"
                        aria-modal="true"
                        className="dialog"
                        role="dialog"
                    >
                        <div className="dialog-header">
                            <div>
                                <p className="dialog-kicker">Action preview</p>
                                <h2 id="project-archive-dialog-title">
                                    {preview?.title ?? `Archive ${projectName}`}
                                </h2>
                            </div>

                            <button
                                aria-label="Close dialog"
                                className="icon-button"
                                disabled={isBusy}
                                type="button"
                                onClick={closeDialog}
                            >
                                ×
                            </button>
                        </div>

                        {preview === null && error === null ? (
                            <p className="dialog-muted">Preparing preview…</p>
                        ) : null}

                        {preview !== null ? (
                            <>
                                {preview.summary === undefined ? null : (
                                    <p className="dialog-summary">{preview.summary}</p>
                                )}

                                <div className="preview-impact-list">
                                    {preview.impact.map((impact) => (
                                        <div className="preview-impact-item" key={impact.label}>
                                            <span
                                                aria-hidden="true"
                                                className={`preview-impact-dot ${
                                                    impact.severity ?? 'info'
                                                }`}
                                            />
                                            <div>
                                                <strong>{impact.label}</strong>
                                                {impact.description === undefined ? null : (
                                                    <p>{impact.description}</p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {preview.warnings === undefined ? null : (
                                    <div className="warning-box">
                                        {preview.warnings.map((warning) => (
                                            <p key={warning}>{warning}</p>
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : null}

                        {error === null ? null : (
                            <div className="error-box" role="alert">
                                <strong>Action failed</strong>
                                <p>{error.message}</p>
                            </div>
                        )}

                        <div className="dialog-actions">
                            <button
                                className="button secondary"
                                disabled={isBusy}
                                type="button"
                                onClick={closeDialog}
                            >
                                Cancel
                            </button>
                            <button
                                className="button danger"
                                disabled={preview === null || isBusy}
                                type="button"
                                onClick={archiveProject}
                            >
                                Archive project
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {error !== null && !isDialogOpen ? (
                <p className="inline-error" role="alert">
                    {error.message}
                </p>
            ) : null}
        </div>
    );
}
