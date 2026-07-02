import type { DemoActionConflictDto } from '../demo-action-types';

export interface DemoWorkspace {
    readonly name: string;
    readonly label: string;
    readonly description: string;
    readonly undoWindowLabel: string;
}

export type DemoProjectStatus = 'active' | 'archived';

export interface DemoProject {
    readonly id: string;
    readonly name: string;
    readonly owner: string;
    readonly status: DemoProjectStatus;
    readonly statusLabel: string;
    readonly updatedAt: string;
}

export type DemoMemberRole = 'owner' | 'admin' | 'viewer';
export type DemoEditableMemberRole = 'admin' | 'viewer';

export interface DemoMember {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly role: DemoMemberRole;
    readonly roleLabel: string;
}

export type DemoDocumentState = 'published' | 'draft' | 'archived';

export interface DemoDocument {
    readonly id: string;
    readonly title: string;
    readonly owner: string;
    readonly state: DemoDocumentState;
    readonly stateLabel: string;
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

export interface DemoDashboardData {
    readonly workspace: DemoWorkspace;
    readonly projects: readonly DemoProject[];
    readonly members: readonly DemoMember[];
    readonly documents: readonly DemoDocument[];
}

export type DemoActionHistoryTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface DemoActionHistoryEntry {
    readonly id: string;
    readonly actionName: string;
    readonly targetLabel: string;
    readonly actorLabel: string;
    readonly statusLabel: string;
    readonly statusTone: DemoActionHistoryTone;
    readonly occurredAt: string;
    readonly canUndo: boolean;
    readonly undoExpiresAt?: string;
    readonly conflict?: DemoActionConflictDto;
}
