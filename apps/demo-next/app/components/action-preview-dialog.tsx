'use client';

import type { PreviewResult } from '@rollbackkit/core';

export interface ActionPreviewError {
    readonly code?: string;
    readonly message: string;
}

interface ActionPreviewDialogProps {
    readonly id: string;
    readonly fallbackTitle: string;
    readonly preview: PreviewResult | null;
    readonly error: ActionPreviewError | null;
    readonly isBusy: boolean;
    readonly confirmLabel: string;
    readonly confirmDisabled?: boolean;
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
}

export function ActionPreviewDialog({
    id,
    fallbackTitle,
    preview,
    error,
    isBusy,
    confirmLabel,
    confirmDisabled = false,
    onCancel,
    onConfirm,
}: ActionPreviewDialogProps) {
    const titleId = `${id}-title`;

    return (
        <div className="dialog-backdrop" role="presentation">
            <div aria-labelledby={titleId} aria-modal="true" className="dialog" role="dialog">
                <div className="dialog-header">
                    <div>
                        <p className="dialog-kicker">Action preview</p>
                        <h2 id={titleId}>{preview?.title ?? fallbackTitle}</h2>
                    </div>

                    <button
                        aria-label="Close dialog"
                        className="icon-button"
                        disabled={isBusy}
                        type="button"
                        onClick={onCancel}
                    >
                        &times;
                    </button>
                </div>

                {preview === null && error === null ? (
                    <p className="dialog-muted">Preparing preview...</p>
                ) : null}

                {preview === null ? null : (
                    <>
                        {preview.summary === undefined ? null : (
                            <p className="dialog-summary">{preview.summary}</p>
                        )}

                        <div className="preview-impact-list">
                            {preview.impact.map((impact) => (
                                <div
                                    className="preview-impact-item"
                                    key={impact.id ?? impact.label}
                                >
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
                )}

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
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        className="button danger"
                        disabled={preview === null || isBusy || confirmDisabled}
                        type="button"
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
