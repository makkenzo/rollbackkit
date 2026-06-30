import 'server-only';

import { createRollbackKit, type RollbackKit } from '@rollbackkit/core';
import { createPostgresStore, type PostgresQueryExecutor } from '@rollbackkit/postgres';
import type { PoolClient } from 'pg';
import { createProjectArchiveAction } from './actions/project-archive';
import { getDemoPostgresPool } from './demo-db';

export interface DemoRollbackKitRuntime {
    readonly rollbackkit: RollbackKit;
    readonly client: PoolClient;
}

export function createDemoRollbackKit(executor: PostgresQueryExecutor): RollbackKit {
    return createRollbackKit({
        storage: createPostgresStore({
            executor,
        }),
        actions: [createProjectArchiveAction(executor)],
    });
}

export async function withDemoRollbackKit<TValue>(
    handler: (runtime: DemoRollbackKitRuntime) => Promise<TValue>,
): Promise<TValue> {
    const client = await getDemoPostgresPool().connect();

    try {
        return await handler({
            client,
            rollbackkit: createDemoRollbackKit(client),
        });
    } finally {
        client.release();
    }
}
