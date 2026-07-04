import { pathToFileURL } from 'node:url';

import { readDemoSql, withDemoPostgresClient } from './demo-db.mjs';
import { migrateDemoSchema } from './demo-schema-migrations.mjs';
import { migrateRollbackKitSchema } from './rollbackkit-db.mjs';

export async function seedDemoDatabase(client) {
    const seedSql = await readDemoSql('db/seed.sql');

    await migrateRollbackKitSchema(client);
    await migrateDemoSchema(client);
    await client.query(seedSql);
}

const isDirectExecution =
    process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
    await withDemoPostgresClient(async (client) => {
        await seedDemoDatabase(client);
    });
    console.log('RollbackKit demo database seed data is ready.');
}
