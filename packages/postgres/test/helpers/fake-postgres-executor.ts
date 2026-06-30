import type {
    ActionActor,
    ActionRunStatus,
    ActionTarget,
    JsonObject,
    JsonValue,
    Reversibility,
    SerializedRollbackKitError,
    SideEffectStatus,
} from '@rollbackkit/core';
import type { QueryResult, QueryResultRow } from 'pg';
import type {
    ActionConflictRow,
    ActionRunRow,
    ActionSideEffectRow,
    SnapshotRow,
} from '../../src/mappers';
import type { PostgresQueryExecutor } from '../../src/migration-runner';

export interface RecordedPostgresQuery {
    readonly text: string;
    readonly values?: unknown[];
}

export interface FakeAppliedMigrationRow extends QueryResultRow {
    readonly id: string;
    readonly applied_at: Date | string;
}

export interface FakePostgresExecutorOptions {
    readonly schemaMigrationsTableExists?: boolean;
}

export class FakePostgresExecutor implements PostgresQueryExecutor {
    readonly queries: RecordedPostgresQuery[] = [];
    readonly schemaMigrationRows: FakeAppliedMigrationRow[];
    readonly actionRunRows = new Map<string, ActionRunRow>();
    readonly snapshotRows = new Map<string, SnapshotRow[]>();
    readonly sideEffectRows = new Map<string, ActionSideEffectRow[]>();
    readonly conflictRows = new Map<string, ActionConflictRow[]>();
    schemaMigrationsTableExists: boolean;

    constructor(
        appliedMigrationRows: readonly FakeAppliedMigrationRow[] = [],
        options: FakePostgresExecutorOptions = {},
    ) {
        this.schemaMigrationRows = [...appliedMigrationRows];
        this.schemaMigrationsTableExists =
            options.schemaMigrationsTableExists ?? appliedMigrationRows.length > 0;
    }

