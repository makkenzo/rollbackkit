BEGIN;

TRUNCATE TABLE
    demo_documents,
    demo_projects,
    demo_members,
    demo_workspaces
RESTART IDENTITY CASCADE;

INSERT INTO demo_workspaces (id, slug, name, created_at)
VALUES
    ('workspace_acme', 'acme-cloud', 'Acme Cloud', '2026-01-01T00:00:00.000Z');

INSERT INTO demo_members (id, workspace_id, name, email, role, created_at)
VALUES
    (
        'member_ada',
        'workspace_acme',
        'Ada Lovelace',
        'ada@example.com',
        'owner',
        '2026-01-01T00:00:00.000Z'
    ),
    (
        'member_grace',
        'workspace_acme',
        'Grace Hopper',
        'grace@example.com',
        'admin',
        '2026-01-01T00:01:00.000Z'
    ),
    (
        'member_alan',
        'workspace_acme',
        'Alan Turing',
        'alan@example.com',
        'viewer',
        '2026-01-01T00:02:00.000Z'
    );

INSERT INTO demo_projects (
    id,
    workspace_id,
    name,
    owner_member_id,
    status,
    archived_at,
    updated_at,
    created_at
)
VALUES
    (
        'project_billing',
        'workspace_acme',
        'Billing Revamp',
        'member_ada',
        'active',
        NULL,
        '2026-01-01T00:20:00.000Z',
        '2026-01-01T00:03:00.000Z'
    ),
    (
        'project_onboarding',
        'workspace_acme',
        'Customer Onboarding',
        'member_grace',
        'active',
        NULL,
        '2026-01-01T00:18:00.000Z',
        '2026-01-01T00:04:00.000Z'
    ),
    (
        'project_legacy_import',
        'workspace_acme',
        'Legacy Import',
        'member_alan',
        'archived',
        '2026-01-01T00:15:00.000Z',
        '2026-01-01T00:15:00.000Z',
        '2026-01-01T00:05:00.000Z'
    );

INSERT INTO demo_documents (
    id,
    workspace_id,
    project_id,
    owner_member_id,
    title,
    state,
    archived_at,
    updated_at,
    created_at
)
VALUES
    (
        'document_security_review',
        'workspace_acme',
        'project_billing',
        'member_ada',
        'Security Review Notes',
        'published',
        NULL,
        '2026-01-01T00:19:00.000Z',
        '2026-01-01T00:06:00.000Z'
    ),
    (
        'document_import_checklist',
        'workspace_acme',
        'project_onboarding',
        'member_grace',
        'Bulk Import Checklist',
        'draft',
        NULL,
        '2026-01-01T00:17:00.000Z',
        '2026-01-01T00:07:00.000Z'
    ),
    (
        'document_archived_contract',
        'workspace_acme',
        'project_legacy_import',
        'member_alan',
        'Archived Contract',
        'archived',
        '2026-01-01T00:16:00.000Z',
        '2026-01-01T00:16:00.000Z',
        '2026-01-01T00:08:00.000Z'
    );

COMMIT;