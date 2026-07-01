import 'server-only';

import type { ActionActor } from '@rollbackkit/core';

export interface DemoRequestContext {
    readonly workspaceId: string;
    readonly tenantId: string;
    readonly actor: ActionActor;
}

export const DEMO_WORKSPACE_ID = 'workspace_acme';
export const DEMO_TENANT_ID = DEMO_WORKSPACE_ID;

export const DEMO_ACTOR: ActionActor = {
    id: 'member_ada',
    type: 'user',
    displayName: 'Ada Lovelace',
};

export function getDemoRequestContext(): DemoRequestContext {
    return {
        workspaceId: DEMO_WORKSPACE_ID,
        tenantId: DEMO_TENANT_ID,
        actor: DEMO_ACTOR,
    };
}
