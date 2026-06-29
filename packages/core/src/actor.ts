import type { JsonObject } from './json';

export type ActorType = 'user' | 'system' | 'service' | (string & {});

export interface ActionActor {
    readonly id: string;
    readonly type: ActorType;
    readonly displayName?: string;
    readonly metadata?: JsonObject;
}
