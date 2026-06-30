import 'server-only';

import { defineAction, type JsonObject, REVERSIBILITY, RollbackKitError } from '@rollbackkit/core';
import type { PostgresQueryExecutor } from '@rollbackkit/postgres';
import type { QueryResultRow } from 'pg';

export const MEMBER_REMOVE_ACTION_NAME = 'member.remove';

const MEMBER_REMOVE_UNDO_WINDOW_MS = 30 * 60 * 1000;
const REMOVED_MEMBER_STATE_SNAPSHOT_KEY = 'removedMemberState';

type MemberStorageRole = 'owner' | 'admin' | 'viewer';

type MemberRemoveInput = JsonObject & {
    readonly memberId: string;
};

interface MemberRemoveExecuteResult extends JsonObject {
    readonly memberId: string;
    readonly status: 'removed';
    readonly role: MemberStorageRole;
    readonly projectOwnerLinksCleared: number;
    readonly documentOwnerLinksCleared: number;
}

interface MemberRemoveUndoResult extends JsonObject {
    readonly memberId: string;
    readonly status: 'restored';
    readonly role: MemberStorageRole;
    readonly projectOwnerLinksRestored: number;
    readonly documentOwnerLinksRestored: number;
}

interface RemovedMemberStateSnapshot extends JsonObject {
    readonly memberId: string;
    readonly workspaceId: string;
    readonly name: string;
    readonly email: string;
    readonly role: MemberStorageRole;
    readonly createdAt: string;
    readonly ownedProjectIds: readonly string[];
    readonly ownedDocumentIds: readonly string[];
}

interface MemberRow extends QueryResultRow {
    readonly id: string;
    readonly workspace_id: string;
    readonly name: string;
    readonly email: string;
    readonly role: MemberStorageRole;
    readonly created_at: Date | string;
}

interface OwnedTargetRow extends QueryResultRow {
    readonly id: string;
    readonly name: string;
    readonly owner_member_id: string | null;
}

interface OwnedDocumentRow extends QueryResultRow {
    readonly id: string;
    readonly title: string;
    readonly owner_member_id: string | null;
}

interface ExistingMemberByEmailRow extends QueryResultRow {
    readonly id: string;
}

interface WorkspaceRow extends QueryResultRow {
    readonly id: string;
}

interface OwnershipImpact {
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

            assertMemberCanBeRemoved(member);

            const ownership = await getOwnershipImpact(executor, member.id);

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
            const member = await getMemberOrThrow(executor, context.input.memberId);

            assertMemberCanBeRemoved(member);

            const ownership = await getOwnershipImpact(executor, member.id);

            await context.snapshots.save(
                REMOVED_MEMBER_STATE_SNAPSHOT_KEY,
                createRemovedMemberStateSnapshot(member, ownership),
            );

            const removedMember = await removeMember(executor, member.id);

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

