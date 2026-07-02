import type { RollbackKitPostgresMigration } from './types';

export const auditInvariantsMigration: RollbackKitPostgresMigration = {
    id: '0003_audit_invariants',
    description: 'Add audit table constraints for action run identity, status and target columns.',
    sql: `
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'rollbackkit_action_runs_status_check'
            AND conrelid = 'rollbackkit_action_runs'::regclass
    ) THEN
        ALTER TABLE rollbackkit_action_runs
            ADD CONSTRAINT rollbackkit_action_runs_status_check
            CHECK (
                status IN (
                    'created',
                    'running',
                    'completed',
                    'failed',
                    'undo_running',
                    'undone',
                    'undo_failed',
                    'expired'
                )
            )
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'rollbackkit_action_runs_actor_consistency_check'
            AND conrelid = 'rollbackkit_action_runs'::regclass
    ) THEN
        ALTER TABLE rollbackkit_action_runs
            ADD CONSTRAINT rollbackkit_action_runs_actor_consistency_check
            CHECK (
                actor ->> 'id' = actor_id
                AND actor ->> 'type' = actor_type
            )
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'rollbackkit_action_runs_target_consistency_check'
            AND conrelid = 'rollbackkit_action_runs'::regclass
    ) THEN
        ALTER TABLE rollbackkit_action_runs
            ADD CONSTRAINT rollbackkit_action_runs_target_consistency_check
            CHECK (
                (
                    target IS NULL
                    AND target_type IS NULL
                    AND target_id IS NULL
                )
                OR (
                    target IS NOT NULL
                    AND target_type IS NOT NULL
                    AND target_id IS NOT NULL
                    AND target ->> 'id' = target_id
                    AND target ->> 'type' = target_type
                )
            )
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'rollbackkit_side_effects_status_check'
            AND conrelid = 'rollbackkit_side_effects'::regclass
    ) THEN
        ALTER TABLE rollbackkit_side_effects
            ADD CONSTRAINT rollbackkit_side_effects_status_check
            CHECK (status IN ('planned', 'completed', 'failed', 'compensated'))
            NOT VALID;
    END IF;
END $$;
`,
};
