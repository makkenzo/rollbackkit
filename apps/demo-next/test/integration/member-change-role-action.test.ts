import type { ActionActor } from '@rollbackkit/core';
import { createPostgresMigrationRunner } from '@rollbackkit/postgres';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MEMBER_CHANGE_ROLE_ACTION_NAME } from '../../lib/server/actions/member-change-role.action';
import { changeDemoMemberRole } from '../../lib/server/repositories/member-repository';
import { createDemoRollbackKit } from '../../lib/server/rollbackkit';
import { readDemoSql } from '../helpers/demo-sql';

const databaseUrl = process.env.ROLLBACKKIT_DEMO_DATABASE_URL;
const describeIntegration = databaseUrl === undefined ? describe.skip : describe;

const actor: ActionActor = {
    id: 'member_action_owner',
    type: 'user',
    displayName: 'Action Owner',
};

let client: Client | undefined;

describeIntegration('member.change_role action', () => {
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

    it('previews, executes and undoes member role change', async () => {
        const currentClient = requireClient();
        const rollbackkit = createDemoRollbackKit(currentClient);

        const preview = await rollbackkit.preview({
            name: MEMBER_CHANGE_ROLE_ACTION_NAME,
            actor,
            tenantId: 'workspace_action_test',
            input: {
                workspaceId: 'workspace_action_test',
                memberId: 'member_action_role_target',
                role: 'admin',
            },
        });

        expect(preview).toMatchObject({
            title: 'Change Action Role Target role',
            reversibility: {
                kind: 'full',
                undoable: true,
            },
        });

        expect(preview.impact.map((item) => item.label)).toEqual([
            'Role changes from Viewer to Admin',
            'Previous member role will be saved for undo',
            'Undo is available for 30 minutes',
        ]);

        const run = await rollbackkit.execute({
            name: MEMBER_CHANGE_ROLE_ACTION_NAME,
            actor,
            tenantId: 'workspace_action_test',
            input: {
                workspaceId: 'workspace_action_test',
                memberId: 'member_action_role_target',
                role: 'admin',
            },
        });

        expect(run).toMatchObject({
            name: MEMBER_CHANGE_ROLE_ACTION_NAME,
            status: 'completed',
            tenantId: 'workspace_action_test',
            target: {
                id: 'member_action_role_target',
                type: 'member',
                label: 'Action Role Target',
                metadata: {
                    email: 'action-role-target@example.com',
                    role: 'viewer',
                },
            },
            result: {
                memberId: 'member_action_role_target',
                role: 'admin',
                previousRole: 'viewer',
            },
        });

        await expect(readMemberRole(currentClient, 'member_action_role_target')).resolves.toBe(
            'admin',
        );

        const snapshotResult = await currentClient.query<{
            readonly key: string;
            readonly value: {
                readonly memberId: string;
                readonly previousRole: string;
                readonly changedToRole: string;
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
            key: 'previousMemberRole',
            value: {
                memberId: 'member_action_role_target',
                previousRole: 'viewer',
                changedToRole: 'admin',
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
                memberId: 'member_action_role_target',
                role: 'viewer',
                previousRole: 'admin',
            },
        });

        await expect(readMemberRole(currentClient, 'member_action_role_target')).resolves.toBe(
            'viewer',
        );
    });

    it('blocks undo and stores conflict details when the member role changed again', async () => {
        const currentClient = requireClient();
        const rollbackkit = createDemoRollbackKit(currentClient);

        const run = await rollbackkit.execute({
            name: MEMBER_CHANGE_ROLE_ACTION_NAME,
            actor,
            tenantId: 'workspace_action_test',
            input: {
                workspaceId: 'workspace_action_test',
                memberId: 'member_action_role_target',
                role: 'admin',
            },
        });

        await setMemberRole(currentClient, 'member_action_role_target', 'viewer');

        await expect(
            rollbackkit.undo({
                actionRunId: run.id,
                actor,
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_CONFLICT',
            details: {
                reason: 'Expected current role "admin", but found "viewer".',
            },
        });

        await expect(readMemberRole(currentClient, 'member_action_role_target')).resolves.toBe(
            'viewer',
        );

        const failedRun = await rollbackkit.getActionRun(run.id);

        expect(failedRun).toMatchObject({
            id: run.id,
            status: 'undo_failed',
        });

        const conflicts = await rollbackkit.getConflicts(run.id);

        expect(conflicts).toHaveLength(1);
        expect(conflicts[0]).toMatchObject({
            actionRunId: run.id,
            reason: 'Expected current role "admin", but found "viewer".',
            details: {
                expectedState: 'Member role is Admin',
                actualState: 'Member role is Viewer',
                suggestedNextStep: 'Review the current member role before retrying undo.',
            },
        });
    });

    it('rejects stale member role writes', async () => {
        const currentClient = requireClient();

        await setMemberRole(currentClient, 'member_action_role_target', 'admin');

        await expect(
            changeDemoMemberRole(
                currentClient,
                'workspace_action_test',
                'member_action_role_target',
                'viewer',
                'admin',
            ),
        ).resolves.toBeNull();

        await expect(readMemberRole(currentClient, 'member_action_role_target')).resolves.toBe(
            'admin',
        );
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
VALUES
    (
        'member_action_owner',
        'workspace_action_test',
        'Action Owner',
        'action-owner@example.com',
        'owner'
    ),
    (
        'member_action_role_target',
        'workspace_action_test',
        'Action Role Target',
        'action-role-target@example.com',
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

async function readMemberRole(executor: Client, memberId: string): Promise<string> {
    const result = await executor.query<{ readonly role: string }>(
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

async function setMemberRole(executor: Client, memberId: string, role: string): Promise<void> {
    await executor.query(
        `
UPDATE demo_members
SET role = $2
WHERE id = $1
`,
        [memberId, role],
    );
}
