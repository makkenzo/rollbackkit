import type { RollbackKitPostgresMigration } from './types';

export const initialSchemaMigration: RollbackKitPostgresMigration = {
    id: '0001_initial_schema',
    description: 'Create RollbackKit action run, snapshot, side effect and conflict tables.',
    sql: `
CREATE TABLE IF NOT EXISTS rollbackkit_action_runs (
    id text PRIMARY KEY,
    name text NOT NULL,
    status text NOT NULL,

    actor_id text NOT NULL,
    actor_type text NOT NULL,
    actor jsonb NOT NULL,

    tenant_id text,

    target_type text,
    target_id text,
    target jsonb,

    input jsonb NOT NULL,
    input_hash text,
    reversibility jsonb NOT NULL,

    created_at timestamptz NOT NULL,
    executed_at timestamptz,
    undo_expires_at timestamptz,
    undo_started_at timestamptz,
    undone_at timestamptz,
    undone_by jsonb,

    result jsonb,
    undo_result jsonb,
    error jsonb,
    metadata jsonb
);

CREATE INDEX IF NOT EXISTS rollbackkit_action_runs_tenant_created_idx
    ON rollbackkit_action_runs (tenant_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS rollbackkit_action_runs_actor_idx
    ON rollbackkit_action_runs (actor_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS rollbackkit_action_runs_target_idx
    ON rollbackkit_action_runs (target_type, target_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS rollbackkit_action_runs_name_idx
    ON rollbackkit_action_runs (name, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS rollbackkit_action_runs_status_idx
    ON rollbackkit_action_runs (status, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS rollbackkit_snapshots (
    id text PRIMARY KEY,
    action_run_id text NOT NULL REFERENCES rollbackkit_action_runs(id) ON DELETE CASCADE,
    key text NOT NULL,
    value jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    metadata jsonb
);

CREATE INDEX IF NOT EXISTS rollbackkit_snapshots_action_run_idx
    ON rollbackkit_snapshots (action_run_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS rollbackkit_snapshots_action_run_key_idx
    ON rollbackkit_snapshots (action_run_id, key, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS rollbackkit_side_effects (
    id text PRIMARY KEY,
    action_run_id text NOT NULL REFERENCES rollbackkit_action_runs(id) ON DELETE CASCADE,
    type text NOT NULL,
    status text NOT NULL,
    reversibility jsonb NOT NULL,
    payload jsonb,
    created_at timestamptz NOT NULL,
    metadata jsonb
);

CREATE INDEX IF NOT EXISTS rollbackkit_side_effects_action_run_idx
    ON rollbackkit_side_effects (action_run_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS rollbackkit_side_effects_type_idx
    ON rollbackkit_side_effects (type, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS rollbackkit_conflicts (
    id text PRIMARY KEY,
    action_run_id text NOT NULL REFERENCES rollbackkit_action_runs(id) ON DELETE CASCADE,
    reason text NOT NULL,
    details jsonb,
    created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS rollbackkit_conflicts_action_run_idx
    ON rollbackkit_conflicts (action_run_id, created_at ASC, id ASC);
`,
};
