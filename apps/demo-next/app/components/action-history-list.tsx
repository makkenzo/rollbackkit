'use client';

import { useState, useTransition } from 'react';
import type { DemoActionConflictDto } from '../../lib/demo-action-types';
import type { DemoActionHistoryEntry } from '../../lib/server/action-history-repository';
import { undoDemoActionRun } from '../actions/action-runs';

interface ActionHistoryListProps {
    readonly entries: readonly DemoActionHistoryEntry[];
}

interface ActionErrorState {
    readonly message: string;
    readonly conflict?: DemoActionConflictDto;
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
                    ...(response.error.conflict === undefined
                        ? {}
                        : { conflict: response.error.conflict }),
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
                        {entry.conflict === undefined ? null : (
                            <ConflictPanel conflict={entry.conflict} />
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
                <div className="history-error" role="alert">
                    <p>{error.message}</p>
                    {error.conflict === undefined ? null : (
                        <ConflictPanel conflict={error.conflict} />
                    )}
                </div>
            )}
        </div>
    );
}

function ConflictPanel({ conflict }: { readonly conflict: DemoActionConflictDto }) {
    return (
        <div className="conflict-panel">
            <strong>Undo blocked</strong>
            <p>{conflict.reason}</p>

            {conflict.expectedState === undefined ? null : (
                <dl>
                    <div>
                        <dt>Expected</dt>
                        <dd>{conflict.expectedState}</dd>
                    </div>
                    {conflict.actualState === undefined ? null : (
                        <div>
                            <dt>Actual</dt>
                            <dd>{conflict.actualState}</dd>
                        </div>
                    )}
                </dl>
            )}

            {conflict.suggestedNextStep === undefined ? null : <p>{conflict.suggestedNextStep}</p>}
        </div>
    );
}
