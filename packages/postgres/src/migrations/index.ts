import { initialSchemaMigration } from './0001-initial-schema';
import { actionRunIdempotencyMigration } from './0002-action-run-idempotency';
import { auditInvariantsMigration } from './0003-audit-invariants';
import { validateAuditInvariantsMigration } from './0004-validate-audit-invariants';

export type { RollbackKitPostgresMigration } from './types';

export {
    actionRunIdempotencyMigration,
    auditInvariantsMigration,
    initialSchemaMigration,
    validateAuditInvariantsMigration,
};

export const ROLLBACKKIT_POSTGRES_MIGRATIONS = [
    initialSchemaMigration,
    actionRunIdempotencyMigration,
    auditInvariantsMigration,
    validateAuditInvariantsMigration,
] as const;
