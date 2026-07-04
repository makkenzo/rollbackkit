import 'server-only';

import type { PostgresQueryExecutor } from '@rollbackkit/postgres';
import type { QueryResultRow } from 'pg';

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

export async function readDemoOwnershipImpact(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    memberId: string,
): Promise<DemoOwnershipImpact> {
    const [projectsResult, documentsResult] = await Promise.all([
        executor.query<DemoOwnedProjectRecord>(
            `
SELECT id, name, owner_member_id
FROM demo_projects
WHERE owner_member_id = $1
  AND workspace_id = $2
ORDER BY id ASC
	`,
            [memberId, workspaceId],
        ),
        executor.query<DemoOwnedDocumentRecord>(
            `
SELECT id, title, owner_member_id
FROM demo_documents
WHERE owner_member_id = $1
  AND workspace_id = $2
ORDER BY id ASC
	`,
            [memberId, workspaceId],
        ),
    ]);

    return {
        ownedProjectIds: projectsResult.rows.map((row) => row.id),
        ownedDocumentIds: documentsResult.rows.map((row) => row.id),
    };
}

export async function findDemoOwnedProjectsByIds(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    projectIds: readonly string[],
): Promise<readonly DemoOwnedProjectRecord[]> {
    const result = await executor.query<DemoOwnedProjectRecord>(
        `
SELECT id, name, owner_member_id
FROM demo_projects
WHERE id = ANY($1::text[])
  AND workspace_id = $2
	`,
        [projectIds, workspaceId],
    );

    return result.rows;
}

export async function findDemoOwnedDocumentsByIds(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    documentIds: readonly string[],
): Promise<readonly DemoOwnedDocumentRecord[]> {
    const result = await executor.query<DemoOwnedDocumentRecord>(
        `
SELECT id, title, owner_member_id
FROM demo_documents
WHERE id = ANY($1::text[])
  AND workspace_id = $2
	`,
        [documentIds, workspaceId],
    );

    return result.rows;
}

export async function restoreDemoProjectOwnerLinks(
    executor: PostgresQueryExecutor,
    workspaceId: string,
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
  AND workspace_id = $3
  AND owner_member_id IS NULL
	`,
        [memberId, projectIds, workspaceId],
    );

    return result.rowCount ?? 0;
}

export async function restoreDemoDocumentOwnerLinks(
    executor: PostgresQueryExecutor,
    workspaceId: string,
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
  AND workspace_id = $3
  AND owner_member_id IS NULL
	`,
        [memberId, documentIds, workspaceId],
    );

    return result.rowCount ?? 0;
}
