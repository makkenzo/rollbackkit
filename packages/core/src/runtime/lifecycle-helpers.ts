import type { PreviewResult } from '../lifecycle/preview';
import type { Reversibility } from '../lifecycle/reversibility';
import type { JsonObject } from '../shared/json';

export function applyDefaultUndoWindow(
    preview: PreviewResult,
    undoWindowMs?: number,
): PreviewResult {
    if (preview.undoWindowMs !== undefined || undoWindowMs === undefined) {
        return preview;
    }

    return {
        ...preview,
        undoWindowMs,
    };
}

export function createUndoExpiration(
    reversibility: Reversibility,
    undoWindowMs: number | undefined,
    now: Date,
): { readonly undoExpiresAt?: Date } {
    if (!reversibility.undoable || undoWindowMs === undefined) {
        return {};
    }

    return {
        undoExpiresAt: new Date(now.getTime() + undoWindowMs),
    };
}

export function mergeMetadata(
    existing: JsonObject | undefined,
    next: JsonObject | undefined,
): JsonObject | undefined {
    if (existing === undefined) {
        return next;
    }

    if (next === undefined) {
        return existing;
    }

    return {
        ...existing,
        ...next,
    };
}
