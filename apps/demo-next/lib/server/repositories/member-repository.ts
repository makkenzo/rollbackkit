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
SELECT id, workspace_id, name, email, role, created_at
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
    role: DemoMemberStorageRole,
): Promise<DemoMemberRecord | null> {
    const result = await executor.query<DemoMemberRecord>(
        `
UPDATE demo_members
SET role = $2
WHERE id = $1
  AND workspace_id = $3
RETURNING id, workspace_id, name, email, role, created_at
	`,
        [memberId, role, workspaceId],
    );

    return result.rows[0] ?? null;
}

export async function deleteDemoMember(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    memberId: string,
): Promise<DemoMemberRecord | null> {
    const result = await executor.query<DemoMemberRecord>(
        `
DELETE FROM demo_members
WHERE id = $1
  AND workspace_id = $2
RETURNING id, workspace_id, name, email, role, created_at
	`,
        [memberId, workspaceId],
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
