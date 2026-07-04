import { isRollbackKitError } from '@rollbackkit/core';
import { RollbackKitPostgresMigrationError } from '@rollbackkit/postgres';
import type { CliWriter } from './output';
import { writeLine } from './output';

const DATABASE_URL_CREDENTIAL_PATTERN = /\b(postgres(?:ql)?:\/\/)([^:@/\s]+):([^@/\s]+)@/g;
const MAX_CAUSE_DEPTH = 32;

export interface CliErrorPresentationOptions {
    readonly verbose?: boolean;
}

export function writeCliError(
    writer: CliWriter,
    error: unknown,
    options: CliErrorPresentationOptions = {},
): void {
    if (isRollbackKitError(error)) {
        writeLine(writer, redactDatabaseUrlCredentials(`${error.code}: ${error.message}`));
        writeVerboseDetails(writer, error, options);
        return;
    }

    if (error instanceof RollbackKitPostgresMigrationError) {
        const prefix =
            error.migrationId === undefined
                ? 'PostgreSQL migration error'
                : `PostgreSQL migration ${error.migrationId}`;

        writeLine(writer, redactDatabaseUrlCredentials(`${prefix}: ${error.message}`));
        writeVerboseDetails(writer, error, options);
        return;
    }

    const message = error instanceof Error ? error.message : String(error);

    writeLine(writer, redactDatabaseUrlCredentials(message));
    writeVerboseDetails(writer, error, options);
}

function writeVerboseDetails(
    writer: CliWriter,
    error: unknown,
    options: CliErrorPresentationOptions,
): void {
    if (options.verbose !== true || !(error instanceof Error)) {
        return;
    }

    if (error.stack !== undefined) {
        writeLine(writer, redactDatabaseUrlCredentials(error.stack));
    }

    writeCauseChain(writer, error.cause);
}

function writeCauseChain(writer: CliWriter, cause: unknown): void {
    const seen = new Set<Error>();
    let currentCause = cause;
    let depth = 0;

    while (currentCause !== undefined) {
        if (depth >= MAX_CAUSE_DEPTH) {
            writeLine(writer, `Cause chain truncated after ${MAX_CAUSE_DEPTH} cause(s).`);
            return;
        }

        if (currentCause instanceof Error) {
            if (seen.has(currentCause)) {
                writeLine(writer, 'Cause chain stopped after detecting a cycle.');
                return;
            }

            seen.add(currentCause);
        }

        writeLine(writer, redactDatabaseUrlCredentials(`Caused by: ${formatCause(currentCause)}`));
        depth += 1;

        if (!(currentCause instanceof Error)) {
            return;
        }

        currentCause = currentCause.cause;
    }
}

function formatCause(cause: unknown): string {
    if (cause instanceof Error) {
        return `${cause.name}: ${cause.message}`;
    }

    return String(cause);
}

function redactDatabaseUrlCredentials(value: string): string {
    return value.replace(DATABASE_URL_CREDENTIAL_PATTERN, '$1$2:***@');
}
