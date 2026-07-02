import 'server-only';

import type { ActionRun } from '@rollbackkit/core';
import type { DemoActionHistoryEntry, DemoActionHistoryTone } from '../demo/view-models';
import type { DemoActionConflictDto } from '../demo-action-types';
import { getLatestDemoActionConflict } from './conflict-summary';
import { DEMO_TENANT_ID } from './demo-request-context';
import { withDemoRollbackKit } from './rollbackkit';

export async function getDemoActionHistory(limit = 8): Promise<readonly DemoActionHistoryEntry[]> {
    const now = new Date();

    return withDemoRollbackKit(async ({ rollbackkit }) => {
        const runs = await rollbackkit.queryActionRuns({
            tenantId: DEMO_TENANT_ID,
            limit,
        });

        return Promise.all(
            runs.map(async (run) => {
                const conflicts =
                    run.status === 'undo_failed' ? await rollbackkit.getConflicts(run.id) : [];

                return mapActionHistoryEntry(run, now, getLatestDemoActionConflict(conflicts));
            }),
        );
    });
}

function mapActionHistoryEntry(
    run: ActionRun,
    now: Date,
    conflict: DemoActionConflictDto | undefined,
): DemoActionHistoryEntry {
    const status = formatActionStatus(run, now, conflict);
    const canUndo = isUndoAvailable(run, now);

    return {
        id: run.id,
        actionName: run.name,
        targetLabel: formatTargetLabel(run),
        actorLabel: run.actor.displayName ?? run.actor.id,
        statusLabel: status.label,
        statusTone: status.tone,
        occurredAt: formatDate(run.executedAt ?? run.createdAt),
        canUndo,
        ...(run.undoExpiresAt === undefined
            ? {}
            : { undoExpiresAt: formatDate(run.undoExpiresAt) }),
        ...(conflict === undefined ? {} : { conflict }),
    };
}

function formatTargetLabel(run: ActionRun): string {
    if (run.target?.label !== undefined && run.target.label.trim() !== '') {
        return run.target.label;
    }

    const projectName = run.metadata?.projectName;

    if (typeof projectName === 'string' && projectName.trim() !== '') {
        return projectName;
    }

    if (run.target !== undefined) {
        return `${run.target.type}/${run.target.id}`;
    }

    return 'Unknown target';
}

function formatActionStatus(
    run: ActionRun,
    now: Date,
    conflict: DemoActionConflictDto | undefined,
): {
    readonly label: string;
    readonly tone: DemoActionHistoryTone;
} {
    switch (run.status) {
        case 'completed':
            if (isUndoAvailable(run, now)) {
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
            if (conflict !== undefined) {
                return {
                    label: 'Undo blocked',
                    tone: 'danger',
                };
            }

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

function isUndoAvailable(run: ActionRun, now: Date): boolean {
    if (run.status !== 'completed') {
        return false;
    }

    if (!run.reversibility.undoable || run.undoExpiresAt === undefined) {
        return false;
    }

    return run.undoExpiresAt.getTime() > now.getTime();
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
