import { readDemoSql, withDemoPostgresClient } from './demo-db.mjs';
import { migrateRollbackKitSchema } from './rollbackkit-db.mjs';

await withDemoPostgresClient(async (client) => {
    const schemaSql = await readDemoSql('db/schema.sql');

    await migrateRollbackKitSchema(client);
    await client.query(schemaSql);

    console.log('RollbackKit and demo database schemas are ready.');
});
