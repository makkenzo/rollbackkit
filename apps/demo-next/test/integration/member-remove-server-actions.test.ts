import { createPostgresMigrationRunner } from '@rollbackkit/postgres';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { undoDemoActionRun } from '../../app/actions/action-runs';
import { executeMemberRemove, previewMemberRemove } from '../../app/actions/member-remove';
import { closeDemoPostgresPool } from '../../lib/server/demo-db';
import { readDemoSql } from '../helpers/demo-sql';

const databaseUrl = process.env.ROLLBACKKIT_DEMO_DATABASE_URL;
const describeIntegration = databaseUrl === undefined ? describe.skip : describe;

let client: Client | undefined;

describeIntegration('member.remove server actions', () => {
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
        await seedServerActionMemberRemoveData(client);
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
  AND target_id IN ($2, $3)
`,
                ['workspace_acme', 'member_server_action_remove_target', 'member_ada'],
            )
            .catch(() => undefined);

        await client
            .query(
                `
DELETE FROM demo_documents
WHERE id = $1
`,
                ['document_server_action_remove_owned'],
            )
            .catch(() => undefined);

        await client
            .query(
                `
DELETE FROM demo_projects
WHERE id = $1
`,
                ['project_server_action_remove_owned'],
            )
            .catch(() => undefined);

        await client
            .query(
                `
DELETE FROM demo_members
WHERE id = $1
`,
                ['member_server_action_remove_target'],
            )
            .catch(() => undefined);

        await client.end().catch(() => undefined);
        client = undefined;
    });

    it('previews, executes and undoes member removal through server actions', async () => {
        const preview = await previewMemberRemove('member_server_action_remove_target');

        expect(preview.ok).toBe(true);

        if (!preview.ok) {
            throw new Error(preview.error.message);
        }

        expect(preview.data).toMatchObject({
            title: 'Remove Server Action Remove Target',
            reversibility: {
                kind: 'full',
                undoable: true,
            },
            undoWindowMs: 1_800_000,
        });
        expect(preview.data.impact.map((item) => item.label)).toEqual([
            'Member loses workspace access',
            '1 owned project becomes unassigned',
            '1 owned document becomes unassigned',
            'Previous membership state will be saved for undo',
        ]);

        const executed = await executeMemberRemove(
            'member_server_action_remove_target',
            'test:member.remove:server-action',
        );

        expect(executed.ok).toBe(true);

        if (!executed.ok) {
            throw new Error(executed.error.message);
        }

        expect(executed.data).toMatchObject({
            name: 'member.remove',
            status: 'completed',
            canUndo: true,
            target: {
                id: 'member_server_action_remove_target',
                type: 'member',
                label: 'Server Action Remove Target',
            },
        });

        await expect(readMemberExists('member_server_action_remove_target')).resolves.toBe(false);
        await expect(readProjectOwner('project_server_action_remove_owned')).resolves.toBe(null);
        await expect(readDocumentOwner('document_server_action_remove_owned')).resolves.toBe(null);

        const undone = await undoDemoActionRun(executed.data.id);

        expect(undone.ok).toBe(true);

        if (!undone.ok) {
            throw new Error(undone.error.message);
        }

        expect(undone.data).toMatchObject({
            id: executed.data.id,
            status: 'undone',
            canUndo: false,
        });

        await expect(readMemberExists('member_server_action_remove_target')).resolves.toBe(true);
        await expect(readProjectOwner('project_server_action_remove_owned')).resolves.toBe(
            'member_server_action_remove_target',
        );
        await expect(readDocumentOwner('document_server_action_remove_owned')).resolves.toBe(
            'member_server_action_remove_target',
        );
    });

    it('returns a typed failure for owner removal preview', async () => {
        const preview = await previewMemberRemove('member_ada');

        expect(preview).toEqual({
            ok: false,
            error: {
                code: 'ACTION_CONFLICT',
                message:
                    'Member "member_ada" cannot be removed safely: Owner members cannot be removed in the demo action.',
            },
        });
    });
});

async function seedServerActionMemberRemoveData(executor: Client): Promise<void> {
    await executor.query(`
INSERT INTO demo_members (id, workspace_id, name, email, role)
VALUES (
    'member_server_action_remove_target',
    'workspace_acme',
    'Server Action Remove Target',
    'server-action-remove-target@example.com',
    'admin'
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
    'project_server_action_remove_owned',
    'workspace_acme',
    'Server Action Remove Owned Project',
    'member_server_action_remove_target',
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
VALUES (
    'document_server_action_remove_owned',
    'workspace_acme',
    'project_server_action_remove_owned',
    'member_server_action_remove_target',
    'Server Action Remove Owned Document',
    'published',
    NULL,
    '2026-01-01T00:20:00.000Z',
    '2026-01-01T00:10:00.000Z'
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

async function readMemberExists(memberId: string): Promise<boolean> {
    const currentClient = requireClient();

    const result = await currentClient.query<{ readonly exists: boolean }>(
        `
SELECT EXISTS (
    SELECT 1
    FROM demo_members
    WHERE id = $1
) AS exists
`,
        [memberId],
    );

    return result.rows[0]?.exists ?? false;
}

async function readProjectOwner(projectId: string): Promise<string | null> {
    const currentClient = requireClient();

    const result = await currentClient.query<{ readonly owner_member_id: string | null }>(
        `
SELECT owner_member_id
FROM demo_projects
WHERE id = $1
`,
        [projectId],
    );

    return result.rows[0]?.owner_member_id ?? null;
}

async function readDocumentOwner(documentId: string): Promise<string | null> {
    const currentClient = requireClient();

    const result = await currentClient.query<{ readonly owner_member_id: string | null }>(
        `
SELECT owner_member_id
FROM demo_documents
WHERE id = $1
`,
        [documentId],
    );

    return result.rows[0]?.owner_member_id ?? null;
}

function requireClient(): Client {
    if (client === undefined) {
        throw new Error('Expected PostgreSQL client to be initialized.');
    }

    return client;
}
