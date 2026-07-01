'use client';

import type { PreviewResult } from '@rollbackkit/core';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { executeMemberRemove, previewMemberRemove } from '../actions/member-remove';
import { ActionPreviewDialog, type ActionPreviewError } from './action-preview-dialog';
import { createDemoIdempotencyKey } from './demo-idempotency-key';

type DemoMemberRole = 'Owner' | 'Admin' | 'Viewer';

interface MemberRemoveControlProps {
    readonly memberId: string;
    readonly memberName: string;
    readonly role: DemoMemberRole;
}

export function MemberRemoveControl({ memberId, memberName, role }: MemberRemoveControlProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [error, setError] = useState<ActionPreviewError | null>(null);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

    const isOwner = role === 'Owner';
    const isBusy = isPending;

    function openPreview() {
        setError(null);
        setPreview(null);
        setIdempotencyKey(createDemoIdempotencyKey(`member.remove:${memberId}`));
        setIsDialogOpen(true);

        startTransition(async () => {
            const response = await previewMemberRemove(memberId);

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

    function removeMember() {
        setError(null);

        startTransition(async () => {
            const requestId =
                idempotencyKey ?? createDemoIdempotencyKey(`member.remove:${memberId}`);

            setIdempotencyKey(requestId);

            const response = await executeMemberRemove(memberId, requestId);

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
                disabled={isOwner || isBusy}
                type="button"
                onClick={openPreview}
            >
                Remove
            </button>

            {isDialogOpen ? (
                <ActionPreviewDialog
                    confirmLabel="Remove member"
                    error={error}
                    fallbackTitle={`Remove ${memberName}`}
                    id="member-remove-dialog"
                    isBusy={isBusy}
                    preview={preview}
                    onCancel={closeDialog}
                    onConfirm={removeMember}
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
