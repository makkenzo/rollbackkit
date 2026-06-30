'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { executeMemberRoleChange, previewMemberRoleChange } from '../actions/member-change-role';

type DemoMemberRole = 'Owner' | 'Admin' | 'Viewer';
type EditableMemberRole = 'admin' | 'viewer';

interface MemberRoleChangeControlProps {
    readonly memberId: string;
    readonly memberName: string;
    readonly role: DemoMemberRole;
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

interface ActionErrorState {
    readonly code?: string;
    readonly message: string;
}

export function MemberRoleChangeControl({
    memberId,
    memberName,
    role,
}: MemberRoleChangeControlProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [preview, setPreview] = useState<PreviewState | null>(null);
    const [error, setError] = useState<ActionErrorState | null>(null);

    const targetRole = getTargetRole(role);
    const isBusy = isPending;

    function openPreview() {
        const nextRole = targetRole;

        if (nextRole === null) {
            return;
        }

        setError(null);
        setPreview(null);
        setIsDialogOpen(true);

        startTransition(async () => {
            const response = await previewMemberRoleChange(memberId, nextRole);

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

    function changeRole() {
        const nextRole = targetRole;

        if (nextRole === null) {
            return;
        }

        setError(null);

        startTransition(async () => {
            const response = await executeMemberRoleChange(memberId, nextRole);

            if (!response.ok) {
                setError(response.error);
                return;
            }

            setIsDialogOpen(false);
            setPreview(null);
            router.refresh();
        });
    }

    return (
        <div className="project-action-cell">
            <button
                className="button secondary"
                disabled={targetRole === null || isBusy}
                type="button"
                onClick={openPreview}
            >
                {targetRole === null ? 'Owner' : `Make ${formatEditableRole(targetRole)}`}
            </button>

            {isDialogOpen ? (
                <div className="dialog-backdrop" role="presentation">
                    <div
                        aria-labelledby="member-role-dialog-title"
                        aria-modal="true"
                        className="dialog"
                        role="dialog"
                    >
                        <div className="dialog-header">
                            <div>
                                <p className="dialog-kicker">Action preview</p>
                                <h2 id="member-role-dialog-title">
                                    {preview?.title ?? `Change ${memberName} role`}
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
                                disabled={preview === null || isBusy || targetRole === null}
                                type="button"
                                onClick={changeRole}
                            >
                                Change role
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

function getTargetRole(role: DemoMemberRole): EditableMemberRole | null {
    switch (role) {
        case 'Admin':
            return 'viewer';
        case 'Viewer':
            return 'admin';
        case 'Owner':
            return null;
    }
}

function formatEditableRole(role: EditableMemberRole): string {
    switch (role) {
        case 'admin':
            return 'Admin';
        case 'viewer':
            return 'Viewer';
    }
}
