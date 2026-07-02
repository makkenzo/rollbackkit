import type { RollbackKitPostgresMigration } from './types';

export const validateAuditInvariantsMigration: RollbackKitPostgresMigration = {
    id: '0004_validate_audit_invariants',
    description: 'Validate audit table constraints added by the audit invariants migration.',
    sql: `
ALTER TABLE rollbackkit_action_runs
    VALIDATE CONSTRAINT rollbackkit_action_runs_status_check;
ALTER TABLE rollbackkit_action_runs
    VALIDATE CONSTRAINT rollbackkit_action_runs_actor_consistency_check;
ALTER TABLE rollbackkit_action_runs
    VALIDATE CONSTRAINT rollbackkit_action_runs_target_consistency_check;
ALTER TABLE rollbackkit_side_effects
    VALIDATE CONSTRAINT rollbackkit_side_effects_status_check;
`,
};
