import type { JsonObject } from '../shared/json';
import type { DurationMs } from '../shared/time';
import type { Reversibility } from './reversibility';

export type PreviewSeverity = 'info' | 'warning' | 'danger';

export interface PreviewImpactItem {
    readonly id?: string;
    readonly label: string;
    readonly description?: string;
    readonly severity?: PreviewSeverity;
    readonly metadata?: JsonObject;
}

export interface PreviewSideEffect {
    readonly type: string;
    readonly label: string;
    readonly description?: string;
    readonly reversibility: Reversibility;
    readonly metadata?: JsonObject;
}

export interface PreviewResult {
    readonly title: string;
    readonly summary?: string;
    readonly impact: readonly PreviewImpactItem[];
    readonly reversibility: Reversibility;
    readonly undoWindowMs?: DurationMs;
    readonly sideEffects?: readonly PreviewSideEffect[];
    readonly warnings?: readonly string[];
    readonly metadata?: JsonObject;
}
