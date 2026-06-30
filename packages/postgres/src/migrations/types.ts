export interface RollbackKitPostgresMigration {
    readonly id: string;
    readonly description: string;
    readonly sql: string;
}
