export interface CliWriter {
    write(text: string): unknown;
}

export function writeLine(writer: CliWriter, text: string): void {
    writer.write(`${text}\n`);
}
