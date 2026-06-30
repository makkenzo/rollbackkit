import 'server-only';

import type {
    ActionActor,
    ActionRunStatus,
    ActionTarget,
    JsonObject,
    Reversibility,
    SerializedRollbackKitError,
} from '@rollbackkit/core';
import type { QueryResultRow } from 'pg';

import { getDemoPostgresPool } from './demo-db';

const DEMO_TENANT_ID = 'workspace_acme';

export type DemoActionHistoryTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface DemoActionHistoryEntry {
    readonly id: string;
    readonly actionName: string;
    readonly targetLabel: string;
    readonly actorLabel: string;
    readonly statusLabel: string;
    readonly statusTone: DemoActionHistoryTone;
    readonly occurredAt: string;
}

interface ActionHistoryRow extends QueryResultRow {
    readonly id: string;
    readonly name: string;
    readonly status: ActionRunStatus;
    readonly actor: ActionActor;
    readonly target: ActionTarget | null;
    readonly target_type: string | null;
    readonly target_id: string | null;
    readonly reversibility: Reversibility;
    readonly created_at: Date | string;
    readonly executed_at: Date | string | null;
    readonly undo_expires_at: Date | string | null;
    readonly undone_at: Date | string | null;
    readonly error: SerializedRollbackKitError | null;
    readonly metadata: JsonObject | null;
}

export async function getDemoActionHistory(limit = 8): Promise<readonly DemoActionHistoryEntry[]> {
    const result = await getDemoPostgresPool().query<ActionHistoryRow>(
        `
SELECT
    id,
    name,
    status,
    actor,
    target,
    target_type,
    target_id,
    reversibility,
    created_at,
    executed_at,
    undo_expires_at,
    undone_at,
    error,
    metadata
FROM rollbackkit_action_runs
WHERE tenant_id = $1
ORDER BY created_at DESC, id DESC
LIMIT $2
`,
        [DEMO_TENANT_ID, limit],
    );

    const now = new Date();

    return result.rows.map((row) => mapActionHistoryEntry(row, now));
}

function mapActionHistoryEntry(row: ActionHistoryRow, now: Date): DemoActionHistoryEntry {
    const status = formatActionStatus(row, now);

    return {
        id: row.id,
        actionName: row.name,
        targetLabel: formatTargetLabel(row),
        actorLabel: row.actor.displayName ?? row.actor.id,
        statusLabel: status.label,
        statusTone: status.tone,
        occurredAt: formatDate(row.executed_at ?? row.created_at),
    };
}

function formatTargetLabel(row: ActionHistoryRow): string {
    if (row.target?.label !== undefined && row.target.label.trim() !== '') {
        return row.target.label;
    }

    const projectName = row.metadata?.projectName;

    if (typeof projectName === 'string' && projectName.trim() !== '') {
        return projectName;
    }

    if (row.target_id !== null && row.target_type !== null) {
        return `${row.target_type}/${row.target_id}`;
    }

    return 'Unknown target';
}

function formatActionStatus(
    row: ActionHistoryRow,
    now: Date,
): {
    readonly label: string;
    readonly tone: DemoActionHistoryTone;
} {
    switch (row.status) {
        case 'completed':
            if (isUndoAvailable(row, now)) {
                return {
                    label: 'Undo available',
                    tone: 'warning',
                };
            }

            return {
                label: 'Completed',
                tone: 'success',
            };

        case 'undone':
            return {
                label: 'Undone',
                tone: 'neutral',
            };

        case 'failed':
            return {
                label: 'Failed',
                tone: 'danger',
            };

        case 'undo_failed':
            return {
                label: 'Undo failed',
                tone: 'danger',
            };

        case 'running':
            return {
                label: 'Running',
                tone: 'neutral',
            };

        case 'undo_running':
            return {
                label: 'Undoing',
                tone: 'neutral',
            };

        case 'expired':
            return {
                label: 'Expired',
                tone: 'neutral',
            };

        case 'created':
            return {
                label: 'Created',
                tone: 'neutral',
            };
    }
}

function isUndoAvailable(row: ActionHistoryRow, now: Date): boolean {
    if (!row.reversibility.undoable || row.undo_expires_at === null) {
        return false;
    }

    return parseDate(row.undo_expires_at).getTime() > now.getTime();
}

function formatDate(value: Date | string): string {
    const date = parseDate(value);

    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function parseDate(value: Date | string): Date {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new TypeError('Invalid action history timestamp value.');
    }

    return date;
}
