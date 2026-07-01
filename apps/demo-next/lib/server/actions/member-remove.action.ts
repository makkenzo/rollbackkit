import 'server-only';

import {
    type ConflictRecorder,
    defineAction,
    type JsonObject,
    REVERSIBILITY,
    RollbackKitError,
} from '@rollbackkit/core';
import type { PostgresQueryExecutor } from '@rollbackkit/postgres';
import {
    type DemoMemberRecord,
    type DemoMemberStorageRole,
    deleteDemoMember,
    demoWorkspaceExists,
    findDemoMemberById,
    findDemoMemberByWorkspaceEmail,
    insertDemoMember,
} from '../repositories/member-repository';
import {
    type DemoOwnershipImpact,
    findDemoOwnedDocumentsByIds,
    findDemoOwnedProjectsByIds,
    readDemoOwnershipImpact,
    restoreDemoDocumentOwnerLinks,
    restoreDemoProjectOwnerLinks,
} from '../repositories/ownership-repository';
import { assertDemoWorkspaceScope } from './demo-action-scope';
import { recordDemoUndoConflict } from './undo-conflict';

export const MEMBER_REMOVE_ACTION_NAME = 'member.remove';

const MEMBER_REMOVE_UNDO_WINDOW_MS = 30 * 60 * 1000;
const REMOVED_MEMBER_STATE_SNAPSHOT_KEY = 'removedMemberState';

type MemberRemoveInput = JsonObject & {
    readonly workspaceId: string;
    readonly memberId: string;
};

interface MemberRemoveExecuteResult extends JsonObject {
    readonly memberId: string;
    readonly status: 'removed';
    readonly role: DemoMemberStorageRole;
    readonly projectOwnerLinksCleared: number;
    readonly documentOwnerLinksCleared: number;
}

interface MemberRemoveUndoResult extends JsonObject {
    readonly memberId: string;
    readonly status: 'restored';
    readonly role: DemoMemberStorageRole;
    readonly projectOwnerLinksRestored: number;
    readonly documentOwnerLinksRestored: number;
}

interface RemovedMemberStateSnapshot extends JsonObject {
    readonly memberId: string;
    readonly workspaceId: string;
    readonly name: string;
    readonly email: string;
    readonly role: DemoMemberStorageRole;
    readonly createdAt: string;
    readonly ownedProjectIds: readonly string[];
    readonly ownedDocumentIds: readonly string[];
}

export function createMemberRemoveAction(executor: PostgresQueryExecutor) {
    return defineAction<MemberRemoveInput, MemberRemoveExecuteResult, MemberRemoveUndoResult>({
        name: MEMBER_REMOVE_ACTION_NAME,
        input: {
            parse: parseMemberRemoveInput,
        },
        reversibility: REVERSIBILITY.full,
        undoWindowMs: MEMBER_REMOVE_UNDO_WINDOW_MS,

        resolveTarget: async (context) => {
            assertDemoWorkspaceScope(context);

            const member = await getMemberOrThrow(
                executor,
                context.input.workspaceId,
                context.input.memberId,
            );

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
            assertDemoWorkspaceScope(context);

            const member = await getMemberOrThrow(
                executor,
                context.input.workspaceId,
                context.input.memberId,
            );

            assertMemberCanBeRemoved(member);

            const ownership = await getOwnershipImpact(
                executor,
                context.input.workspaceId,
                member.id,
            );

            return {
                title: `Remove ${member.name}`,
                summary:
                    'The member will be removed from the workspace. Their previous membership state will be saved for undo.',
                impact: [
                    {
                        label: 'Member loses workspace access',
                        severity: 'danger',
                    },
                    {
                        label: formatProjectOwnershipImpact(ownership.ownedProjectIds.length),
                        severity: 'warning',
                    },
                    {
                        label: formatDocumentOwnershipImpact(ownership.ownedDocumentIds.length),
                        severity: 'warning',
                    },
                    {
                        label: 'Previous membership state will be saved for undo',
                        severity: 'info',
                    },
                ],
                reversibility: REVERSIBILITY.full,
            };
        },

        execute: async (context) => {
            assertDemoWorkspaceScope(context);

            const member = await getMemberOrThrow(
                executor,
                context.input.workspaceId,
                context.input.memberId,
            );

            assertMemberCanBeRemoved(member);

            const ownership = await getOwnershipImpact(
                executor,
                context.input.workspaceId,
                member.id,
            );

            await context.snapshots.save(
                REMOVED_MEMBER_STATE_SNAPSHOT_KEY,
                createRemovedMemberStateSnapshot(member, ownership),
            );

            const removedMember = await removeMember(
                executor,
                context.input.workspaceId,
                member.id,
            );

            return {
                data: {
                    memberId: removedMember.id,
                    status: 'removed',
                    role: removedMember.role,
                    projectOwnerLinksCleared: ownership.ownedProjectIds.length,
                    documentOwnerLinksCleared: ownership.ownedDocumentIds.length,
                },
                metadata: {
                    memberName: removedMember.name,
                },
            };
        },

        checkConflicts: async (context) => {
            assertDemoWorkspaceScope(context);

            const snapshot = await readRemovedMemberStateSnapshot(context);
            await assertMemberCanBeRestored(executor, snapshot.value, context.conflicts);
            await assertOwnedProjectsCanBeRestored(
                executor,
                snapshot.value.workspaceId,
                snapshot.value.memberId,
                snapshot.value.ownedProjectIds,
                context.conflicts,
            );
            await assertOwnedDocumentsCanBeRestored(
                executor,
                snapshot.value.workspaceId,
                snapshot.value.memberId,
                snapshot.value.ownedDocumentIds,
                context.conflicts,
            );
        },

        undo: async (context) => {
            assertDemoWorkspaceScope(context);

            const snapshot = await readRemovedMemberStateSnapshot(context);

            const restoredMember = await restoreMember(executor, snapshot.value);

            const restoredProjectOwnerLinks = await restoreDemoProjectOwnerLinks(
                executor,
                snapshot.value.workspaceId,
                restoredMember.id,
                snapshot.value.ownedProjectIds,
            );

            const restoredDocumentOwnerLinks = await restoreDemoDocumentOwnerLinks(
                executor,
                snapshot.value.workspaceId,
                restoredMember.id,
                snapshot.value.ownedDocumentIds,
            );

            return {
                data: {
                    memberId: restoredMember.id,
                    status: 'restored',
                    role: restoredMember.role,
                    projectOwnerLinksRestored: restoredProjectOwnerLinks,
                    documentOwnerLinksRestored: restoredDocumentOwnerLinks,
                },
                metadata: {
                    memberName: restoredMember.name,
                },
            };
        },
    });
}