    async query<TResult extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: unknown[],
    ): Promise<QueryResult<TResult>> {
        this.queries.push(values === undefined ? { text } : { text, values });

        const trimmedText = text.trim();

        if (trimmedText === 'BEGIN' || trimmedText === 'COMMIT' || trimmedText === 'ROLLBACK') {
            return createQueryResult([]);
        }

        if (text.includes("to_regclass('rollbackkit_schema_migrations')")) {
            return createQueryResult([
                {
                    table_name: this.schemaMigrationsTableExists
                        ? 'rollbackkit_schema_migrations'
                        : null,
                },
            ] as unknown as TResult[]);
        }

        if (text.includes('CREATE TABLE IF NOT EXISTS rollbackkit_schema_migrations')) {
            this.schemaMigrationsTableExists = true;

            return createQueryResult([]);
        }

        if (
            text.includes('SELECT id, applied_at') &&
            text.includes('rollbackkit_schema_migrations')
        ) {
            return createQueryResult(this.schemaMigrationRows as unknown as TResult[]);
        }

        if (text.includes('INSERT INTO rollbackkit_schema_migrations') && values !== undefined) {
            const id = String(values[0]);

            if (!this.schemaMigrationRows.some((row) => row.id === id)) {
                this.schemaMigrationRows.push({
                    id,
                    applied_at: new Date('2026-01-01T00:00:00.000Z'),
                });
            }

            return createQueryResult([]);
        }

        if (text.includes('INSERT INTO rollbackkit_action_runs')) {
            if (values === undefined) {
                throw new Error('Expected action run insert query values.');
            }

            if (text.includes('ON CONFLICT') && this.#findIdempotentActionRunFromInsert(values)) {
                return createQueryResult([]);
            }

            const row = createActionRunRowFromInsertValues(values);
            this.actionRunRows.set(row.id, row);

            return createQueryResult([row] as unknown as TResult[]);
        }

        if (text.includes('UPDATE rollbackkit_action_runs')) {
            if (values === undefined) {
                throw new Error('Expected action run update query values.');
            }

            const id = String(values[0]);
            const existing = this.actionRunRows.get(id);

            if (existing === undefined) {
                return createQueryResult([]);
            }

            const updated = applyActionRunUpdateQuery(existing, text, values);
            this.actionRunRows.set(id, updated);

            return createQueryResult([updated] as unknown as TResult[]);
        }

        if (text.includes('INSERT INTO rollbackkit_snapshots')) {
            if (values === undefined) {
                throw new Error('Expected snapshot insert query values.');
            }

            const row = createSnapshotRowFromInsertValues(values);
            const snapshots = this.snapshotRows.get(row.action_run_id) ?? [];

            snapshots.push(row);
            this.snapshotRows.set(row.action_run_id, snapshots);

            return createQueryResult([row] as unknown as TResult[]);
        }

        if (
            text.includes('FROM rollbackkit_snapshots') &&
            text.includes('WHERE action_run_id = $1')
        ) {
            const actionRunId = String(values?.[0]);
            const rows = this.snapshotRows.get(actionRunId) ?? [];

            return createQueryResult([...rows] as unknown as TResult[]);
        }

        if (text.includes('INSERT INTO rollbackkit_side_effects')) {
            if (values === undefined) {
                throw new Error('Expected side effect insert query values.');
            }

            const row = createActionSideEffectRowFromInsertValues(values);
            const sideEffects = this.sideEffectRows.get(row.action_run_id) ?? [];

            sideEffects.push(row);
            this.sideEffectRows.set(row.action_run_id, sideEffects);

            return createQueryResult([row] as unknown as TResult[]);
        }

        if (text.includes('INSERT INTO rollbackkit_conflicts')) {
            if (values === undefined) {
                throw new Error('Expected conflict insert query values.');
            }

            const row = createActionConflictRowFromInsertValues(values);
            const conflicts = this.conflictRows.get(row.action_run_id) ?? [];

            conflicts.push(row);
            this.conflictRows.set(row.action_run_id, conflicts);

            return createQueryResult([row] as unknown as TResult[]);
        }

        if (text.includes('FROM rollbackkit_action_runs') && text.includes('WHERE id = $1')) {
            const id = String(values?.[0]);
            const row = this.actionRunRows.get(id);

            return createQueryResult((row === undefined ? [] : [row]) as unknown as TResult[]);
        }

        if (
            text.includes('FROM rollbackkit_action_runs') &&
            text.includes('idempotency_key = $4')
        ) {
            const row = this.#findIdempotentActionRunFromLookup(text, values ?? []);

            return createQueryResult((row === undefined ? [] : [row]) as unknown as TResult[]);
        }

        if (
            text.includes('FROM rollbackkit_action_runs') &&
            text.includes('ORDER BY created_at DESC, id DESC')
        ) {
            const rows = applyActionHistoryQuery(
                Array.from(this.actionRunRows.values()),
                text,
                values ?? [],
            );

            return createQueryResult(rows as unknown as TResult[]);
        }

        return createQueryResult([]);
    }

    #findIdempotentActionRunFromInsert(values: readonly unknown[]): ActionRunRow | undefined {
        return findIdempotentActionRun(Array.from(this.actionRunRows.values()), {
            name: String(values[1]),
            actorType: String(values[4]),
            actorId: String(values[3]),
            tenantId: values[6] as string | null,
            idempotencyKey: values[12] as string | null,
        });
    }

    #findIdempotentActionRunFromLookup(
        text: string,
        values: readonly unknown[],
    ): ActionRunRow | undefined {
        return findIdempotentActionRun(Array.from(this.actionRunRows.values()), {
            name: String(values[0]),
            actorType: String(values[1]),
            actorId: String(values[2]),
            tenantId: text.includes('tenant_id IS NULL') ? null : (values[4] as string | null),
            idempotencyKey: values[3] as string | null,
        });
    }
}

interface IdempotentActionRunScope {
    readonly name: string;
    readonly actorType: string;
    readonly actorId: string;
    readonly tenantId: string | null;
    readonly idempotencyKey: string | null;
}

function findIdempotentActionRun(
    rows: readonly ActionRunRow[],
    scope: IdempotentActionRunScope,
): ActionRunRow | undefined {
    if (scope.idempotencyKey === null) {
        return undefined;
    }

    return rows.find(
        (row) =>
            row.name === scope.name &&
            row.actor_type === scope.actorType &&
            row.actor_id === scope.actorId &&
            row.tenant_id === scope.tenantId &&
            row.idempotency_key === scope.idempotencyKey,
    );
}

