import 'server-only';

import { RollbackKitError } from '@rollbackkit/core';

export interface DemoWorkspaceScopeContext {
    readonly actionName: string;
    readonly tenantId?: string;
    readonly input: {
        readonly workspaceId: string;
    };
}

export function assertDemoWorkspaceScope(context: DemoWorkspaceScopeContext): void {
    if (context.tenantId === undefined || context.tenantId === context.input.workspaceId) {
        return;
    }

    throw new RollbackKitError({
        code: 'ACTION_INPUT_INVALID',
        message: 'Demo action tenantId must match input.workspaceId.',
        details: {
            actionName: context.actionName,
            tenantId: context.tenantId,
            workspaceId: context.input.workspaceId,
        },
    });
}
