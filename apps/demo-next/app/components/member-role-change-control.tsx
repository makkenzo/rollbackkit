'use client';

import type { PreviewResult } from '@rollbackkit/core';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { executeMemberRoleChange, previewMemberRoleChange } from '../actions/member-change-role';
import { ActionPreviewDialog, type ActionPreviewError } from './action-preview-dialog';
import { createDemoIdempotencyKey } from './demo-idempotency-key';

type DemoMemberRole = 'Owner' | 'Admin' | 'Viewer';
type EditableMemberRole = 'admin' | 'viewer';

interface MemberRoleChangeControlProps {
    readonly memberId: string;
    readonly memberName: string;
    readonly role: DemoMemberRole;
}

export function MemberRoleChangeControl({
    memberId,
    memberName,
    role,
}: MemberRoleChangeControlProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [error, setError] = useState<ActionPreviewError | null>(null);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

    const targetRole = getTargetRole(role);
    const isBusy = isPending;

    function openPreview() {
        const nextRole = targetRole;

        if (nextRole === null) {
            return;
        }

        setError(null);
        setPreview(null);
        setIdempotencyKey(createDemoIdempotencyKey(`member.change_role:${memberId}:${nextRole}`));
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
        setIdempotencyKey(null);
    }

    function changeRole() {
        const nextRole = targetRole;

        if (nextRole === null) {
            return;
        }

        setError(null);

        startTransition(async () => {
            const requestId =
                idempotencyKey ??
                createDemoIdempotencyKey(`member.change_role:${memberId}:${nextRole}`);

            setIdempotencyKey(requestId);

            const response = await executeMemberRoleChange(memberId, nextRole, requestId);

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
                disabled={targetRole === null || isBusy}
                type="button"
                onClick={openPreview}
            >
                {targetRole === null ? 'Owner' : `Make ${formatEditableRole(targetRole)}`}
            </button>

            {isDialogOpen ? (
                <ActionPreviewDialog
                    confirmDisabled={targetRole === null}
                    confirmLabel="Change role"
                    error={error}
                    fallbackTitle={`Change ${memberName} role`}
                    id="member-role-dialog"
                    isBusy={isBusy}
                    preview={preview}
                    onCancel={closeDialog}
                    onConfirm={changeRole}
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
