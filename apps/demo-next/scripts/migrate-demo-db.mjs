import { withDemoPostgresClient } from './demo-db.mjs';
import { migrateDemoSchema } from './demo-schema-migrations.mjs';
import { migrateRollbackKitSchema } from './rollbackkit-db.mjs';

await withDemoPostgresClient(async (client) => {
    await migrateRollbackKitSchema(client);
    await migrateDemoSchema(client);

    console.log('RollbackKit and demo database schemas are ready.');
});
