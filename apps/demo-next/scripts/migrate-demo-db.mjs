import { readDemoSql, withDemoPostgresClient } from './demo-db.mjs';

await withDemoPostgresClient(async (client) => {
    const schemaSql = await readDemoSql('db/schema.sql');

    await client.query(schemaSql);

    console.log('RollbackKit demo database schema is ready.');
});
