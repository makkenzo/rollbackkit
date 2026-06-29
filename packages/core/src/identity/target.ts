import type { JsonObject } from './../shared';

export type TargetType = string & {};

export interface ActionTarget {
    readonly id: string;
    readonly type: TargetType;
    readonly label?: string;
    readonly metadata?: JsonObject;
}
