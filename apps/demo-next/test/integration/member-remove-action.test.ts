import type { ActionActor } from '@rollbackkit/core';
import { createPostgresMigrationRunner } from '@rollbackkit/postgres';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MEMBER_REMOVE_ACTION_NAME } from '../../lib/server/actions/member-remove.action';
import { createDemoRollbackKit } from '../../lib/server/rollbackkit';
import { readDemoSql } from '../helpers/demo-sql';

const databaseUrl = process.env.ROLLBACKKIT_DEMO_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIntegration = databaseUrl === undefined ? describe.skip : describe;

const actor: ActionActor = {
    id: 'member_remove_actor',
    type: 'user',
    displayName: 'Member Remove Actor',
};

let client: Client | undefined;

describeIntegration('member.remove action', () => {
    beforeEach(async () => {
        client = new Client({
            connectionString: databaseUrl,
        });

        await client.connect();

        await createPostgresMigrationRunner({
            executor: client,
        }).migrate();

        await client.query(await readDemoSql('db/schema.sql'));
        await seedMemberRemoveTestData(client);
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
                ['workspace_member_remove_test'],
            )
            .catch(() => undefined);

        await client
            .query('DELETE FROM demo_workspaces WHERE id = $1', ['workspace_member_remove_test'])
            .catch(() => undefined);

        await client.end().catch(() => undefined);
        client = undefined;
    });

    it('previews, executes and undoes member removal', async () => {
        const currentClient = requireClient();
        const rollbackkit = createDemoRollbackKit(currentClient);

        const preview = await rollbackkit.preview({
            name: MEMBER_REMOVE_ACTION_NAME,
            actor,
            tenantId: 'workspace_member_remove_test',
            input: {
                memberId: 'member_remove_target',
            },
        });

        expect(preview).toMatchObject({
            title: 'Remove Member Remove Target',
            summary:
                'The member will be removed from the workspace. Their previous membership state will be saved for undo.',
            reversibility: {
                kind: 'full',
                undoable: true,
            },
            undoWindowMs: 1_800_000,
        });
        expect(preview.impact.map((item) => item.label)).toEqual([
            'Member loses workspace access',
            '1 owned project becomes unassigned',
            '1 owned document becomes unassigned',
            'Previous membership state will be saved for undo',
        ]);

        const run = await rollbackkit.execute({
            name: MEMBER_REMOVE_ACTION_NAME,
            actor,
            tenantId: 'workspace_member_remove_test',
            input: {
                memberId: 'member_remove_target',
            },
        });

        expect(run).toMatchObject({
            name: MEMBER_REMOVE_ACTION_NAME,
            status: 'completed',
            tenantId: 'workspace_member_remove_test',
            target: {
                id: 'member_remove_target',
                type: 'member',
                label: 'Member Remove Target',
                metadata: {
                    email: 'member-remove-target@example.com',
                    role: 'admin',
                },
            },
            result: {
                memberId: 'member_remove_target',
                status: 'removed',
                role: 'admin',
                projectOwnerLinksCleared: 1,
                documentOwnerLinksCleared: 1,
            },
            metadata: {
                memberName: 'Member Remove Target',
            },
        });

        await expect(readMemberExists(currentClient, 'member_remove_target')).resolves.toBe(false);
        await expect(readProjectOwner(currentClient, 'project_member_remove_owned')).resolves.toBe(
            null,
        );
        await expect(
            readDocumentOwner(currentClient, 'document_member_remove_owned'),
        ).resolves.toBe(null);

        const snapshotResult = await currentClient.query<{
            readonly key: string;
            readonly value: {
                readonly memberId: string;
                readonly role: string;
                readonly ownedProjectIds: readonly string[];
                readonly ownedDocumentIds: readonly string[];
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
            key: 'removedMemberState',
            value: {
                memberId: 'member_remove_target',
                role: 'admin',
                ownedProjectIds: ['project_member_remove_owned'],
                ownedDocumentIds: ['document_member_remove_owned'],
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
                memberId: 'member_remove_target',
                status: 'restored',
                role: 'admin',
                projectOwnerLinksRestored: 1,
                documentOwnerLinksRestored: 1,
            },
        });

        await expect(readMemberExists(currentClient, 'member_remove_target')).resolves.toBe(true);
        await expect(readProjectOwner(currentClient, 'project_member_remove_owned')).resolves.toBe(
            'member_remove_target',
        );
        await expect(readDocumentOwner(currentClient, 'document_member_remove_owned')).resolves.toBe(
            'member_remove_target',
        );
    });

    it('blocks owner removal', async () => {
        const currentClient = requireClient();
        const rollbackkit = createDemoRollbackKit(currentClient);

        await expect(
            rollbackkit.preview({
                name: MEMBER_REMOVE_ACTION_NAME,
                actor,
                tenantId: 'workspace_member_remove_test',
                input: {
                    memberId: 'member_remove_owner',
                },
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_CONFLICT',
            message:
                'Member "member_remove_owner" cannot be removed safely: Owner members cannot be removed in the demo action.',
            details: {
                memberId: 'member_remove_owner',
                reason: 'Owner members cannot be removed in the demo action.',
            },
        });
    });
});

function requireClient(): Client {
    if (client === undefined) {
        throw new Error('Expected PostgreSQL client to be initialized.');
    }

    return client;
}

async function seedMemberRemoveTestData(executor: Client): Promise<void> {
    await executor.query(`
INSERT INTO demo_workspaces (id, slug, name)
VALUES ('workspace_member_remove_test', 'member-remove-test', 'Member Remove Test')
ON CONFLICT (id) DO UPDATE
SET
    slug = EXCLUDED.slug,
    name = EXCLUDED.name;

INSERT INTO demo_members (id, workspace_id, name, email, role)
VALUES
    (
        'member_remove_actor',
        'workspace_member_remove_test',
        'Member Remove Actor',
        'member-remove-actor@example.com',
        'owner'
    ),
    (
        'member_remove_owner',
        'workspace_member_remove_test',
        'Member Remove Owner',
        'member-remove-owner@example.com',
        'owner'
    ),
    (
        'member_remove_target',
        'workspace_member_remove_test',
        'Member Remove Target',
        'member-remove-target@example.com',
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
    'project_member_remove_owned',
    'workspace_member_remove_test',
    'Member Remove Owned Project',
    'member_remove_target',
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
    'document_member_remove_owned',
    'workspace_member_remove_test',
    'project_member_remove_owned',
    'member_remove_target',
    'Member Remove Owned Document',
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

async function readMemberExists(executor: Client, memberId: string): Promise<boolean> {
    const result = await executor.query<{ readonly exists: boolean }>(
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

async function readProjectOwner(executor: Client, projectId: string): Promise<string | null> {
    const result = await executor.query<{ readonly owner_member_id: string | null }>(
        `
SELECT owner_member_id
FROM demo_projects
WHERE id = $1
`,
        [projectId],
    );

    return result.rows[0]?.owner_member_id ?? null;
}

async function readDocumentOwner(executor: Client, documentId: string): Promise<string | null> {
    const result = await executor.query<{ readonly owner_member_id: string | null }>(
        `
SELECT owner_member_id
FROM demo_documents
WHERE id = $1
`,
        [documentId],
    );

    return result.rows[0]?.owner_member_id ?? null;
}
