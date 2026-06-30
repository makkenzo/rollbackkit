import { randomUUID } from 'node:crypto';

export type RollbackKitPostgresIdKind = 'run' | 'snapshot' | 'effect' | 'conflict';

export function createRollbackKitPostgresId(kind: RollbackKitPostgresIdKind): string {
    return `${kind}_${randomUUID()}`;
}
