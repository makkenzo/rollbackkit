import { initialSchemaMigration } from './0001-initial-schema';
import { actionRunIdempotencyMigration } from './0002-action-run-idempotency';

export type { RollbackKitPostgresMigration } from './types';

export { actionRunIdempotencyMigration, initialSchemaMigration };

export const ROLLBACKKIT_POSTGRES_MIGRATIONS = [
    initialSchemaMigration,
    actionRunIdempotencyMigration,
] as const;
