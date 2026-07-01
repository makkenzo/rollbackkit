export type DemoActionResponse<TData> =
    | {
          readonly ok: true;
          readonly data: TData;
      }
    | {
          readonly ok: false;
          readonly error: DemoActionError;
      };

export interface DemoActionError {
    readonly code?: string;
    readonly message: string;
    readonly conflict?: DemoActionConflictDto;
}

export interface DemoActionConflictDto {
    readonly reason: string;
    readonly expectedState?: string;
    readonly actualState?: string;
    readonly suggestedNextStep?: string;
}

export interface DemoActionRunDto {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly createdAt: string;
    readonly executedAt?: string;
    readonly undoExpiresAt?: string;
    readonly undoStartedAt?: string;
    readonly undoneAt?: string;
    readonly canUndo: boolean;
    readonly target?: {
        readonly id: string;
        readonly type: string;
        readonly label?: string;
    };
}
