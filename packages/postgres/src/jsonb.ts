export function encodeJsonb(value: unknown): string {
    return JSON.stringify(value);
}

export function encodeOptionalJsonb(value: unknown | undefined): string | null {
    return value === undefined ? null : encodeJsonb(value);
}
