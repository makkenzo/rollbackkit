export function createDemoIdempotencyKey(scope: string): string {
    return `demo:${scope}:${globalThis.crypto.randomUUID()}`;
}