function createActionRunRowFromInsertValues(values: readonly unknown[]): ActionRunRow {
    return {
        id: String(values[0]),
        name: String(values[1]),
        status: values[2] as ActionRunStatus,

        actor_id: String(values[3]),
        actor_type: String(values[4]),
        actor: readJsonbValue(values[5]) as ActionActor,

        tenant_id: values[6] as string | null,

        target_type: values[7] as string | null,
        target_id: values[8] as string | null,
        target: readNullableJsonbValue(values[9]) as ActionTarget | null,

        input: readJsonbValue(values[10]) as JsonValue,
        input_hash: values[11] as string | null,
        idempotency_key: values[12] as string | null,
        reversibility: readJsonbValue(values[13]) as Reversibility,

        created_at: values[14] as Date,
        executed_at: null,
        undo_expires_at: values[15] as Date | null,
        undo_started_at: null,
        undone_at: null,
        undone_by: null,

        result: null,
        result_present: false,
        undo_result: null,
        undo_result_present: false,
        error: null,
        metadata: readNullableJsonbValue(values[16]) as JsonObject | null,
    };
}

function createSnapshotRowFromInsertValues(values: readonly unknown[]): SnapshotRow {
    return {
        id: String(values[0]),
        action_run_id: String(values[1]),
        key: String(values[2]),
        value: readJsonbValue(values[3]) as JsonValue,
        created_at: values[4] as Date,
        metadata: readNullableJsonbValue(values[5]) as JsonObject | null,
    };
}

function createActionSideEffectRowFromInsertValues(
    values: readonly unknown[],
): ActionSideEffectRow {
    return {
        id: String(values[0]),
        action_run_id: String(values[1]),
        type: String(values[2]),
        status: values[3] as SideEffectStatus,
        reversibility: readJsonbValue(values[4]) as Reversibility,
        payload: readNullableJsonbValue(values[5]) as JsonValue | null,
        payload_present: values[5] !== null,
        created_at: values[6] as Date,
        metadata: readNullableJsonbValue(values[7]) as JsonObject | null,
    };
}

function createActionConflictRowFromInsertValues(values: readonly unknown[]): ActionConflictRow {
    return {
        id: String(values[0]),
        action_run_id: String(values[1]),
        reason: String(values[2]),
        details: readNullableJsonbValue(values[3]) as JsonObject | null,
        created_at: values[4] as Date,
    };
}

function applyActionRunUpdateQuery(
    row: ActionRunRow,
    text: string,
    values: readonly unknown[],
): ActionRunRow {
    return {
        ...row,
        status: readUpdatedValue(text, values, 'status', row.status) as ActionRunStatus,
        executed_at: readUpdatedValue(text, values, 'executed_at', row.executed_at) as Date | null,
        undo_started_at: readUpdatedValue(
            text,
            values,
            'undo_started_at',
            row.undo_started_at,
        ) as Date | null,
        undone_at: readUpdatedValue(text, values, 'undone_at', row.undone_at) as Date | null,
        undone_by: readNullableJsonbValue(
            readUpdatedValue(text, values, 'undone_by', row.undone_by),
        ) as ActionActor | null,
        result: readNullableJsonbValue(
            readUpdatedValue(text, values, 'result', row.result),
        ) as JsonValue | null,
        ...readUpdatedPresenceFlag(row.result_present, hasUpdatedValue(text, 'result'), 'result'),
        undo_result: readNullableJsonbValue(
            readUpdatedValue(text, values, 'undo_result', row.undo_result),
        ) as JsonValue | null,
        ...readUpdatedPresenceFlag(
            row.undo_result_present,
            hasUpdatedValue(text, 'undo_result'),
            'undo_result',
        ),
        error: readNullableJsonbValue(
            readUpdatedValue(text, values, 'error', row.error),
        ) as SerializedRollbackKitError | null,
        metadata: readNullableJsonbValue(
            readUpdatedValue(text, values, 'metadata', row.metadata),
        ) as JsonObject | null,
    };
}

function readUpdatedPresenceFlag(
    currentValue: boolean | undefined,
    updated: boolean,
    column: 'result' | 'undo_result',
): Pick<ActionRunRow, 'result_present' | 'undo_result_present'> {
    if (updated) {
        return column === 'result' ? { result_present: true } : { undo_result_present: true };
    }

    if (currentValue === undefined) {
        return {};
    }

    return column === 'result'
        ? { result_present: currentValue }
        : { undo_result_present: currentValue };
}

