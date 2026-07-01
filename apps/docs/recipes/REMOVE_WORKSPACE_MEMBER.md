# Remove Workspace Member With Undo

Use this recipe when removing a member should be reversible for a short window.

Member removal is more complex than a simple delete. The action may need to snapshot the member,
clear ownership links, and later restore the member only if no conflicting replacement or ownership
change happened.

## What Problem It Solves

A member removal can affect:

- workspace access;
- project ownership;
- document ownership;
- unique email constraints;
- audit history.

RollbackKit makes the operation previewable and gives undo a clear safety boundary.

## When To Use It

Use this pattern for:

- removing a workspace member;
- suspending an account while preserving restore data;
- reversible team membership changes.

Do not use it for privacy-driven account deletion unless retention and snapshot policy allow it.

## Action Shape

```ts
import { defineAction, REVERSIBILITY, RollbackKitError } from '@rollbackkit/core';

const REMOVED_MEMBER_STATE = 'removedMemberState';

export const memberRemoveAction = defineAction({
    name: 'member.remove',
    reversibility: REVERSIBILITY.full,
    undoWindowMs: 30 * 60 * 1000,

    input: {
        parse(input) {
            const candidate = input as {
                readonly workspaceId?: unknown;
                readonly memberId?: unknown;
            };

            if (typeof candidate.workspaceId !== 'string') {
                throw new Error('workspaceId is required.');
            }

            if (typeof candidate.memberId !== 'string') {
                throw new Error('memberId is required.');
            }

            return {
                workspaceId: candidate.workspaceId,
                memberId: candidate.memberId,
            };
        },
    },

    async preview({ input }) {
        const member = await loadMember(input.workspaceId, input.memberId);
        const ownership = await readOwnershipImpact(input.workspaceId, member.id);

        assertMemberCanBeRemoved(member);

        return {
            title: `Remove ${member.name}`,
            summary: 'The member will be removed and previous membership state saved for undo.',
            impact: [
                { label: 'Member loses workspace access', severity: 'danger' },
                {
                    label: `${ownership.projectIds.length} owned projects become unassigned`,
                    severity: 'warning',
                },
                {
                    label: `${ownership.documentIds.length} owned documents become unassigned`,
                    severity: 'warning',
                },
                { label: 'Previous membership state will be saved for undo', severity: 'info' },
            ],
            reversibility: REVERSIBILITY.full,
        };
    },

    async execute({ input, snapshots }) {
        const member = await loadMember(input.workspaceId, input.memberId);
        const ownership = await readOwnershipImpact(input.workspaceId, member.id);

        assertMemberCanBeRemoved(member);

        await snapshots.save(REMOVED_MEMBER_STATE, {
            memberId: member.id,
            workspaceId: member.workspaceId,
            name: member.name,
            email: member.email,
            role: member.role,
            createdAt: member.createdAt,
            ownedProjectIds: ownership.projectIds,
            ownedDocumentIds: ownership.documentIds,
        });

        await removeMember(input.workspaceId, member.id);

        return {
            data: {
                memberId: member.id,
                status: 'removed',
                role: member.role,
                projectOwnerLinksCleared: ownership.projectIds.length,
                documentOwnerLinksCleared: ownership.documentIds.length,
            },
        };
    },

    async checkConflicts({ snapshots }) {
        const snapshot = await snapshots.get<RemovedMemberState>(REMOVED_MEMBER_STATE);

        if (snapshot === null) {
            throw new Error('Removed member state snapshot is missing.');
        }

        await assertMemberCanBeRestored(snapshot.value);
        await assertOwnedProjectsCanBeRestored(
            snapshot.value.workspaceId,
            snapshot.value.ownedProjectIds,
        );
        await assertOwnedDocumentsCanBeRestored(
            snapshot.value.workspaceId,
            snapshot.value.ownedDocumentIds,
        );
    },

    async undo({ snapshots }) {
        const snapshot = await snapshots.get<RemovedMemberState>(REMOVED_MEMBER_STATE);

        if (snapshot === null) {
            throw new Error('Removed member state snapshot is missing.');
        }

        const restoredMember = await restoreMember(snapshot.value);
        const projectLinks = await restoreProjectOwnerLinks(
            snapshot.value.workspaceId,
            restoredMember.id,
            snapshot.value.ownedProjectIds,
        );
        const documentLinks = await restoreDocumentOwnerLinks(
            snapshot.value.workspaceId,
            restoredMember.id,
            snapshot.value.ownedDocumentIds,
        );

        return {
            data: {
                memberId: restoredMember.id,
                status: 'restored',
                role: restoredMember.role,
                projectOwnerLinksRestored: projectLinks,
                documentOwnerLinksRestored: documentLinks,
            },
        };
    },
});

interface RemovedMemberState {
    readonly memberId: string;
    readonly workspaceId: string;
    readonly name: string;
    readonly email: string;
    readonly role: 'owner' | 'admin' | 'viewer';
    readonly createdAt: string;
    readonly ownedProjectIds: readonly string[];
    readonly ownedDocumentIds: readonly string[];
}

function assertMemberCanBeRemoved(member: { readonly id: string; readonly role: string }): void {
    if (member.role === 'owner') {
        throw new RollbackKitError({
            code: 'ACTION_CONFLICT',
            message: 'Owner members cannot be removed safely.',
            details: { memberId: member.id },
        });
    }
}
```

The app-owned helpers decide how to delete, restore and reconnect product records. RollbackKit
coordinates the lifecycle and stores the snapshot.

## Conflict Checks To Keep

Before undo, check that:

- the member id does not already exist;
- the workspace still exists;
- the member email is not already used by another member;
- projects from the snapshot still exist;
- documents from the snapshot still exist;
- ownership links have not been assigned to someone else.

These checks are why undo is safer than a blind insert.

## Expected Result

- Preview explains workspace access loss and ownership impact.
- Execute saves the full member state and ownership links before removal.
- Undo restores the member and reconnects ownership only when the current product state allows it.
- Undo fails with an `ACTION_CONFLICT` when restore would overwrite newer state.

## Common Mistakes

- Removing owner members through the generic member-removal action.
- Snapshotting the member but not owned record ids.
- Restoring ownership links without checking whether they were reassigned.
- Treating privacy deletion as reversible member removal.
- Forgetting that email uniqueness can make undo unsafe.

## Related Pages

- [Change User Role Safely](./CHANGE_USER_ROLE.md)
- [Soft Delete With Undo](./SOFT_DELETE_WITH_UNDO.md)
- [Getting Started](../GETTING_STARTED.md)
- [Why rollback-first](../WHY_ROLLBACK_FIRST.md)
