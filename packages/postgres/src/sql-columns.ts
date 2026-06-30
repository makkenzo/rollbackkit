export const ACTION_RUN_COLUMNS_SQL = `
id,
name,
status,
actor_id,
actor_type,
actor,
tenant_id,
target_type,
target_id,
target,
input,
input_hash,
idempotency_key,
reversibility,
created_at,
executed_at,
undo_expires_at,
undo_started_at,
undone_at,
undone_by,
result,
result IS NOT NULL AS result_present,
undo_result,
undo_result IS NOT NULL AS undo_result_present,
error,
metadata
`;

export const SNAPSHOT_COLUMNS_SQL = `
id,
action_run_id,
key,
value,
created_at,
metadata
`;

export const SIDE_EFFECT_COLUMNS_SQL = `
id,
action_run_id,
type,
status,
reversibility,
payload,
payload IS NOT NULL AS payload_present,
created_at,
metadata
`;

export const CONFLICT_COLUMNS_SQL = `
id,
action_run_id,
reason,
details,
created_at
`;
