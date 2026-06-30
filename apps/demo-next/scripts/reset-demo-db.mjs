import { readDemoSql, withDemoPostgresClient } from './demo-db.mjs';
import { migrateRollbackKitSchema } from './rollbackkit-db.mjs';

await withDemoPostgresClient(async (client) => {
    const schemaSql = await readDemoSql('db/schema.sql');
    const seedSql = await readDemoSql('db/seed.sql');

    await migrateRollbackKitSchema(client);
    await client.query(schemaSql);
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
