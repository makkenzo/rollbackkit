import { createPostgresMigrationRunner } from '@rollbackkit/postgres';

export async function migrateRollbackKitSchema(client) {
    const runner = createPostgresMigrationRunner({
        executor: client,
    });

    return runner.migrate();
}
