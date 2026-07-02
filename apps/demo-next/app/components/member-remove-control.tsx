'use client';

import type { DemoMemberRole } from '@/lib/demo/view-models';
import { executeMemberRemove, previewMemberRemove } from '../actions/member-remove';
import { ActionPreviewDialog } from './action-preview-dialog';
import { createDemoIdempotencyKey } from './demo-idempotency-key';
import { usePreviewableDemoAction } from './use-previewable-demo-action';

interface MemberRemoveControlProps {
    readonly memberId: string;
    readonly memberName: string;
    readonly role: DemoMemberRole;
}

export function MemberRemoveControl({ memberId, memberName, role }: MemberRemoveControlProps) {
    const isOwner = role === 'owner';
    const action = usePreviewableDemoAction({
        createIdempotencyKey: () => createDemoIdempotencyKey(`member.remove:${memberId}`),
        preview: () => previewMemberRemove(memberId),
        execute: (requestId) => executeMemberRemove(memberId, requestId),
    });

    return (
        <div className="project-action-cell">
            <button
                className="button secondary"
                disabled={isOwner || action.isBusy}
                type="button"
                onClick={action.openPreview}
            >
                Remove
            </button>

            {action.isDialogOpen ? (
                <ActionPreviewDialog
                    confirmLabel="Remove member"
                    error={action.error}
                    fallbackTitle={`Remove ${memberName}`}
                    id="member-remove-dialog"
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
