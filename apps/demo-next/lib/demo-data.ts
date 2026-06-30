import type {
    DemoAuditEntry,
    DemoDocument,
    DemoMember,
    DemoPreviewImpact,
    DemoProject,
    DemoWorkspace,
} from './demo-domain';

export const demoWorkspace: DemoWorkspace = {
    name: 'Acme Cloud',
    label: 'Acme Cloud workspace',
    description:
        'Preview impact, execute safely, preserve an audit trail and undo supported actions before the rollback window expires.',
    undoWindowLabel: '30m',
};

export const demoProjects: readonly DemoProject[] = [
    {
        id: 'PRJ-001',
        name: 'Billing Revamp',
        owner: 'Ada Lovelace',
        status: 'Active',
        updatedAt: '4m ago',
    },
    {
        id: 'PRJ-002',
        name: 'Customer Onboarding',
        owner: 'Grace Hopper',
        status: 'Active',
        updatedAt: '18m ago',
    },
    {
        id: 'PRJ-003',
        name: 'Legacy Import',
        owner: 'Alan Turing',
        status: 'Archived',
        updatedAt: '1d ago',
    },
];

export const demoMembers: readonly DemoMember[] = [
    {
        id: 'MBR-001',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        role: 'Owner',
    },
    {
        id: 'MBR-002',
        name: 'Grace Hopper',
        email: 'grace@example.com',
        role: 'Admin',
    },
    {
        id: 'MBR-003',
        name: 'Alan Turing',
        email: 'alan@example.com',
        role: 'Viewer',
    },
];

export const demoDocuments: readonly DemoDocument[] = [
    {
        id: 'DOC-001',
        title: 'Security Review Notes',
        state: 'Published',
        owner: 'Ada Lovelace',
    },
    {
        id: 'DOC-002',
        title: 'Bulk Import Checklist',
        state: 'Draft',
        owner: 'Grace Hopper',
    },
    {
        id: 'DOC-003',
        title: 'Archived Contract',
        state: 'Archived',
        owner: 'Alan Turing',
    },
];

export const demoAuditTrail: readonly DemoAuditEntry[] = [
    {
        id: 'RUN-1024',
        action: 'project.archive',
        target: 'Legacy Import',
        actor: 'Ada Lovelace',
        status: 'Undo available',
    },
    {
        id: 'RUN-1023',
        action: 'member.change_role',
        target: 'Grace Hopper',
        actor: 'Ada Lovelace',
        status: 'Completed',
    },
    {
        id: 'RUN-1022',
        action: 'document.archive',
        target: 'Archived Contract',
        actor: 'Grace Hopper',
        status: 'Partial',
    },
];

export const demoPreviewImpact: readonly DemoPreviewImpact[] = [
    {
        label: 'Project visibility changes',
        tone: 'warning',
    },
    {
        label: '3 documents remain attached',
        tone: 'neutral',
    },
    {
        label: 'Undo available for 30 minutes',
        tone: 'success',
    },
];
