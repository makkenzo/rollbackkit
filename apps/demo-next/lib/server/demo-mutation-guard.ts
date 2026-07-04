import 'server-only';

import type { DemoActionResponse } from '../demo-action-types';

const DEMO_MUTATIONS_ENABLED_ENV_NAME = 'ROLLBACKKIT_DEMO_MUTATIONS_ENABLED';

export function isDemoMutationAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
    if (env.NODE_ENV !== 'production') {
        return true;
    }

    return env[DEMO_MUTATIONS_ENABLED_ENV_NAME] === 'true';
}

export function createDemoMutationDeniedResponse<TData>(): DemoActionResponse<TData> {
    return {
        ok: false,
        error: {
            code: 'ACTION_PERMISSION_DENIED',
            message: `Demo mutations are disabled in production. Set ${DEMO_MUTATIONS_ENABLED_ENV_NAME}=true to enable them.`,
        },
    };
}
