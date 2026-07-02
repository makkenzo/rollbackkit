# Conflict Detection

Use this recipe when undo is only safe if the current product state still matches the state that the
original action expects.

The action should check current state before undo and record a conflict with UI-safe details before
any restore mutation happens. Once `checkConflicts` records a conflict, RollbackKit refuses undo with
`ACTION_CONFLICT`; throw your own `ACTION_CONFLICT` only when you need a custom message or details.

## What Problem It Solves

Undo is unsafe when another user or process changed the same target after the original action. A
safe conflict flow should answer:

- what state the undo expected;
- what state exists now;
- why RollbackKit refused to undo;
- what the operator should review next.

## When To Use It

Use this pattern for:

- undoing a role change after the role changed again;
- restoring an archived project only while it is still archived;
- restoring a removed member only when their email and ownership links are still available;
- blocking undo when a target was deleted after the original action.

Do not guess or partially restore when the current state does not match the expected state.

## Action Shape

```ts
import { defineAction, REVERSIBILITY, RollbackKitError } from '@rollbackkit/core';

const PREVIOUS_MEMBER_ROLE = 'previousMemberRole';

export const memberChangeRoleAction = defineAction({
    name: 'member.change_role',
    reversibility: REVERSIBILITY.full,
    undoWindowMs: 30 * 60 * 1000,

    async execute({ input, snapshots }) {
        const member = await loadMember(input.workspaceId, input.memberId);

        await snapshots.save(PREVIOUS_MEMBER_ROLE, {
            workspaceId: input.workspaceId,
            memberId: member.id,
            previousRole: member.role,
            changedToRole: input.role,
        });

        await changeMemberRole(input.workspaceId, member.id, input.role);

        return {
            data: {
                memberId: member.id,
                role: input.role,
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
            throw new RollbackKitError({
                code: 'SNAPSHOT_NOT_FOUND',
                message: 'Previous member role snapshot is missing.',
            });
        }

        const currentMember = await loadMember(snapshot.value.workspaceId, snapshot.value.memberId);

        if (currentMember.role === snapshot.value.changedToRole) {
            return;
        }

        const reason = `Expected current role "${snapshot.value.changedToRole}", but found "${currentMember.role}".`;

        await conflicts.record(reason, {
            expectedState: `Member role is ${snapshot.value.changedToRole}`,
            actualState: `Member role is ${currentMember.role}`,
            suggestedNextStep: 'Review the current member role before retrying undo.',
        });
    },

    async undo({ snapshots }) {
        const snapshot = await snapshots.get<{
            readonly workspaceId: string;
            readonly memberId: string;
            readonly previousRole: 'admin' | 'viewer';
        }>(PREVIOUS_MEMBER_ROLE);

        if (snapshot === null) {
            throw new Error('Previous member role snapshot is missing.');
        }

        await changeMemberRole(
            snapshot.value.workspaceId,
            snapshot.value.memberId,
            snapshot.value.previousRole,
        );

        return {
            data: {
                memberId: snapshot.value.memberId,
                role: snapshot.value.previousRole,
            },
        };
    },
});
```

## Expected Result

When the current state matches the expected state, undo runs normally. When it does not match,
RollbackKit records a conflict, marks the action run as `undo_failed`, returns `ACTION_CONFLICT`,
and leaves product state unchanged.

The demo app shows this as an `Undo blocked` history item with:

- the conflict reason;
- expected state;
- actual state;
- a suggested next step.

## Common Mistakes

- Do not perform restore mutations before `checkConflicts` finishes.
- Do not record raw snapshots or secrets in conflict details.
- Do not throw a generic error for expected unsafe undo; record a conflict, or throw
  `ACTION_CONFLICT` when you need a custom error payload.
- Do not hide conflicts in logs only; return a UI/API-safe summary.
- Do not treat missing targets as ordinary not-found errors during undo. Missing targets are unsafe
  undo conflicts.

## Related Pages

- [Change User Role Safely](./CHANGE_USER_ROLE.md)
- [Soft Delete With Undo](./SOFT_DELETE_WITH_UNDO.md)
- [Core Lifecycle](../CORE_LIFECYCLE.md)
- [Architecture](../ARCHITECTURE.md)
