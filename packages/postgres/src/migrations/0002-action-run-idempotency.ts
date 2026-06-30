import type { RollbackKitPostgresMigration } from './types';

export const actionRunIdempotencyMigration: RollbackKitPostgresMigration = {
    id: '0002_action_run_idempotency',
    description: 'Add scoped idempotency keys for RollbackKit action runs.',
    sql: `
ALTER TABLE rollbackkit_action_runs
    ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS rollbackkit_action_runs_tenant_idempotency_idx
    ON rollbackkit_action_runs (tenant_id, name, actor_type, actor_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND tenant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS rollbackkit_action_runs_global_idempotency_idx
    ON rollbackkit_action_runs (name, actor_type, actor_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND tenant_id IS NULL;
`,
};
