import 'server-only';

import type { PostgresQueryExecutor } from '@rollbackkit/postgres';
import type { QueryResultRow } from 'pg';

export type DemoProjectStorageStatus = 'active' | 'archived';

export interface DemoProjectRecord extends QueryResultRow {
    readonly id: string;
    readonly workspace_id: string;
    readonly name: string;
    readonly status: DemoProjectStorageStatus;
    readonly archived_at: Date | string | null;
    readonly updated_at: Date | string;
    readonly document_count: number | string;
    readonly revision: string;
}

export interface DemoProjectRestoreState {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly status: DemoProjectStorageStatus;
    readonly archivedAt: string | null;
    readonly updatedAt: string;
}

export async function findDemoProjectById(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    projectId: string,
): Promise<DemoProjectRecord | null> {
    const result = await executor.query<DemoProjectRecord>(
        `
SELECT
    demo_projects.id,
    demo_projects.workspace_id,
    demo_projects.name,
    demo_projects.status,
    demo_projects.archived_at,
    demo_projects.updated_at,
    demo_projects.xmin::text AS revision,
    COUNT(demo_documents.id)::int AS document_count
FROM demo_projects
LEFT JOIN demo_documents
    ON demo_documents.project_id = demo_projects.id
    AND demo_documents.workspace_id = demo_projects.workspace_id
WHERE demo_projects.id = $1
  AND demo_projects.workspace_id = $2
GROUP BY
    demo_projects.id,
    demo_projects.workspace_id,
    demo_projects.name,
    demo_projects.status,
    demo_projects.archived_at,
    demo_projects.updated_at,
    demo_projects.xmin
LIMIT 1
`,
        [projectId, workspaceId],
    );

    return result.rows[0] ?? null;
}

export async function archiveDemoProject(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    projectId: string,
    expectedRevision: string,
): Promise<DemoProjectRecord | null> {
    const result = await executor.query<DemoProjectRecord>(
        `
WITH updated_project AS (
UPDATE demo_projects
SET
    status = 'archived',
    archived_at = now(),
    updated_at = now()
WHERE id = $1
  AND workspace_id = $2
  AND status = 'active'
  AND xmin::text = $3
RETURNING id, workspace_id, name, status, archived_at, updated_at, xmin::text AS revision
)
SELECT
    updated_project.id,
    updated_project.workspace_id,
    updated_project.name,
    updated_project.status,
    updated_project.archived_at,
    updated_project.updated_at,
    updated_project.revision,
    COUNT(demo_documents.id)::int AS document_count
FROM updated_project
LEFT JOIN demo_documents
    ON demo_documents.project_id = updated_project.id
    AND demo_documents.workspace_id = updated_project.workspace_id
GROUP BY
    updated_project.id,
    updated_project.workspace_id,
    updated_project.name,
    updated_project.status,
    updated_project.archived_at,
    updated_project.updated_at,
    updated_project.revision
	`,
        [projectId, workspaceId, expectedRevision],
    );

    return result.rows[0] ?? null;
}

export async function restoreDemoProject(
    executor: PostgresQueryExecutor,
    snapshot: DemoProjectRestoreState,
    expectedCurrentRevision: string,
): Promise<DemoProjectRecord | null> {
    const result = await executor.query<DemoProjectRecord>(
        `
WITH updated_project AS (
UPDATE demo_projects
SET
    status = $2,
    archived_at = $3,
    updated_at = $4
WHERE id = $1
  AND workspace_id = $5
  AND status = 'archived'
  AND xmin::text = $6
RETURNING id, workspace_id, name, status, archived_at, updated_at, xmin::text AS revision
)
SELECT
    updated_project.id,
    updated_project.workspace_id,
    updated_project.name,
    updated_project.status,
    updated_project.archived_at,
    updated_project.updated_at,
    updated_project.revision,
    COUNT(demo_documents.id)::int AS document_count
FROM updated_project
LEFT JOIN demo_documents
    ON demo_documents.project_id = updated_project.id
    AND demo_documents.workspace_id = updated_project.workspace_id
GROUP BY
    updated_project.id,
    updated_project.workspace_id,
    updated_project.name,
    updated_project.status,
    updated_project.archived_at,
    updated_project.updated_at,
    updated_project.revision
	`,
        [
            snapshot.projectId,
            snapshot.status,
            snapshot.archivedAt,
            snapshot.updatedAt,
            snapshot.workspaceId,
            expectedCurrentRevision,
        ],
    );

    return result.rows[0] ?? null;
}
