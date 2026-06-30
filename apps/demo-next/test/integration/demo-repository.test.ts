import { afterAll, describe, expect, it } from 'vitest';

import { closeDemoPostgresPool } from '../../lib/server/demo-db';
import { getDemoDashboardData } from '../../lib/server/demo-repository';

const databaseUrl = process.env.ROLLBACKKIT_DEMO_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIntegration = databaseUrl === undefined ? describe.skip : describe;

describeIntegration('demo repository', () => {
    afterAll(async () => {
        await closeDemoPostgresPool();
    });

    it('loads seeded dashboard data from PostgreSQL', async () => {
        const dashboard = await getDemoDashboardData();

        expect(dashboard.workspace).toEqual({
            name: 'Acme Cloud',
            label: 'Acme Cloud workspace',
            description:
                'Preview impact, execute safely, preserve an audit trail and undo supported actions before the rollback window expires.',
            undoWindowLabel: '30m',
        });

        expect(dashboard.projects.map((project) => project.name)).toEqual([
            'Billing Revamp',
            'Customer Onboarding',
            'Legacy Import',
        ]);

        expect(dashboard.projects.map((project) => project.status)).toEqual([
            'Active',
            'Active',
            'Archived',
        ]);

        expect(dashboard.members.map((member) => `${member.name}:${member.role}`)).toEqual([
            'Ada Lovelace:Owner',
            'Grace Hopper:Admin',
            'Alan Turing:Viewer',
        ]);

        expect(
            dashboard.documents.map((document) => `${document.title}:${document.state}`),
        ).toEqual([
            'Security Review Notes:Published',
            'Bulk Import Checklist:Draft',
            'Archived Contract:Archived',
        ]);
    });
});
