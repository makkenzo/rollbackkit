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
}

export interface DemoMemberRestoreState {
    readonly memberId: string;
    readonly workspaceId: string;
    readonly name: string;
    readonly email: string;
    readonly role: DemoMemberStorageRole;
    readonly createdAt: string;
}

export interface DemoOwnershipImpact {
    readonly ownedProjectIds: readonly string[];
    readonly ownedDocumentIds: readonly string[];
}

export interface DemoOwnedProjectRecord extends QueryResultRow {
    readonly id: string;
    readonly name: string;
    readonly owner_member_id: string | null;
}

export interface DemoOwnedDocumentRecord extends QueryResultRow {
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

export async function findDemoMemberById(
    executor: PostgresQueryExecutor,
    memberId: string,
): Promise<DemoMemberRecord | null> {
    const result = await executor.query<DemoMemberRecord>(
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

export async function changeDemoMemberRole(
    executor: PostgresQueryExecutor,
    memberId: string,
    role: DemoMemberStorageRole,
): Promise<DemoMemberRecord | null> {
    const result = await executor.query<DemoMemberRecord>(
        `
UPDATE demo_members
SET role = $2
WHERE id = $1
RETURNING id, workspace_id, name, email, role, created_at
`,
        [memberId, role],
    );

    return result.rows[0] ?? null;
}

export async function readDemoOwnershipImpact(
    executor: PostgresQueryExecutor,
    memberId: string,
): Promise<DemoOwnershipImpact> {
    const [projectsResult, documentsResult] = await Promise.all([
        executor.query<DemoOwnedProjectRecord>(
            `
SELECT id, name, owner_member_id
FROM demo_projects
WHERE owner_member_id = $1
ORDER BY id ASC
`,
            [memberId],
        ),
        executor.query<DemoOwnedDocumentRecord>(
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

export async function deleteDemoMember(
    executor: PostgresQueryExecutor,
    memberId: string,
): Promise<DemoMemberRecord | null> {
    const result = await executor.query<DemoMemberRecord>(
        `
DELETE FROM demo_members
WHERE id = $1
RETURNING id, workspace_id, name, email, role, created_at
`,
        [memberId],
    );

    return result.rows[0] ?? null;
}

export async function insertDemoMember(
    executor: PostgresQueryExecutor,
    snapshot: DemoMemberRestoreState,
): Promise<DemoMemberRecord | null> {
    const result = await executor.query<DemoMemberRecord>(
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

    return result.rows[0] ?? null;
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

export async function findDemoOwnedProjectsByIds(
    executor: PostgresQueryExecutor,
    projectIds: readonly string[],
): Promise<readonly DemoOwnedProjectRecord[]> {
    const result = await executor.query<DemoOwnedProjectRecord>(
        `
SELECT id, name, owner_member_id
FROM demo_projects
WHERE id = ANY($1::text[])
`,
        [projectIds],
    );

    return result.rows;
}

export async function findDemoOwnedDocumentsByIds(
    executor: PostgresQueryExecutor,
    documentIds: readonly string[],
): Promise<readonly DemoOwnedDocumentRecord[]> {
    const result = await executor.query<DemoOwnedDocumentRecord>(
        `
SELECT id, title, owner_member_id
FROM demo_documents
WHERE id = ANY($1::text[])
`,
        [documentIds],
    );

    return result.rows;
}

export async function restoreDemoProjectOwnerLinks(
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

export async function restoreDemoDocumentOwnerLinks(
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
