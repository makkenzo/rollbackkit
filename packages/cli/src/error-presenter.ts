import { isRollbackKitError } from '@rollbackkit/core';
import { RollbackKitPostgresMigrationError } from '@rollbackkit/postgres';
import type { CliWriter } from './output';
import { writeLine } from './output';

export interface CliErrorPresentationOptions {
    readonly verbose?: boolean;
}

export function writeCliError(
    writer: CliWriter,
    error: unknown,
    options: CliErrorPresentationOptions = {},
): void {
    if (isRollbackKitError(error)) {
        writeLine(writer, `${error.code}: ${error.message}`);
        writeVerboseDetails(writer, error, options);
        return;
    }

    if (error instanceof RollbackKitPostgresMigrationError) {
        const prefix =
            error.migrationId === undefined
                ? 'PostgreSQL migration error'
                : `PostgreSQL migration ${error.migrationId}`;

        writeLine(writer, `${prefix}: ${error.message}`);
        writeVerboseDetails(writer, error, options);
        return;
    }

    const message = error instanceof Error ? error.message : String(error);

    writeLine(writer, message);
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
        writeLine(writer, error.stack);
    }

    writeCauseChain(writer, error.cause);
}

function writeCauseChain(writer: CliWriter, cause: unknown): void {
    if (cause === undefined) {
        return;
    }

    writeLine(writer, `Caused by: ${formatCause(cause)}`);

    if (cause instanceof Error) {
        writeCauseChain(writer, cause.cause);
    }
}

function formatCause(cause: unknown): string {
    if (cause instanceof Error) {
        return `${cause.name}: ${cause.message}`;
    }

    return String(cause);
}
