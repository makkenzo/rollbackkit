export type {
    ActionPhase,
    ActionRun,
    ActionRunStatus,
    ExecuteResult,
    UndoResult,
} from './lifecycle';

export type {
    PreviewImpactItem,
    PreviewResult,
    PreviewSeverity,
    PreviewSideEffect,
} from './preview';

export type { Reversibility, ReversibilityKind } from './reversibility';
export { isUndoable, REVERSIBILITY } from './reversibility';