async function readRemovedMemberStateSnapshot(context: {
    readonly run: { readonly id: string };
    readonly snapshots: {
        get<TValue extends JsonObject>(key: string): Promise<{ readonly value: TValue } | null>;
    };
}): Promise<{ readonly value: RemovedMemberStateSnapshot }> {
    const snapshot = await context.snapshots.get<RemovedMemberStateSnapshot>(
        REMOVED_MEMBER_STATE_SNAPSHOT_KEY,
    );

    if (snapshot === null) {
        throw new RollbackKitError({
            code: 'SNAPSHOT_NOT_FOUND',
            message: 'Removed member state snapshot was not found.',
            details: {
                actionRunId: context.run.id,
                snapshotKey: REMOVED_MEMBER_STATE_SNAPSHOT_KEY,
            },
        });
    }

    return snapshot;
}

function parseMemberRemoveInput(input: unknown): MemberRemoveInput {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error('Member remove input must be an object.');
    }

    const candidate = input as {
        readonly workspaceId?: unknown;
        readonly memberId?: unknown;
    };

    if (typeof candidate.workspaceId !== 'string' || candidate.workspaceId.trim() === '') {
        throw new Error('Member remove input requires workspaceId.');
    }

    if (typeof candidate.memberId !== 'string' || candidate.memberId.trim() === '') {
        throw new Error('Member remove input requires memberId.');
    }

    return {
        workspaceId: candidate.workspaceId.trim(),
        memberId: candidate.memberId.trim(),
    } as MemberRemoveInput;
}

