import { readDemoSql, withDemoPostgresClient } from './demo-db.mjs';

await withDemoPostgresClient(async (client) => {
    const schemaSql = await readDemoSql('db/schema.sql');
    const seedSql = await readDemoSql('db/seed.sql');

    await client.query(schemaSql);
    await client.query(seedSql);

    console.log('RollbackKit demo database has been reset.');
});
