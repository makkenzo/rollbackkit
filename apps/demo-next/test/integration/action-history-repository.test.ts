import type { ActionActor } from '@rollbackkit/core';
import { createPostgresMigrationRunner } from '@rollbackkit/postgres';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDemoActionHistory } from '../../lib/server/action-history-repository';
import { MEMBER_CHANGE_ROLE_ACTION_NAME } from '../../lib/server/actions/member-change-role.action';
import { MEMBER_REMOVE_ACTION_NAME } from '../../lib/server/actions/member-remove.action';
import { PROJECT_ARCHIVE_ACTION_NAME } from '../../lib/server/actions/project-archive.action';
import { closeDemoPostgresPool } from '../../lib/server/demo-db';
import { createDemoRollbackKit } from '../../lib/server/rollbackkit';
import { readDemoSql } from '../helpers/demo-sql';

const databaseUrl = process.env.ROLLBACKKIT_DEMO_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIntegration = databaseUrl === undefined ? describe.skip : describe;

const actor: ActionActor = {
    id: 'member_ada',
    type: 'user',
    displayName: 'Ada Lovelace',
};

let client: Client | undefined;

describeIntegration('action history repository', () => {
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
        await deleteDemoActionRuns(client);
    });

    afterEach(async () => {
        await closeDemoPostgresPool();

        if (client === undefined) {
            return;
        }

        await deleteDemoActionRuns(client);

        await client
            .query('DELETE FROM demo_workspaces WHERE id = $1', ['workspace_action_test'])
            .catch(() => undefined);

        await client.end().catch(() => undefined);
        client = undefined;
    });

    it('loads RollbackKit action history for the demo tenant only', async () => {
        const currentClient = requireClient();
        const rollbackkit = createDemoRollbackKit(currentClient);

        await rollbackkit.execute({
            name: PROJECT_ARCHIVE_ACTION_NAME,
            actor,
            tenantId: 'workspace_acme',
            input: {
                workspaceId: 'workspace_acme',
                projectId: 'project_billing',
            },
        });

        await seedHiddenTenantProject(currentClient);

        await rollbackkit.execute({
            name: PROJECT_ARCHIVE_ACTION_NAME,
            actor: {
                id: 'member_action_test',
                type: 'user',
                displayName: 'Action Test',
            },
            tenantId: 'workspace_action_test',
            input: {
                workspaceId: 'workspace_action_test',
                projectId: 'project_action_history_hidden',
            },
        });

        const history = await getDemoActionHistory();

        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({
            actionName: PROJECT_ARCHIVE_ACTION_NAME,
            targetLabel: 'Billing Revamp',
            actorLabel: 'Ada Lovelace',
            statusLabel: 'Undo available',
            statusTone: 'warning',
            canUndo: true,
        });

        expect(history[0]?.undoExpiresAt).toBeDefined();

        expect(history.map((entry) => entry.targetLabel)).not.toContain(
            'Hidden Action History Target',
        );
    });

    it('loads member remove history before and after undo', async () => {
        const currentClient = requireClient();
        const rollbackkit = createDemoRollbackKit(currentClient);

        await seedActionHistoryMemberRemoval(currentClient);

        const run = await rollbackkit.execute({
            name: MEMBER_REMOVE_ACTION_NAME,
            actor,
            tenantId: 'workspace_acme',
            input: {
                workspaceId: 'workspace_acme',
                memberId: 'member_action_history_remove_target',
            },
        });

        const completedHistory = await getDemoActionHistory();

        expect(completedHistory[0]).toMatchObject({
            id: run.id,
            actionName: MEMBER_REMOVE_ACTION_NAME,
            targetLabel: 'Action History Remove Target',
            actorLabel: 'Ada Lovelace',
            statusLabel: 'Undo available',
            statusTone: 'warning',
            canUndo: true,
        });
        expect(completedHistory[0]?.undoExpiresAt).toBeDefined();

        await rollbackkit.undo({
            actionRunId: run.id,
            actor,
        });

        const undoneHistory = await getDemoActionHistory();

        expect(undoneHistory[0]).toMatchObject({
            id: run.id,
            actionName: MEMBER_REMOVE_ACTION_NAME,
            targetLabel: 'Action History Remove Target',
            actorLabel: 'Ada Lovelace',
            statusLabel: 'Undone',
            statusTone: 'neutral',
            canUndo: false,
        });
    });

    it('loads failed member remove history', async () => {
        const currentClient = requireClient();
        const rollbackkit = createDemoRollbackKit(currentClient);

        await expect(
            rollbackkit.execute({
                name: MEMBER_REMOVE_ACTION_NAME,
                actor,
                tenantId: 'workspace_acme',
                input: {
                    workspaceId: 'workspace_acme',
                    memberId: 'member_ada',
                },
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_CONFLICT',
        });

        const history = await getDemoActionHistory();

        expect(history[0]).toMatchObject({
            actionName: MEMBER_REMOVE_ACTION_NAME,
            targetLabel: 'Ada Lovelace',
            actorLabel: 'Ada Lovelace',
            statusLabel: 'Failed',
            statusTone: 'danger',
            canUndo: false,
        });
    });

    it('loads conflict details for blocked undo history', async () => {
        const currentClient = requireClient();
        const rollbackkit = createDemoRollbackKit(currentClient);

        await seedActionHistoryRoleChange(currentClient);

        const run = await rollbackkit.execute({
            name: MEMBER_CHANGE_ROLE_ACTION_NAME,
            actor,
            tenantId: 'workspace_acme',
            input: {
                workspaceId: 'workspace_acme',
                memberId: 'member_action_history_role_target',
                role: 'admin',
            },
        });

        await setMemberRole(currentClient, 'member_action_history_role_target', 'viewer');

        await expect(
            rollbackkit.undo({
                actionRunId: run.id,
                actor,
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_CONFLICT',
        });

        const history = await getDemoActionHistory();

        expect(history[0]).toMatchObject({
            id: run.id,
            actionName: MEMBER_CHANGE_ROLE_ACTION_NAME,
            targetLabel: 'Action History Role Target',
            statusLabel: 'Undo blocked',
            statusTone: 'danger',
            canUndo: false,
            conflict: {
                reason: 'Expected current role "admin", but found "viewer".',
                expectedState: 'Member role is Admin',
                actualState: 'Member role is Viewer',
                suggestedNextStep: 'Review the current member role before retrying undo.',
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

async function deleteDemoActionRuns(executor: Client): Promise<void> {
    await executor.query(
        `
DELETE FROM rollbackkit_action_runs
WHERE tenant_id IN ('workspace_acme', 'workspace_action_test')
`,
    );
}

async function seedHiddenTenantProject(executor: Client): Promise<void> {
    await executor.query(`
INSERT INTO demo_workspaces (id, slug, name)
VALUES ('workspace_action_test', 'action-test', 'Action Test')
ON CONFLICT (id) DO UPDATE
SET
    slug = EXCLUDED.slug,
    name = EXCLUDED.name;

INSERT INTO demo_members (id, workspace_id, name, email, role)
VALUES (
    'member_action_test',
    'workspace_action_test',
    'Action Test',
    'action-test@example.com',
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
    'project_action_history_hidden',
    'workspace_action_test',
    'Hidden Action History Target',
    'member_action_test',
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
`);
}

async function seedActionHistoryMemberRemoval(executor: Client): Promise<void> {
    await executor.query(`
INSERT INTO demo_members (id, workspace_id, name, email, role)
VALUES (
    'member_action_history_remove_target',
    'workspace_acme',
    'Action History Remove Target',
    'action-history-remove-target@example.com',
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
    'project_action_history_member_remove_owned',
    'workspace_acme',
    'Action History Member Remove Owned Project',
    'member_action_history_remove_target',
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
`);
}

async function seedActionHistoryRoleChange(executor: Client): Promise<void> {
    await executor.query(`
INSERT INTO demo_members (id, workspace_id, name, email, role)
VALUES (
    'member_action_history_role_target',
    'workspace_acme',
    'Action History Role Target',
    'action-history-role-target@example.com',
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
