import 'server-only';

import type { ActionConflict } from '@rollbackkit/core';
import type { DemoActionConflictDto } from '../demo-action-types';

export function getLatestDemoActionConflict(
    conflicts: readonly ActionConflict[],
): DemoActionConflictDto | undefined {
    const latestConflict = conflicts.at(-1);

    return latestConflict === undefined ? undefined : serializeDemoActionConflict(latestConflict);
}

export function serializeDemoActionConflict(conflict: ActionConflict): DemoActionConflictDto {
    const expectedState = readConflictDetailString(conflict, 'expectedState');
    const actualState = readConflictDetailString(conflict, 'actualState');
    const suggestedNextStep = readConflictDetailString(conflict, 'suggestedNextStep');

    return {
        reason: conflict.reason,
        ...(expectedState === undefined ? {} : { expectedState }),
        ...(actualState === undefined ? {} : { actualState }),
        ...(suggestedNextStep === undefined ? {} : { suggestedNextStep }),
    };
}

function readConflictDetailString(conflict: ActionConflict, key: string): string | undefined {
    const value = conflict.details?.[key];

    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();

    return trimmed === '' ? undefined : trimmed;
}