        undo: async (context) => {
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

            await assertMemberCanBeRestored(executor, snapshot.value);
            await assertOwnedProjectsCanBeRestored(executor, snapshot.value.ownedProjectIds);
            await assertOwnedDocumentsCanBeRestored(executor, snapshot.value.ownedDocumentIds);

            const restoredMember = await restoreMember(executor, snapshot.value);

            const restoredProjectOwnerLinks = await restoreProjectOwnerLinks(
                executor,
                restoredMember.id,
                snapshot.value.ownedProjectIds,
            );

            const restoredDocumentOwnerLinks = await restoreDocumentOwnerLinks(
                executor,
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

function parseMemberRemoveInput(input: unknown): MemberRemoveInput {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error('Member remove input must be an object.');
    }

    const candidate = input as {
        readonly memberId?: unknown;
    };

    if (typeof candidate.memberId !== 'string' || candidate.memberId.trim() === '') {
        throw new Error('Member remove input requires memberId.');
    }

    return {
        memberId: candidate.memberId.trim(),
    } as MemberRemoveInput;
}

async function getMemberOrThrow(
    executor: PostgresQueryExecutor,
    memberId: string,
): Promise<MemberRow> {
    const member = await getMemberById(executor, memberId);

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
    memberId: string,
): Promise<MemberRow | null> {
    const result = await executor.query<MemberRow>(
        `
SELECT id, workspace_id, name, email, role, created_at
FROM demo_members
WHERE id = $1
LIMIT 1
`,
        [memberId],
    );

    return result.rows[0] ?? null;
}

async function getOwnershipImpact(
    executor: PostgresQueryExecutor,
    memberId: string,
): Promise<OwnershipImpact> {
    const [projectsResult, documentsResult] = await Promise.all([
        executor.query<OwnedTargetRow>(
            `
SELECT id, name, owner_member_id
FROM demo_projects
WHERE owner_member_id = $1
ORDER BY id ASC
`,
            [memberId],
        ),
        executor.query<OwnedDocumentRow>(
            `
SELECT id, title, owner_member_id
FROM demo_documents
WHERE owner_member_id = $1
ORDER BY id ASC
`,
            [memberId],
        ),
    ]);

    return {
        ownedProjectIds: projectsResult.rows.map((row) => row.id),
        ownedDocumentIds: documentsResult.rows.map((row) => row.id),
    };
}

async function removeMember(executor: PostgresQueryExecutor, memberId: string): Promise<MemberRow> {
    const result = await executor.query<MemberRow>(
        `
DELETE FROM demo_members
WHERE id = $1
RETURNING id, workspace_id, name, email, role, created_at
`,
        [memberId],
    );

    const member = result.rows[0];

    if (member === undefined) {
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
): Promise<MemberRow> {
    const result = await executor.query<MemberRow>(
        `
INSERT INTO demo_members (id, workspace_id, name, email, role, created_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, workspace_id, name, email, role, created_at
`,
        [
            snapshot.memberId,
            snapshot.workspaceId,
            snapshot.name,
            snapshot.email,
            snapshot.role,
            snapshot.createdAt,
        ],
    );

    const member = result.rows[0];

    if (member === undefined) {
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
): Promise<void> {
    const existingMember = await getMemberById(executor, snapshot.memberId);

    if (existingMember !== null) {
        throw createMemberRemoveConflictError(
            snapshot.memberId,
            'Member already exists, so undo would be unsafe.',
        );
    }

    const workspaceResult = await executor.query<WorkspaceRow>(
        `
SELECT id
FROM demo_workspaces
WHERE id = $1
LIMIT 1
`,
        [snapshot.workspaceId],
    );

    if (workspaceResult.rows[0] === undefined) {
        throw createMemberRemoveConflictError(
            snapshot.memberId,
            `Workspace "${snapshot.workspaceId}" no longer exists.`,
        );
    }

    const emailResult = await executor.query<ExistingMemberByEmailRow>(
        `
SELECT id
FROM demo_members
WHERE workspace_id = $1
  AND email = $2
LIMIT 1
`,
        [snapshot.workspaceId, snapshot.email],
    );

    const emailOwner = emailResult.rows[0];

    if (emailOwner !== undefined) {
        throw createMemberRemoveConflictError(
            snapshot.memberId,
            `Email "${snapshot.email}" is already used by member "${emailOwner.id}".`,
        );
    }
}

async function assertOwnedProjectsCanBeRestored(
    executor: PostgresQueryExecutor,
    projectIds: readonly string[],
): Promise<void> {
    if (projectIds.length === 0) {
        return;
    }

    const result = await executor.query<OwnedTargetRow>(
        `
SELECT id, name, owner_member_id
FROM demo_projects
WHERE id = ANY($1::text[])
`,
        [projectIds],
    );

    const existingIds = new Set(result.rows.map((row) => row.id));
    const missingIds = projectIds.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
        throw createMemberRemoveConflictError(
            'unknown',
            `Owned project(s) no longer exist: ${missingIds.join(', ')}.`,
        );
    }

    const reassignedProject = result.rows.find((row) => row.owner_member_id !== null);

    if (reassignedProject !== undefined) {
        throw createMemberRemoveConflictError(
            'unknown',
            `Project "${reassignedProject.id}" already has another owner.`,
        );
    }
}

async function assertOwnedDocumentsCanBeRestored(
    executor: PostgresQueryExecutor,
    documentIds: readonly string[],
): Promise<void> {
    if (documentIds.length === 0) {
        return;
    }

    const result = await executor.query<OwnedDocumentRow>(
        `
SELECT id, title, owner_member_id
FROM demo_documents
WHERE id = ANY($1::text[])
`,
        [documentIds],
    );

    const existingIds = new Set(result.rows.map((row) => row.id));
    const missingIds = documentIds.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
        throw createMemberRemoveConflictError(
            'unknown',
            `Owned document(s) no longer exist: ${missingIds.join(', ')}.`,
        );
    }

    const reassignedDocument = result.rows.find((row) => row.owner_member_id !== null);

    if (reassignedDocument !== undefined) {
        throw createMemberRemoveConflictError(
            'unknown',
            `Document "${reassignedDocument.id}" already has another owner.`,
        );
    }
}

async function restoreProjectOwnerLinks(
    executor: PostgresQueryExecutor,
    memberId: string,
    projectIds: readonly string[],
): Promise<number> {
    if (projectIds.length === 0) {
        return 0;
    }

    const result = await executor.query(
        `
UPDATE demo_projects
SET owner_member_id = $1
WHERE id = ANY($2::text[])
`,
        [memberId, projectIds],
    );

    return result.rowCount ?? 0;
}

async function restoreDocumentOwnerLinks(
    executor: PostgresQueryExecutor,
    memberId: string,
    documentIds: readonly string[],
): Promise<number> {
    if (documentIds.length === 0) {
        return 0;
    }

    const result = await executor.query(
        `
UPDATE demo_documents
SET owner_member_id = $1
WHERE id = ANY($2::text[])
`,
        [memberId, documentIds],
    );

    return result.rowCount ?? 0;
}

function createRemovedMemberStateSnapshot(
    member: MemberRow,
    ownership: OwnershipImpact,
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

function assertMemberCanBeRemoved(member: MemberRow): void {
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
