'use client';

import { useState, useTransition } from 'react';
import type { DemoActionHistoryEntry } from '../../lib/server/action-history-repository';
import { undoDemoActionRun } from '../actions/action-runs';

interface ActionHistoryListProps {
    readonly entries: readonly DemoActionHistoryEntry[];
}

interface ActionErrorState {
    readonly message: string;
}

export function ActionHistoryList({ entries }: ActionHistoryListProps) {
    const [isPending, startTransition] = useTransition();
    const [pendingActionRunId, setPendingActionRunId] = useState<string | null>(null);
    const [error, setError] = useState<ActionErrorState | null>(null);

    if (entries.length === 0) {
        return <p className="empty-state">No actions recorded yet.</p>;
    }

    function undoAction(actionRunId: string) {
        setError(null);
        setPendingActionRunId(actionRunId);

        startTransition(async () => {
            const response = await undoDemoActionRun(actionRunId);

            if (!response.ok) {
                setError({
                    message: response.error.message,
                });
                setPendingActionRunId(null);
                return;
            }

            setPendingActionRunId(null);
        });
    }

    return (
        <div className="audit-list">
            {entries.map((entry) => (
                <article className="audit-item" key={entry.id}>
                    <div>
                        <code>{entry.actionName}</code>
                        <p>
                            {entry.targetLabel} · {entry.actorLabel} · {entry.occurredAt}
                        </p>
                        {entry.undoExpiresAt === undefined || !entry.canUndo ? null : (
                            <p className="audit-hint">Undo until {entry.undoExpiresAt}</p>
                        )}
                    </div>

                    <div className="audit-actions">
                        <span className={`status-badge ${entry.statusTone}`}>
                            {entry.statusLabel}
                        </span>

                        {entry.canUndo ? (
                            <button
                                className="button ghost"
                                disabled={isPending}
                                type="button"
                                onClick={() => undoAction(entry.id)}
                            >
                                {pendingActionRunId === entry.id ? 'Undoing…' : 'Undo'}
                            </button>
                        ) : null}
                    </div>
                </article>
            ))}

            {error === null ? null : (
                <p className="history-error" role="alert">
                    {error.message}
                </p>
            )}
        </div>
    );
}
