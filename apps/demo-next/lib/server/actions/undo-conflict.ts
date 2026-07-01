import type { ConflictRecorder, JsonObject } from '@rollbackkit/core';

export interface DemoUndoConflictDetails extends JsonObject {
    readonly expectedState: string;
    readonly actualState: string;
    readonly suggestedNextStep: string;
}

export async function recordDemoUndoConflict(
    conflicts: ConflictRecorder,
    reason: string,
    details: DemoUndoConflictDetails,
): Promise<void> {
    await conflicts.record(reason, details);
}
