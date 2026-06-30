import 'server-only';

import { defineAction, type JsonObject, REVERSIBILITY, RollbackKitError } from '@rollbackkit/core';
import type { PostgresQueryExecutor } from '@rollbackkit/postgres';
import {
    changeDemoMemberRole,
    type DemoEditableMemberRole,
    type DemoMemberRecord,
    type DemoMemberStorageRole,
    findDemoMemberById,
} from '../repositories/member-repository';

export const MEMBER_CHANGE_ROLE_ACTION_NAME = 'member.change_role';

const MEMBER_CHANGE_ROLE_UNDO_WINDOW_MS = 30 * 60 * 1000;
const PREVIOUS_MEMBER_ROLE_SNAPSHOT_KEY = 'previousMemberRole';

type MemberChangeRoleInput = JsonObject & {
    readonly memberId: string;
    readonly role: DemoEditableMemberRole;
};

interface MemberChangeRoleResult extends JsonObject {
    readonly memberId: string;
    readonly role: DemoMemberStorageRole;
    readonly previousRole: DemoMemberStorageRole;
}

interface PreviousMemberRoleSnapshot extends JsonObject {
    readonly memberId: string;
    readonly previousRole: DemoMemberStorageRole;
    readonly changedToRole: DemoEditableMemberRole;
}

export function createMemberChangeRoleAction(executor: PostgresQueryExecutor) {
    return defineAction<MemberChangeRoleInput, MemberChangeRoleResult, MemberChangeRoleResult>({
        name: MEMBER_CHANGE_ROLE_ACTION_NAME,
        input: {
            parse: parseMemberChangeRoleInput,
        },
        reversibility: REVERSIBILITY.full,
        undoWindowMs: MEMBER_CHANGE_ROLE_UNDO_WINDOW_MS,

        resolveTarget: async (context) => {
            const member = await getMemberOrThrow(executor, context.input.memberId);

            return {
                id: member.id,
                type: 'member',
                label: member.name,
                metadata: {
                    email: member.email,
                    role: member.role,
                },
            };
        },

        preview: async (context) => {
            const member = await getMemberOrThrow(executor, context.input.memberId);

            assertMemberCanChangeRole(member);

            const alreadyHasRole = member.role === context.input.role;

            return {
                title: `Change ${member.name} role`,
                summary:
                    'The member role will be updated while the previous role is stored for undo.',
                impact: [
                    {
                        label: `Role changes from ${formatRoleLabel(member.role)} to ${formatRoleLabel(
                            context.input.role,
                        )}`,
                        severity: 'warning',
                    },
                    {
                        label: 'Previous member role will be saved for undo',
                        severity: 'info',
                    },
                    {
                        label: 'Undo is available for 30 minutes',
                        severity: 'info',
                    },
                ],
                reversibility: REVERSIBILITY.full,
                ...(alreadyHasRole
                    ? {
                          warnings: [
                              `${member.name} already has the ${formatRoleLabel(
                                  context.input.role,
                              )} role.`,
                          ],
                      }
                    : {}),
            };
        },

        execute: async (context) => {
            const member = await getMemberOrThrow(executor, context.input.memberId);

            assertMemberCanChangeRole(member);

            if (member.role === context.input.role) {
                throw createMemberRoleConflictError(
                    member.id,
                    `Member already has the "${context.input.role}" role.`,
                );
            }

            await context.snapshots.save(
                PREVIOUS_MEMBER_ROLE_SNAPSHOT_KEY,
                createPreviousMemberRoleSnapshot(member, context.input.role),
            );

            const updatedMember = await changeMemberRole(executor, member.id, context.input.role);

            return {
                data: {
                    memberId: updatedMember.id,
                    role: updatedMember.role,
                    previousRole: member.role,
                },
                metadata: {
                    memberName: member.name,
                },
            };
        },

        undo: async (context) => {
            const snapshot = await context.snapshots.get<PreviousMemberRoleSnapshot>(
                PREVIOUS_MEMBER_ROLE_SNAPSHOT_KEY,
            );

            if (snapshot === null) {
                throw new RollbackKitError({
                    code: 'SNAPSHOT_NOT_FOUND',
                    message: 'Previous member role snapshot was not found.',
                    details: {
                        actionRunId: context.run.id,
                        snapshotKey: PREVIOUS_MEMBER_ROLE_SNAPSHOT_KEY,
                    },
                });
            }

            const currentMember = await getMemberOrThrow(executor, snapshot.value.memberId);

            if (currentMember.role !== snapshot.value.changedToRole) {
                throw createMemberRoleConflictError(
                    currentMember.id,
                    `Expected current role "${snapshot.value.changedToRole}", but found "${currentMember.role}".`,
                );
            }

            const restoredMember = await changeMemberRole(
                executor,
                snapshot.value.memberId,
                snapshot.value.previousRole,
            );

            return {
                data: {
                    memberId: restoredMember.id,
                    role: restoredMember.role,
                    previousRole: snapshot.value.changedToRole,
                },
                metadata: {
                    memberName: restoredMember.name,
                },
            };
        },
    });
}

function parseMemberChangeRoleInput(input: unknown): MemberChangeRoleInput {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error('Member role change input must be an object.');
    }

    const candidate = input as {
        readonly memberId?: unknown;
        readonly role?: unknown;
    };

    if (typeof candidate.memberId !== 'string' || candidate.memberId.trim() === '') {
        throw new Error('Member role change input requires memberId.');
    }

    if (candidate.role !== 'admin' && candidate.role !== 'viewer') {
        throw new Error('Member role change input role must be "admin" or "viewer".');
    }

    return {
        memberId: candidate.memberId.trim(),
        role: candidate.role,
    } as MemberChangeRoleInput;
}

async function getMemberOrThrow(
    executor: PostgresQueryExecutor,
    memberId: string,
): Promise<DemoMemberRecord> {
    const member = await findDemoMemberById(executor, memberId);

    if (member === null) {
        throw new RollbackKitError({
            code: 'ACTION_NOT_FOUND',
            message: `Member "${memberId}" was not found.`,
            details: {
                memberId,
            },
        });
    }

    return member;
}

async function changeMemberRole(
    executor: PostgresQueryExecutor,
    memberId: string,
    role: DemoMemberStorageRole,
): Promise<DemoMemberRecord> {
    const member = await changeDemoMemberRole(executor, memberId, role);

    if (member === null) {
        throw new RollbackKitError({
            code: 'ACTION_NOT_FOUND',
            message: `Member "${memberId}" was not found.`,
            details: {
                memberId,
            },
        });
    }

    return member;
}

function createPreviousMemberRoleSnapshot(
    member: DemoMemberRecord,
    changedToRole: DemoEditableMemberRole,
): PreviousMemberRoleSnapshot {
    return {
        memberId: member.id,
        previousRole: member.role,
        changedToRole,
    };
}

function assertMemberCanChangeRole(member: DemoMemberRecord): void {
    if (member.role !== 'owner') {
        return;
    }

    throw createMemberRoleConflictError(
        member.id,
        'Owner role cannot be changed in the demo action.',
    );
}

function formatRoleLabel(role: DemoMemberStorageRole): string {
    switch (role) {
        case 'owner':
            return 'Owner';
        case 'admin':
            return 'Admin';
        case 'viewer':
            return 'Viewer';
    }
}

function createMemberRoleConflictError(memberId: string, reason: string): RollbackKitError {
    return new RollbackKitError({
        code: 'ACTION_CONFLICT',
        message: `Member "${memberId}" role cannot be changed safely: ${reason}`,
        details: {
            memberId,
            reason,
        },
    });
}
