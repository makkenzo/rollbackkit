'use client';

import type { DemoEditableMemberRole, DemoMemberRole } from '@/lib/demo/view-models';
import { executeMemberRoleChange, previewMemberRoleChange } from '../actions/member-change-role';
import { ActionPreviewDialog } from './action-preview-dialog';
import { createDemoIdempotencyKey } from './demo-idempotency-key';
import { usePreviewableDemoAction } from './use-previewable-demo-action';

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
    const targetRole = getTargetRole(role);
    const action = usePreviewableDemoAction({
        createIdempotencyKey: () =>
            createDemoIdempotencyKey(`member.change_role:${memberId}:${targetRole ?? 'none'}`),
        preview: () =>
            targetRole === null
                ? Promise.resolve({
                      ok: false,
                      error: {
                          message: 'Owner role cannot be changed.',
                      },
                  })
                : previewMemberRoleChange(memberId, targetRole),
        execute: (requestId) =>
            targetRole === null
                ? Promise.resolve({
                      ok: false,
                      error: {
                          message: 'Owner role cannot be changed.',
                      },
                  })
                : executeMemberRoleChange(memberId, targetRole, requestId),
    });

    return (
        <div className="project-action-cell">
            <button
                className="button secondary"
                disabled={targetRole === null || action.isBusy}
                type="button"
                onClick={action.openPreview}
            >
                {targetRole === null ? 'Owner' : `Make ${formatEditableRole(targetRole)}`}
            </button>

            {action.isDialogOpen ? (
                <ActionPreviewDialog
                    confirmDisabled={targetRole === null}
                    confirmLabel="Change role"
                    error={action.error}
                    fallbackTitle={`Change ${memberName} role`}
                    id="member-role-dialog"
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

function getTargetRole(role: DemoMemberRole): DemoEditableMemberRole | null {
    switch (role) {
        case 'admin':
            return 'viewer';
        case 'viewer':
            return 'admin';
        case 'owner':
            return null;
    }
}

function formatEditableRole(role: DemoEditableMemberRole): string {
    switch (role) {
        case 'admin':
            return 'Admin';
        case 'viewer':
            return 'Viewer';
    }
}
