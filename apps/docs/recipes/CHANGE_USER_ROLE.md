# Change User Role Safely

Use this recipe when a member role can be changed and later restored.

The action should preview the role transition, reject protected roles, save the previous role,
update the member, and only undo if the current role still matches the expected changed role.

## What Problem It Solves

Role changes look simple but affect access control. A safe role-change flow should answer:

- who is being changed;
- what the old and new roles are;
- whether the role is protected;
- what previous role will be restored during undo;
- whether another admin changed the role after the original action.

## When To Use It

Use this pattern for:

- admin to viewer;
- viewer to admin;
- temporary privilege escalation;
- internal support role changes.

Do not use it for owner transfer unless owner-transfer rules are modeled explicitly.

## Action Shape

```ts
import { defineAction, REVERSIBILITY, RollbackKitError } from '@rollbackkit/core';

const PREVIOUS_MEMBER_ROLE = 'previousMemberRole';

export const memberChangeRoleAction = defineAction({
    name: 'member.change_role',
    reversibility: REVERSIBILITY.full,
    undoWindowMs: 30 * 60 * 1000,

    input: {
        parse(input) {
            const candidate = input as {
                readonly workspaceId?: unknown;
                readonly memberId?: unknown;
                readonly role?: unknown;
            };

            if (typeof candidate.workspaceId !== 'string') {
                throw new Error('workspaceId is required.');
            }

            if (typeof candidate.memberId !== 'string') {
                throw new Error('memberId is required.');
            }

            if (candidate.role !== 'admin' && candidate.role !== 'viewer') {
                throw new Error('role must be admin or viewer.');
            }

            return {
                workspaceId: candidate.workspaceId,
                memberId: candidate.memberId,
                role: candidate.role,
            };
        },
    },

    async preview({ input }) {
        const member = await loadMember(input.workspaceId, input.memberId);

        assertRoleCanChange(member);

        return {
            title: `Change ${member.name} role`,
            summary: 'The member role will be updated and the previous role saved for undo.',
            impact: [
                {
                    label: `Role changes from ${member.role} to ${input.role}`,
                    severity: 'warning',
                },
                { label: 'Previous member role will be saved for undo', severity: 'info' },
                { label: 'Undo is available for 30 minutes', severity: 'info' },
            ],
            reversibility: REVERSIBILITY.full,
        };
    },

    async execute({ input, snapshots }) {
        const member = await loadMember(input.workspaceId, input.memberId);

        assertRoleCanChange(member);

        if (member.role === input.role) {
            throw new RollbackKitError({
                code: 'ACTION_CONFLICT',
                message: 'Member already has the requested role.',
                details: { memberId: member.id, role: member.role },
            });
        }

        await snapshots.save(PREVIOUS_MEMBER_ROLE, {
            workspaceId: input.workspaceId,
            memberId: member.id,
            previousRole: member.role,
            changedToRole: input.role,
        });

        const updatedMember = await changeMemberRole(input.workspaceId, member.id, input.role);

        return {
            data: {
                memberId: updatedMember.id,
                role: updatedMember.role,
                previousRole: member.role,
            },
        };
    },

    async checkConflicts({ snapshots, conflicts }) {
        const snapshot = await snapshots.get<{
            readonly workspaceId: string;
            readonly memberId: string;
            readonly changedToRole: 'admin' | 'viewer';
        }>(PREVIOUS_MEMBER_ROLE);

        if (snapshot === null) {
            throw new Error('Previous member role snapshot is missing.');
        }

        const currentMember = await loadMember(snapshot.value.workspaceId, snapshot.value.memberId);

        if (currentMember.role !== snapshot.value.changedToRole) {
            await conflicts.record('Member role changed again, so undo would be unsafe.', {
                memberId: currentMember.id,
                currentRole: currentMember.role,
                expectedRole: snapshot.value.changedToRole,
            });

            throw new RollbackKitError({
                code: 'ACTION_CONFLICT',
                message: 'Member role changed again, so undo would be unsafe.',
                details: {
                    memberId: currentMember.id,
                    currentRole: currentMember.role,
                    expectedRole: snapshot.value.changedToRole,
                },
            });
        }
    },

    async undo({ snapshots }) {
        const snapshot = await snapshots.get<{
            readonly workspaceId: string;
            readonly memberId: string;
            readonly previousRole: 'admin' | 'viewer';
            readonly changedToRole: 'admin' | 'viewer';
        }>(PREVIOUS_MEMBER_ROLE);

        if (snapshot === null) {
            throw new Error('Previous member role snapshot is missing.');
        }

        const restoredMember = await changeMemberRole(
            snapshot.value.workspaceId,
            snapshot.value.memberId,
            snapshot.value.previousRole,
        );

        return {
            data: {
                memberId: restoredMember.id,
                role: restoredMember.role,
                previousRole: snapshot.value.changedToRole,
            },
        };
    },
});

function assertRoleCanChange(member: { readonly id: string; readonly role: string }): void {
    if (member.role === 'owner') {
        throw new RollbackKitError({
            code: 'ACTION_CONFLICT',
            message: 'Owner role cannot be changed safely.',
            details: { memberId: member.id },
        });
    }
}
```

## Wire The UI Flow

```ts
const preview = await rollbackkit.preview({
    name: 'member.change_role',
    actor,
    tenantId: workspaceId,
    input: { workspaceId, memberId, role: 'admin' },
});

const run = await rollbackkit.execute({
    name: 'member.change_role',
    actor,
    tenantId: workspaceId,
    input: { workspaceId, memberId, role: 'admin' },
    idempotencyKey: requestId,
});
```

## Expected Result

- Preview shows the old role, new role and undo window.
- Execute saves the previous role and updates the member.
- Undo restores the previous role only if the current role still equals the role set by execute.
- Undo fails with a conflict if another admin changed the member again.

## Common Mistakes

- Letting owner or protected roles use the generic role-change action.
- Saving only the previous role but not the role that execute changed to.
- Undoing without checking the current role.
- Treating permission checks and conflict checks as the same thing.

## Related Pages

- [Soft Delete With Undo](./SOFT_DELETE_WITH_UNDO.md)
- [Getting Started](../GETTING_STARTED.md)
- [Core Lifecycle](../CORE_LIFECYCLE.md)
- [Why rollback-first](../WHY_ROLLBACK_FIRST.md)
