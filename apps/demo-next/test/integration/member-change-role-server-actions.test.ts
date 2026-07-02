import { createPostgresMigrationRunner } from '@rollbackkit/postgres';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { undoDemoActionRun } from '../../app/actions/action-runs';
import {
    executeMemberRoleChange,
    previewMemberRoleChange,
} from '../../app/actions/member-change-role';
import { closeDemoPostgresPool } from '../../lib/server/demo-db';
import { readDemoSql } from '../helpers/demo-sql';

const databaseUrl = process.env.ROLLBACKKIT_DEMO_DATABASE_URL;
const describeIntegration = databaseUrl === undefined ? describe.skip : describe;

let client: Client | undefined;

describeIntegration('member.change_role server actions', () => {
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
        await seedServerActionMember(client);
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
                ['workspace_acme', 'member_server_action_role_target'],
            )
            .catch(() => undefined);

        await client
            .query(
                `
DELETE FROM demo_members
WHERE id = $1
`,
                ['member_server_action_role_target'],
            )
            .catch(() => undefined);

        await client.end().catch(() => undefined);
        client = undefined;
    });

    it('previews, executes and undoes member role change through server actions', async () => {
        const preview = await previewMemberRoleChange('member_server_action_role_target', 'admin');

        expect(preview.ok).toBe(true);

        if (!preview.ok) {
            throw new Error(preview.error.message);
        }

        expect(preview.data).toMatchObject({
            title: 'Change Server Action Role Target role',
            reversibility: {
                kind: 'full',
                undoable: true,
            },
        });

        expect(preview.data.impact.map((item) => item.label)).toEqual([
            'Role changes from Viewer to Admin',
            'Previous member role will be saved for undo',
            'Undo is available for 30 minutes',
        ]);

        const executed = await executeMemberRoleChange(
            'member_server_action_role_target',
            'admin',
            'test:member.change_role:server-action',
        );

        expect(executed.ok).toBe(true);

        if (!executed.ok) {
            throw new Error(executed.error.message);
        }

        expect(executed.data).toMatchObject({
            name: 'member.change_role',
            status: 'completed',
            canUndo: true,
            target: {
                id: 'member_server_action_role_target',
                type: 'member',
                label: 'Server Action Role Target',
            },
        });

        await expect(readMemberRole('member_server_action_role_target')).resolves.toBe('admin');

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

        await expect(readMemberRole('member_server_action_role_target')).resolves.toBe('viewer');
    });

    it('returns conflict details when undo is blocked by a later role change', async () => {
        const executed = await executeMemberRoleChange(
            'member_server_action_role_target',
            'admin',
            'test:member.change_role:server-action-conflict',
        );

        expect(executed.ok).toBe(true);

        if (!executed.ok) {
            throw new Error(executed.error.message);
        }

        await setMemberRole('member_server_action_role_target', 'viewer');

        const undone = await undoDemoActionRun(executed.data.id);

        expect(undone).toEqual({
            ok: false,
            error: {
                code: 'ACTION_CONFLICT',
                message:
                    'Member "member_server_action_role_target" role cannot be changed safely: Expected current role "admin", but found "viewer".',
                conflict: {
                    reason: 'Expected current role "admin", but found "viewer".',
                    expectedState: 'Member role is Admin',
                    actualState: 'Member role is Viewer',
                    suggestedNextStep: 'Review the current member role before retrying undo.',
                },
            },
        });
    });

    it('returns a typed failure for missing member preview', async () => {
        const preview = await previewMemberRoleChange('missing_member', 'admin');

        expect(preview).toEqual({
            ok: false,
            error: {
                code: 'ACTION_NOT_FOUND',
                message: 'Member "missing_member" was not found.',
            },
        });
    });
});

async function seedServerActionMember(executor: Client): Promise<void> {
    await executor.query(`
INSERT INTO demo_members (id, workspace_id, name, email, role)
VALUES (
    'member_server_action_role_target',
    'workspace_acme',
    'Server Action Role Target',
    'server-action-role-target@example.com',
    'viewer'
)
ON CONFLICT (id) DO UPDATE
SET
    workspace_id = EXCLUDED.workspace_id,
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    role = EXCLUDED.role;
`);
}

async function readMemberRole(memberId: string): Promise<string> {
    const currentClient = requireClient();

    const result = await currentClient.query<{ readonly role: string }>(
        `
SELECT role
FROM demo_members
WHERE id = $1
`,
        [memberId],
    );

    const row = result.rows[0];

    if (row === undefined) {
        throw new Error(`Member "${memberId}" was not found.`);
    }

    return row.role;
}

async function setMemberRole(memberId: string, role: string): Promise<void> {
    const currentClient = requireClient();

    await currentClient.query(
        `
UPDATE demo_members
SET role = $2
WHERE id = $1
`,
        [memberId, role],
    );
}

function requireClient(): Client {
    if (client === undefined) {
        throw new Error('Expected PostgreSQL client to be initialized.');
    }

    return client;
}
