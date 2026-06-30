import { createPostgresMigrationRunner } from '@rollbackkit/postgres';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    executeProjectArchive,
    previewProjectArchive,
    undoDemoActionRun,
} from '../../app/actions/project-archive';
import { closeDemoPostgresPool } from '../../lib/server/demo-db';
import { readDemoSql } from '../helpers/demo-sql';

const databaseUrl = process.env.ROLLBACKKIT_DEMO_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIntegration = databaseUrl === undefined ? describe.skip : describe;

let client: Client | undefined;

describeIntegration('project.archive server actions', () => {
    beforeEach(async () => {
        client = new Client({
            connectionString: databaseUrl,
        });

        await client.connect();

        await createPostgresMigrationRunner({
            executor: client,
        }).migrate();

        await client.query(await readDemoSql('db/schema.sql'));
        await client.query(await readDemoSql('db/seed.sql'));
        await seedServerActionProject(client);
    });

    afterEach(async () => {
        await closeDemoPostgresPool();

        if (client === undefined) {
            return;
        }

        await client
            .query(
                `
DELETE FROM rollbackkit_action_runs
WHERE tenant_id = $1
  AND target_id = $2
`,
                ['workspace_acme', 'project_server_action_archive_target'],
            )
            .catch(() => undefined);

        await client
            .query(
                `
DELETE FROM demo_documents
WHERE id = $1
`,
                ['document_server_action_archive_notes'],
            )
            .catch(() => undefined);

        await client
            .query(
                `
DELETE FROM demo_projects
WHERE id = $1
`,
                ['project_server_action_archive_target'],
            )
            .catch(() => undefined);

        await client.end().catch(() => undefined);
        client = undefined;
    });

    it('previews, executes and undoes project archive through server actions', async () => {
        const preview = await previewProjectArchive('project_server_action_archive_target');

        expect(preview.ok).toBe(true);

        if (!preview.ok) {
            throw new Error(preview.error.message);
        }

        expect(preview.data).toMatchObject({
            title: 'Archive Server Action Archive Target',
            reversibility: {
                kind: 'full',
                undoable: true,
            },
        });

        expect(preview.data.impact.map((item) => item.label)).toEqual([
            'Project moves to archived state',
            '1 document remains attached',
            'Previous project state will be saved for undo',
        ]);

        const executed = await executeProjectArchive('project_server_action_archive_target');

        expect(executed.ok).toBe(true);

        if (!executed.ok) {
            throw new Error(executed.error.message);
        }

        expect(executed.data).toMatchObject({
            name: 'project.archive',
            status: 'completed',
            tenantId: 'workspace_acme',
            target: {
                id: 'project_server_action_archive_target',
                type: 'project',
                label: 'Server Action Archive Target',
            },
            result: {
                projectId: 'project_server_action_archive_target',
                status: 'archived',
                archivedAt: expect.any(String),
            },
        });

        await expect(readProjectStatus('project_server_action_archive_target')).resolves.toBe(
            'archived',
        );

        const undone = await undoDemoActionRun(executed.data.id);

        expect(undone.ok).toBe(true);

        if (!undone.ok) {
            throw new Error(undone.error.message);
        }

        expect(undone.data).toMatchObject({
            id: executed.data.id,
            status: 'undone',
            undoResult: {
                projectId: 'project_server_action_archive_target',
                status: 'active',
                archivedAt: null,
            },
        });

        await expect(readProjectStatus('project_server_action_archive_target')).resolves.toBe(
            'active',
        );
    });

    it('returns a typed failure for missing project preview', async () => {
        const preview = await previewProjectArchive('missing_project');

        expect(preview).toEqual({
            ok: false,
            error: {
                code: 'ACTION_NOT_FOUND',
                message: 'Project "missing_project" was not found.',
                details: {
                    projectId: 'missing_project',
                },
            },
        });
    });
});

async function seedServerActionProject(executor: Client): Promise<void> {
    await executor.query(`
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
    'project_server_action_archive_target',
    'workspace_acme',
    'Server Action Archive Target',
    'member_ada',
    'active',
    NULL,
    '2026-01-01T00:30:00.000Z',
    '2026-01-01T00:25:00.000Z'
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
VALUES (
    'document_server_action_archive_notes',
    'workspace_acme',
    'project_server_action_archive_target',
    'member_ada',
    'Server Action Archive Notes',
    'published',
    NULL,
    '2026-01-01T00:31:00.000Z',
    '2026-01-01T00:26:00.000Z'
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

async function readProjectStatus(projectId: string): Promise<string> {
    const currentClient = requireClient();

    const result = await currentClient.query<{ readonly status: string }>(
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

function requireClient(): Client {
    if (client === undefined) {
        throw new Error('Expected PostgreSQL client to be initialized.');
    }

    return client;
}
