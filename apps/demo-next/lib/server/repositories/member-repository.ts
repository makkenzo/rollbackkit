import 'server-only';

import type { PostgresQueryExecutor } from '@rollbackkit/postgres';
import type { QueryResultRow } from 'pg';

export type DemoMemberStorageRole = 'owner' | 'admin' | 'viewer';
export type DemoEditableMemberRole = 'admin' | 'viewer';

export interface DemoMemberRecord extends QueryResultRow {
    readonly id: string;
    readonly workspace_id: string;
    readonly name: string;
    readonly email: string;
    readonly role: DemoMemberStorageRole;
    readonly created_at: Date | string;
    readonly revision: string;
}

export interface DemoMemberRestoreState {
    readonly memberId: string;
    readonly workspaceId: string;
    readonly name: string;
    readonly email: string;
    readonly role: DemoMemberStorageRole;
    readonly createdAt: string;
    readonly revision: string;
}

export interface DemoMemberDeletePrecondition {
    readonly member: DemoMemberRestoreState;
    readonly ownedProjectIds: readonly string[];
    readonly ownedDocumentIds: readonly string[];
}

export interface DemoMemberDeleteResult {
    readonly member: DemoMemberRecord;
    readonly projectOwnerLinksCleared: number;
    readonly documentOwnerLinksCleared: number;
}

interface ExistingMemberByEmailRow extends QueryResultRow {
    readonly id: string;
}

interface WorkspaceRow extends QueryResultRow {
    readonly id: string;
}

export async function findDemoMemberById(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    memberId: string,
): Promise<DemoMemberRecord | null> {
    const result = await executor.query<DemoMemberRecord>(
        `
SELECT id, workspace_id, name, email, role, created_at, xmin::text AS revision
FROM demo_members
WHERE id = $1
  AND workspace_id = $2
LIMIT 1
	`,
        [memberId, workspaceId],
    );

    return result.rows[0] ?? null;
}

export async function changeDemoMemberRole(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    memberId: string,
    expectedRole: DemoMemberStorageRole,
    role: DemoMemberStorageRole,
): Promise<DemoMemberRecord | null> {
    const result = await executor.query<DemoMemberRecord>(
        `
UPDATE demo_members
SET role = $2
WHERE id = $1
  AND workspace_id = $3
  AND role = $4
RETURNING id, workspace_id, name, email, role, created_at, xmin::text AS revision
	`,
        [memberId, role, workspaceId, expectedRole],
    );

    return result.rows[0] ?? null;
}

export async function deleteDemoMember(
    executor: PostgresQueryExecutor,
    precondition: DemoMemberDeletePrecondition,
): Promise<DemoMemberDeleteResult | null> {
    const projectOwnerLinksCleared = await clearExpectedProjectOwnerLinks(executor, precondition);

    if (projectOwnerLinksCleared !== precondition.ownedProjectIds.length) {
        return null;
    }

    const documentOwnerLinksCleared = await clearExpectedDocumentOwnerLinks(executor, precondition);

    if (documentOwnerLinksCleared !== precondition.ownedDocumentIds.length) {
        return null;
    }

    const result = await executor.query<DemoMemberRecord>(
        `
DELETE FROM demo_members
WHERE id = $1
  AND workspace_id = $2
  AND name = $3
  AND email = $4
  AND role = $5
  AND xmin::text = $6
RETURNING id, workspace_id, name, email, role, created_at, xmin::text AS revision
		`,
        [
            precondition.member.memberId,
            precondition.member.workspaceId,
            precondition.member.name,
            precondition.member.email,
            precondition.member.role,
            precondition.member.revision,
        ],
    );

    const member = result.rows[0];

    if (member === undefined) {
        return null;
    }

    return {
        member,
        projectOwnerLinksCleared,
        documentOwnerLinksCleared,
    };
}

export async function insertDemoMember(
    executor: PostgresQueryExecutor,
    snapshot: DemoMemberRestoreState,
): Promise<DemoMemberRecord | null> {
    const result = await executor.query<DemoMemberRecord>(
        `
INSERT INTO demo_members (id, workspace_id, name, email, role, created_at)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT DO NOTHING
RETURNING id, workspace_id, name, email, role, created_at, xmin::text AS revision
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

    return result.rows[0] ?? null;
}

async function clearExpectedProjectOwnerLinks(
    executor: PostgresQueryExecutor,
    precondition: DemoMemberDeletePrecondition,
): Promise<number> {
    if (precondition.ownedProjectIds.length === 0) {
        return 0;
    }

    const result = await executor.query(
        `
UPDATE demo_projects
SET owner_member_id = NULL
WHERE id = ANY($1::text[])
  AND workspace_id = $2
  AND owner_member_id = $3
		`,
        [
            precondition.ownedProjectIds,
            precondition.member.workspaceId,
            precondition.member.memberId,
        ],
    );

    return result.rowCount ?? 0;
}

async function clearExpectedDocumentOwnerLinks(
    executor: PostgresQueryExecutor,
    precondition: DemoMemberDeletePrecondition,
): Promise<number> {
    if (precondition.ownedDocumentIds.length === 0) {
        return 0;
    }

    const result = await executor.query(
        `
UPDATE demo_documents
SET owner_member_id = NULL
WHERE id = ANY($1::text[])
  AND workspace_id = $2
  AND owner_member_id = $3
		`,
        [
            precondition.ownedDocumentIds,
            precondition.member.workspaceId,
            precondition.member.memberId,
        ],
    );

    return result.rowCount ?? 0;
}

export async function demoWorkspaceExists(
    executor: PostgresQueryExecutor,
    workspaceId: string,
): Promise<boolean> {
    const result = await executor.query<WorkspaceRow>(
        `
SELECT id
FROM demo_workspaces
WHERE id = $1
LIMIT 1
`,
        [workspaceId],
    );

    return result.rows[0] !== undefined;
}

export async function findDemoMemberByWorkspaceEmail(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    email: string,
): Promise<string | null> {
    const result = await executor.query<ExistingMemberByEmailRow>(
        `
SELECT id
FROM demo_members
WHERE workspace_id = $1
  AND email = $2
LIMIT 1
`,
        [workspaceId, email],
    );

    return result.rows[0]?.id ?? null;
}