async function getMemberOrThrow(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    memberId: string,
): Promise<DemoMemberRecord> {
    const member = await getMemberById(executor, workspaceId, memberId);

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

async function getMemberById(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    memberId: string,
): Promise<DemoMemberRecord | null> {
    return findDemoMemberById(executor, workspaceId, memberId);
}

async function getOwnershipImpact(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    memberId: string,
): Promise<DemoOwnershipImpact> {
    return readDemoOwnershipImpact(executor, workspaceId, memberId);
}

async function removeMember(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    memberId: string,
): Promise<DemoMemberRecord> {
    const member = await deleteDemoMember(executor, workspaceId, memberId);

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

async function restoreMember(
    executor: PostgresQueryExecutor,
    snapshot: RemovedMemberStateSnapshot,
): Promise<DemoMemberRecord> {
    const member = await insertDemoMember(executor, snapshot);

    if (member === null) {
        throw new RollbackKitError({
            code: 'STORAGE_ERROR',
            message: 'PostgreSQL did not return restored member after insert.',
            details: {
                memberId: snapshot.memberId,
            },
        });
    }

    return member;
}

async function assertMemberCanBeRestored(
    executor: PostgresQueryExecutor,
    snapshot: RemovedMemberStateSnapshot,
    conflicts: ConflictRecorder,
): Promise<void> {
    const existingMember = await getMemberById(executor, snapshot.workspaceId, snapshot.memberId);

    if (existingMember !== null) {
        await throwMemberRemoveUndoConflict(
            conflicts,
            snapshot.memberId,
            'Member already exists, so undo would be unsafe.',
            'Member does not exist in the workspace',
            'Member already exists in the workspace',
        );
    }

    if (!(await demoWorkspaceExists(executor, snapshot.workspaceId))) {
        await throwMemberRemoveUndoConflict(
            conflicts,
            snapshot.memberId,
            `Workspace "${snapshot.workspaceId}" no longer exists.`,
            'Workspace exists',
            'Workspace no longer exists',
        );
    }

    const emailOwnerId = await findDemoMemberByWorkspaceEmail(
        executor,
        snapshot.workspaceId,
        snapshot.email,
    );

    if (emailOwnerId !== null) {
        await throwMemberRemoveUndoConflict(
            conflicts,
            snapshot.memberId,
            `Email "${snapshot.email}" is already used by member "${emailOwnerId}".`,
            'Member email is available',
            `Member email is used by "${emailOwnerId}"`,
        );
    }
}

async function assertOwnedProjectsCanBeRestored(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    memberId: string,
    projectIds: readonly string[],
    conflicts: ConflictRecorder,
): Promise<void> {
    if (projectIds.length === 0) {
        return;
    }

    const projects = await findDemoOwnedProjectsByIds(executor, workspaceId, projectIds);

    const existingIds = new Set(projects.map((row) => row.id));
    const missingIds = projectIds.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
        await throwMemberRemoveUndoConflict(
            conflicts,
            memberId,
            `Owned project(s) no longer exist: ${missingIds.join(', ')}.`,
            'Owned projects still exist',
            `Missing owned project(s): ${missingIds.join(', ')}`,
        );
    }

    const reassignedProject = projects.find((row) => row.owner_member_id !== null);

    if (reassignedProject !== undefined) {
        await throwMemberRemoveUndoConflict(
            conflicts,
            memberId,
            `Project "${reassignedProject.id}" already has another owner.`,
            'Owned projects are unassigned',
            `Project "${reassignedProject.id}" already has another owner`,
        );
    }
}

async function assertOwnedDocumentsCanBeRestored(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    memberId: string,
    documentIds: readonly string[],
    conflicts: ConflictRecorder,
): Promise<void> {
    if (documentIds.length === 0) {
        return;
    }

    const documents = await findDemoOwnedDocumentsByIds(executor, workspaceId, documentIds);

    const existingIds = new Set(documents.map((row) => row.id));
    const missingIds = documentIds.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
        await throwMemberRemoveUndoConflict(
            conflicts,
            memberId,
            `Owned document(s) no longer exist: ${missingIds.join(', ')}.`,
            'Owned documents still exist',
            `Missing owned document(s): ${missingIds.join(', ')}`,
        );
    }

    const reassignedDocument = documents.find((row) => row.owner_member_id !== null);

    if (reassignedDocument !== undefined) {
        await throwMemberRemoveUndoConflict(
            conflicts,
            memberId,
            `Document "${reassignedDocument.id}" already has another owner.`,
            'Owned documents are unassigned',
            `Document "${reassignedDocument.id}" already has another owner`,
        );
    }
}

function createRemovedMemberStateSnapshot(
    member: DemoMemberRecord,
    ownership: DemoOwnershipImpact,
): RemovedMemberStateSnapshot {
    return {
        memberId: member.id,
        workspaceId: member.workspace_id,
        name: member.name,
        email: member.email,
        role: member.role,
        createdAt: normalizeDate(member.created_at),
        ownedProjectIds: ownership.ownedProjectIds,
        ownedDocumentIds: ownership.ownedDocumentIds,
    };
}

function assertMemberCanBeRemoved(member: DemoMemberRecord): void {
    if (member.role !== 'owner') {
        return;
    }

    throw createMemberRemoveConflictError(
        member.id,
        'Owner members cannot be removed in the demo action.',
    );
}

function normalizeDate(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new TypeError('Invalid member timestamp value.');
    }

    return date.toISOString();
}

function formatProjectOwnershipImpact(count: number): string {
    if (count === 0) {
        return 'No owned projects will be reassigned';
    }

    return count === 1
        ? '1 owned project becomes unassigned'
        : `${count} owned projects become unassigned`;
}

function formatDocumentOwnershipImpact(count: number): string {
    if (count === 0) {
        return 'No owned documents will be reassigned';
    }

    return count === 1
        ? '1 owned document becomes unassigned'
        : `${count} owned documents become unassigned`;
}

async function throwMemberRemoveUndoConflict(
    conflicts: ConflictRecorder,
    memberId: string,
    reason: string,
    expectedState: string,
    actualState: string,
): Promise<never> {
    await recordDemoUndoConflict(conflicts, reason, {
        expectedState,
        actualState,
        suggestedNextStep: 'Review the current workspace membership before retrying undo.',
    });

    throw createMemberRemoveConflictError(memberId, reason);
}

function createMemberRemoveConflictError(memberId: string, reason: string): RollbackKitError {
    return new RollbackKitError({
        code: 'ACTION_CONFLICT',
        message: `Member "${memberId}" cannot be removed safely: ${reason}`,
        details: {
            memberId,
            reason,
        },
    });
}
