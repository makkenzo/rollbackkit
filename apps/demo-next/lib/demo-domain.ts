export interface DemoWorkspace {
    readonly name: string;
    readonly label: string;
    readonly description: string;
    readonly undoWindowLabel: string;
}

export type DemoProjectStatus = 'Active' | 'Archived';

export interface DemoProject {
    readonly id: string;
    readonly name: string;
    readonly owner: string;
    readonly status: DemoProjectStatus;
    readonly updatedAt: string;
}

export type DemoMemberRole = 'Owner' | 'Admin' | 'Viewer';

export interface DemoMember {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly role: DemoMemberRole;
}

export type DemoDocumentState = 'Published' | 'Draft' | 'Archived';

export interface DemoDocument {
    readonly id: string;
    readonly title: string;
    readonly owner: string;
    readonly state: DemoDocumentState;
}

export type DemoAuditStatus = 'Undo available' | 'Completed' | 'Partial';

export interface DemoAuditEntry {
    readonly id: string;
    readonly action: string;
    readonly target: string;
    readonly actor: string;
    readonly status: DemoAuditStatus;
}

export interface DemoPreviewImpact {
    readonly label: string;
    readonly tone: 'neutral' | 'success' | 'warning';
}
