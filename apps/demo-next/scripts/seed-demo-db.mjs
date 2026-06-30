import { readDemoSql, withDemoPostgresClient } from './demo-db.mjs';

await withDemoPostgresClient(async (client) => {
    const seedSql = await readDemoSql('db/seed.sql');

    await client.query(seedSql);

    console.log('RollbackKit demo database seed data is ready.');
});
