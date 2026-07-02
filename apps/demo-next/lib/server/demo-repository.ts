import 'server-only';

import type { QueryResultRow } from 'pg';

import type {
    DemoDashboardData,
    DemoDocument,
    DemoDocumentState,
    DemoMember,
    DemoMemberRole,
    DemoProject,
    DemoProjectStatus,
    DemoWorkspace,
} from '../demo/view-models';
import { getDemoPostgresPool } from './demo-db';

const WORKSPACE_SLUG = 'acme-cloud';

interface WorkspaceRow extends QueryResultRow {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
}

interface ProjectRow extends QueryResultRow {
    readonly id: string;
    readonly name: string;
    readonly owner: string | null;
    readonly status: DemoProjectStatus;
    readonly updated_at: Date | string;
}

interface MemberRow extends QueryResultRow {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly role: DemoMemberRole;
}

interface DocumentRow extends QueryResultRow {
    readonly id: string;
    readonly title: string;
    readonly owner: string | null;
    readonly state: DemoDocumentState;
}

export async function getDemoDashboardData(): Promise<DemoDashboardData> {
    const pool = getDemoPostgresPool();

    const workspace = await getDemoWorkspace();

    const [projectsResult, membersResult, documentsResult] = await Promise.all([
        pool.query<ProjectRow>(
            `
SELECT
    demo_projects.id,
    demo_projects.name,
    demo_projects.status,
    demo_projects.updated_at,
    demo_members.name AS owner
FROM demo_projects
LEFT JOIN demo_members
    ON demo_members.id = demo_projects.owner_member_id
WHERE demo_projects.workspace_id = $1
ORDER BY demo_projects.updated_at DESC, demo_projects.id DESC
`,
            [workspace.id],
        ),
        pool.query<MemberRow>(
            `
SELECT id, name, email, role
FROM demo_members
WHERE workspace_id = $1
ORDER BY
    CASE role
        WHEN 'owner' THEN 1
        WHEN 'admin' THEN 2
        ELSE 3
    END,
    name ASC
`,
            [workspace.id],
        ),
        pool.query<DocumentRow>(
            `
SELECT
    demo_documents.id,
    demo_documents.title,
    demo_documents.state,
    demo_members.name AS owner
FROM demo_documents
LEFT JOIN demo_members
    ON demo_members.id = demo_documents.owner_member_id
WHERE demo_documents.workspace_id = $1
ORDER BY demo_documents.updated_at DESC, demo_documents.id DESC
`,
            [workspace.id],
        ),
    ]);

    return {
        workspace: mapWorkspace(workspace),
        projects: projectsResult.rows.map(mapProject),
        members: membersResult.rows.map(mapMember),
        documents: documentsResult.rows.map(mapDocument),
    };
}

async function getDemoWorkspace(): Promise<WorkspaceRow> {
    const result = await getDemoPostgresPool().query<WorkspaceRow>(
        `
SELECT id, slug, name
FROM demo_workspaces
WHERE slug = $1
LIMIT 1
`,
        [WORKSPACE_SLUG],
    );

    const workspace = result.rows[0];

    if (workspace === undefined) {
        throw new Error(
            `Demo workspace "${WORKSPACE_SLUG}" was not found. Run the demo database seed script.`,
        );
    }

    return workspace;
}

function mapWorkspace(row: WorkspaceRow): DemoWorkspace {
    return {
        name: row.name,
        label: `${row.name} workspace`,
        description:
            'Preview impact, execute safely, preserve an audit trail and undo supported actions before the rollback window expires.',
        undoWindowLabel: '30m',
    };
}

function mapProject(row: ProjectRow): DemoProject {
    return {
        id: row.id,
        name: row.name,
        owner: row.owner ?? 'Unassigned',
        status: row.status,
        statusLabel: formatProjectStatusLabel(row.status),
        updatedAt: formatDate(row.updated_at),
    };
}

function mapMember(row: MemberRow): DemoMember {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        roleLabel: formatMemberRoleLabel(row.role),
    };
}

function mapDocument(row: DocumentRow): DemoDocument {
    return {
        id: row.id,
        title: row.title,
        owner: row.owner ?? 'Unassigned',
        state: row.state,
        stateLabel: formatDocumentStateLabel(row.state),
    };
}

function formatProjectStatusLabel(status: DemoProjectStatus): string {
    switch (status) {
        case 'active':
            return 'Active';
        case 'archived':
            return 'Archived';
    }
}

function formatMemberRoleLabel(role: DemoMemberRole): string {
    switch (role) {
        case 'owner':
            return 'Owner';
        case 'admin':
            return 'Admin';
        case 'viewer':
            return 'Viewer';
    }
}

function formatDocumentStateLabel(state: DemoDocumentState): string {
    switch (state) {
        case 'published':
            return 'Published';
        case 'draft':
            return 'Draft';
        case 'archived':
            return 'Archived';
    }
}

function formatDate(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new TypeError('Invalid demo timestamp value.');
    }

    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(date);
}
