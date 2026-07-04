import { afterEach, describe, expect, it } from 'vitest';

import {
    createDemoMutationDeniedResponse,
    isDemoMutationAllowed,
} from '../../lib/server/demo-mutation-guard';

const originalNodeEnv = process.env.NODE_ENV;
const originalMutationFlag = process.env.ROLLBACKKIT_DEMO_MUTATIONS_ENABLED;

describe('demo mutation guard', () => {
    afterEach(() => {
        setEnv('NODE_ENV', originalNodeEnv);
        setEnv('ROLLBACKKIT_DEMO_MUTATIONS_ENABLED', originalMutationFlag);
    });

    it('blocks demo mutations in production unless explicitly enabled', () => {
        setEnv('NODE_ENV', 'production');
        setEnv('ROLLBACKKIT_DEMO_MUTATIONS_ENABLED', undefined);

        expect(isDemoMutationAllowed()).toBe(false);
        expect(createDemoMutationDeniedResponse()).toEqual({
            ok: false,
            error: {
                code: 'ACTION_PERMISSION_DENIED',
                message:
                    'Demo mutations are disabled in production. Set ROLLBACKKIT_DEMO_MUTATIONS_ENABLED=true to enable them.',
            },
        });
    });

    it('keeps local demo mutations enabled by default', () => {
        setEnv('NODE_ENV', 'development');
        setEnv('ROLLBACKKIT_DEMO_MUTATIONS_ENABLED', undefined);

        expect(isDemoMutationAllowed()).toBe(true);
    });

    it('allows production demo mutations when explicitly enabled', () => {
        setEnv('NODE_ENV', 'production');
        setEnv('ROLLBACKKIT_DEMO_MUTATIONS_ENABLED', 'true');

        expect(isDemoMutationAllowed()).toBe(true);
    });
});

function setEnv(name: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
        return;
    }

    process.env[name] = value;
}
