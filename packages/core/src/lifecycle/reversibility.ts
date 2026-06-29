import type { JsonObject } from '../shared/json';

export type ReversibilityKind = 'full' | 'partial' | 'compensating' | 'irreversible';

export interface Reversibility {
    readonly kind: ReversibilityKind;
    readonly undoable: boolean;
    readonly description?: string;
    readonly compensationAction?: string;
    readonly metadata?: JsonObject;
}

export const REVERSIBILITY = {
    full: {
        kind: 'full',
        undoable: true,
    },
    partial: {
        kind: 'partial',
        undoable: true,
    },
    compensating: {
        kind: 'compensating',
        undoable: true,
    },
    irreversible: {
        kind: 'irreversible',
        undoable: false,
    },
} as const satisfies Record<ReversibilityKind, Reversibility>;

export function isUndoable(reversibility: Reversibility): boolean {
    return reversibility.undoable;
}
