import { readDemoSql, withDemoPostgresClient } from './demo-db.mjs';
import { migrateDemoSchema } from './demo-schema-migrations.mjs';
import { migrateRollbackKitSchema } from './rollbackkit-db.mjs';

await withDemoPostgresClient(async (client) => {
    const seedSql = await readDemoSql('db/seed.sql');

    await migrateRollbackKitSchema(client);
    await migrateDemoSchema(client);
    await deleteDemoRollbackKitHistory(client);
    await client.query(seedSql);

    console.log('RollbackKit demo database has been reset.');
});

async function deleteDemoRollbackKitHistory(client) {
    await client
        .query(
            `
DELETE FROM rollbackkit_action_runs
WHERE tenant_id IN ('workspace_acme', 'workspace_action_test')
`,
        )
        .catch((error) => {
            if (error?.code === '42P01') {
                return;
            }

            throw error;
        });
}
