import type { ActionActor } from '@rollbackkit/core';
import { createPostgresMigrationRunner } from '@rollbackkit/postgres';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PROJECT_ARCHIVE_ACTION_NAME } from '../../lib/server/actions/project-archive.action';
import { createDemoRollbackKit } from '../../lib/server/rollbackkit';
import { readDemoSql } from '../helpers/demo-sql';

const databaseUrl = process.env.ROLLBACKKIT_DEMO_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIntegration = databaseUrl === undefined ? describe.skip : describe;

const actor: ActionActor = {
    id: 'member_action_owner',
    type: 'user',
    displayName: 'Action Owner',
};

let client: Client | undefined;

describeIntegration('project.archive action', () => {
    beforeEach(async () => {
        client = new Client({
            connectionString: databaseUrl,
        });

        await client.connect();

        await createPostgresMigrationRunner({
            executor: client,
        }).migrate();

        await client.query(await readDemoSql('db/schema.sql'));
        await seedActionTestData(client);
    });

    afterEach(async () => {
        if (client === undefined) {
            return;
        }

        await client
            .query(
                `
DELETE FROM rollbackkit_action_runs
WHERE tenant_id = $1
`,
                ['workspace_action_test'],
            )
            .catch(() => undefined);

        await client
            .query('DELETE FROM demo_workspaces WHERE id = $1', ['workspace_action_test'])
            .catch(() => undefined);

        await client.end().catch(() => undefined);

        client = undefined;
    });

    it('previews, executes and undoes project archive', async () => {
        const currentClient = requireClient();
        const rollbackkit = createDemoRollbackKit(currentClient);

        const preview = await rollbackkit.preview({
            name: PROJECT_ARCHIVE_ACTION_NAME,
            actor,
            tenantId: 'workspace_action_test',
            input: {
                workspaceId: 'workspace_action_test',
                projectId: 'project_action_archive_target',
            },
        });

        expect(preview).toMatchObject({
            title: 'Archive Action Archive Target',
            reversibility: {
                kind: 'full',
                undoable: true,
            },
        });

        expect(preview.impact.map((item) => item.label)).toEqual([
            'Project moves to archived state',
            '2 documents remain attached',
            'Previous project state will be saved for undo',
        ]);

        const run = await rollbackkit.execute({
            name: PROJECT_ARCHIVE_ACTION_NAME,
            actor,
            tenantId: 'workspace_action_test',
            input: {
                workspaceId: 'workspace_action_test',
                projectId: 'project_action_archive_target',
            },
        });

        expect(run).toMatchObject({
            name: PROJECT_ARCHIVE_ACTION_NAME,
            status: 'completed',
            tenantId: 'workspace_action_test',
            target: {
                id: 'project_action_archive_target',
                type: 'project',
                label: 'Action Archive Target',
                metadata: {
                    status: 'active',
                },
            },
            result: {
                projectId: 'project_action_archive_target',
                status: 'archived',
                archivedAt: expect.any(String),
            },
        });

        await expect(
            readProjectStatus(currentClient, 'project_action_archive_target'),
        ).resolves.toBe('archived');

        const snapshotResult = await currentClient.query<{
            readonly key: string;
            readonly value: {
                readonly projectId: string;
                readonly status: string;
                readonly archivedAt: string | null;
                readonly updatedAt: string;
            };
        }>(
            `
SELECT key, value
FROM rollbackkit_snapshots
WHERE action_run_id = $1
ORDER BY created_at ASC
`,
            [run.id],
        );

        expect(snapshotResult.rows).toHaveLength(1);
        expect(snapshotResult.rows[0]).toMatchObject({
            key: 'previousProjectState',
            value: {
                projectId: 'project_action_archive_target',
                status: 'active',
                archivedAt: null,
            },
        });

        const undone = await rollbackkit.undo({
            actionRunId: run.id,
            actor,
        });

        expect(undone).toMatchObject({
            id: run.id,
            status: 'undone',
            undoResult: {
                projectId: 'project_action_archive_target',
                status: 'active',
                archivedAt: null,
            },
        });

        await expect(
            readProjectStatus(currentClient, 'project_action_archive_target'),
        ).resolves.toBe('active');
    });
});

function requireClient(): Client {
    if (client === undefined) {
        throw new Error('Expected PostgreSQL client to be initialized.');
    }

    return client;
}

async function seedActionTestData(executor: Client): Promise<void> {
    await executor.query(`
INSERT INTO demo_workspaces (id, slug, name)
VALUES ('workspace_action_test', 'action-test', 'Action Test')
ON CONFLICT (id) DO UPDATE
SET
    slug = EXCLUDED.slug,
    name = EXCLUDED.name;

INSERT INTO demo_members (id, workspace_id, name, email, role)
VALUES (
    'member_action_owner',
    'workspace_action_test',
    'Action Owner',
    'action-owner@example.com',
    'owner'
)
ON CONFLICT (id) DO UPDATE
SET
    workspace_id = EXCLUDED.workspace_id,
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    role = EXCLUDED.role;

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
VALUES (
    'project_action_archive_target',
    'workspace_action_test',
    'Action Archive Target',
    'member_action_owner',
    'active',
    NULL,
    '2026-01-01T00:20:00.000Z',
    '2026-01-01T00:10:00.000Z'
)
ON CONFLICT (id) DO UPDATE
SET
    workspace_id = EXCLUDED.workspace_id,
    name = EXCLUDED.name,
    owner_member_id = EXCLUDED.owner_member_id,
    status = EXCLUDED.status,
    archived_at = EXCLUDED.archived_at,
    updated_at = EXCLUDED.updated_at,
    created_at = EXCLUDED.created_at;

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
        'document_action_archive_notes',
        'workspace_action_test',
        'project_action_archive_target',
        'member_action_owner',
        'Action Archive Notes',
        'published',
        NULL,
        '2026-01-01T00:21:00.000Z',
        '2026-01-01T00:11:00.000Z'
    ),
    (
        'document_action_archive_checklist',
        'workspace_action_test',
        'project_action_archive_target',
        'member_action_owner',
        'Action Archive Checklist',
        'draft',
        NULL,
        '2026-01-01T00:22:00.000Z',
        '2026-01-01T00:12:00.000Z'
    )
ON CONFLICT (id) DO UPDATE
SET
    workspace_id = EXCLUDED.workspace_id,
    project_id = EXCLUDED.project_id,
    owner_member_id = EXCLUDED.owner_member_id,
    title = EXCLUDED.title,
    state = EXCLUDED.state,
    archived_at = EXCLUDED.archived_at,
    updated_at = EXCLUDED.updated_at,
    created_at = EXCLUDED.created_at;
`);
}

async function readProjectStatus(executor: Client, projectId: string): Promise<string> {
    const result = await executor.query<{ readonly status: string }>(
        `
SELECT status
FROM demo_projects
WHERE id = $1
`,
        [projectId],
    );

    const row = result.rows[0];

    if (row === undefined) {
        throw new Error(`Project "${projectId}" was not found.`);
    }

    return row.status;
}
