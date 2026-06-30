import 'server-only';

import type { ActionActor } from '@rollbackkit/core';

export const DEMO_TENANT_ID = 'workspace_acme';

export const DEMO_ACTOR: ActionActor = {
    id: 'member_ada',
    type: 'user',
    displayName: 'Ada Lovelace',
};
