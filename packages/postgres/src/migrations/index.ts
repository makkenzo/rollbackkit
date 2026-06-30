import { initialSchemaMigration } from './0001-initial-schema';

export type { RollbackKitPostgresMigration } from './types';

export { initialSchemaMigration };

export const ROLLBACKKIT_POSTGRES_MIGRATIONS = [initialSchemaMigration] as const;