function hasUpdatedValue(text: string, column: string): boolean {
    return new RegExp(`\\b${column}\\s*=\\s*\\$(\\d+)`).test(text);
}

function readUpdatedValue(
    text: string,
    values: readonly unknown[],
    column: string,
    currentValue: unknown,
): unknown {
    const match = new RegExp(`\\b${column}\\s*=\\s*\\$(\\d+)`).exec(text);

    if (match?.[1] === undefined) {
        return currentValue;
    }

    return values[Number(match[1]) - 1];
}

function readNullableJsonbValue(value: unknown): unknown {
    return value === null ? null : readJsonbValue(value);
}

function readJsonbValue(value: unknown): unknown {
    return typeof value === 'string' ? JSON.parse(value) : value;
}

function applyActionHistoryQuery(
    rows: readonly ActionRunRow[],
    text: string,
    values: readonly unknown[],
): ActionRunRow[] {
    let result = [...rows];

    result = filterBySqlColumn(result, text, values, 'tenant_id');
    result = filterBySqlColumn(result, text, values, 'actor_id');
    result = filterBySqlColumn(result, text, values, 'target_type');
    result = filterBySqlColumn(result, text, values, 'target_id');
    result = filterBySqlColumn(result, text, values, 'name');
    result = filterBySqlColumn(result, text, values, 'status');

    result = applyCursorFilter(result, text, values);

    result.sort((first, second) => {
        const firstCreatedAt = toTime(first.created_at);
        const secondCreatedAt = toTime(second.created_at);
        const byCreatedAt = secondCreatedAt - firstCreatedAt;

        if (byCreatedAt !== 0) {
            return byCreatedAt;
        }

        return second.id.localeCompare(first.id);
    });

    const limit = readLimit(text, values);

    return limit === undefined ? result : result.slice(0, limit);
}

function filterBySqlColumn(
    rows: ActionRunRow[],
    text: string,
    values: readonly unknown[],
    column: keyof ActionRunRow,
): ActionRunRow[] {
    const value = readSqlEqualsValue(text, values, String(column));

    if (value === undefined) {
        return rows;
    }

    return rows.filter((row) => row[column] === value);
}

function applyCursorFilter(
    rows: ActionRunRow[],
    text: string,
    values: readonly unknown[],
): ActionRunRow[] {
    const cursorCreatedAt = readSqlLessThanValue(text, values, 'created_at');
    const cursorId = readSqlLessThanValue(text, values, 'id');

    if (cursorCreatedAt === undefined || cursorId === undefined) {
        return rows;
    }

    const cursorCreatedAtTime = toTime(cursorCreatedAt as Date | string);
    const cursorIdValue = String(cursorId);

    return rows.filter((row) => {
        const createdAtTime = toTime(row.created_at);

        return (
            createdAtTime < cursorCreatedAtTime ||
            (createdAtTime === cursorCreatedAtTime && row.id < cursorIdValue)
        );
    });
}

function readSqlEqualsValue(text: string, values: readonly unknown[], column: string): unknown {
    const match = new RegExp(`\\b${column}\\s*=\\s*\\$(\\d+)`).exec(text);

    if (match?.[1] === undefined) {
        return undefined;
    }

    return values[Number(match[1]) - 1];
}

function readSqlLessThanValue(text: string, values: readonly unknown[], column: string): unknown {
    const match = new RegExp(`\\b${column}\\s*<\\s*\\$(\\d+)`).exec(text);

    if (match?.[1] === undefined) {
        return undefined;
    }

    return values[Number(match[1]) - 1];
}

function readLimit(text: string, values: readonly unknown[]): number | undefined {
    const match = /\bLIMIT\s+\$(\d+)/.exec(text);

    if (match?.[1] === undefined) {
        return undefined;
    }

    return Number(values[Number(match[1]) - 1]);
}

function toTime(value: Date | string): number {
    return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function createQueryResult<TResult extends QueryResultRow>(rows: TResult[]): QueryResult<TResult> {
    return {
        command: '',
        rowCount: rows.length,
        oid: 0,
        fields: [],
        rows,
    };
}
