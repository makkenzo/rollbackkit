# RollbackKit

RollbackKit is an open-source TypeScript framework for building reversible product actions with preview, audit history and undo.

It is Ctrl+Z for dangerous SaaS and internal-tool actions: preview the impact, execute safely, keep an audit trail, and undo when the action is explicitly modeled as reversible.

> Status: early v0 draft. The core lifecycle, PostgreSQL adapter, CLI and demo app are in active development. Public APIs may change before the first stable release.

## Why

Most destructive product actions start as one-off mutations:

- archive this project;
- remove this workspace member;
- change this user's role;
- publish or archive this document;
- import a batch of customer records.

The usual safety layer is a confirmation modal and some ad hoc logging. That is not enough when the action affects real customer data.

RollbackKit makes those operations explicit product actions:

```text
preview -> execute -> audit -> undo -> expire
```

The framework does not guess how to roll back arbitrary database writes. You define the action, the snapshots, the permissions, the conflict checks and the undo handler.

## What You Get

- **Preview before damage**: return UI-friendly impact, warnings, reversibility and undo window before mutation.
- **Durable audit history**: store who ran what, against which tenant/target, with status, timestamps, result and errors.
- **Explicit undo**: restore state through action-specific undo handlers and snapshots.
- **Fail-safe conflicts**: refuse unsafe undo when expected state no longer matches reality.
- **Honest side effects**: record external effects and classify them as reversible, partial, compensating or irreversible.
- **Storage adapters**: keep the core lifecycle storage-agnostic; PostgreSQL is the first official adapter.
- **CLI diagnostics**: run PostgreSQL migrations and inspect migration status from the command line.

## Packages

| Package | Purpose |
| --- | --- |
| `@rollbackkit/core` | Action definitions, lifecycle runtime, storage contracts and in-memory storage. |
| `@rollbackkit/postgres` | PostgreSQL storage adapter and schema migration runner. |
| `@rollbackkit/cli` | Migration and diagnostics CLI. |
| `apps/demo-next` | Next.js demo showing product actions end to end. |
| `apps/docs` | Architecture and setup documentation. |

Planned v0.x packages include `@rollbackkit/react`, `@rollbackkit/next` and `@rollbackkit/testkit`. They will be created after the app-local patterns are stable.

## Install

```bash
pnpm add @rollbackkit/core
```

For durable PostgreSQL storage and migrations:

```bash
pnpm add @rollbackkit/core @rollbackkit/postgres pg
pnpm add -D @rollbackkit/cli
```

RollbackKit currently targets Node.js 22 or newer and ESM projects.

## Getting Started

1. Define a product action with `defineAction`.
2. Preview the impact before mutation.
3. Execute the action through `createRollbackKit`.
4. Save snapshots from the execute handler when undo needs previous state.
5. Provide an undo handler for actions that are truly reversible.

## Action Shape

An action definition owns the complete safety story for one product operation:

```ts
import { createRollbackKit, defineAction, REVERSIBILITY } from '@rollbackkit/core';

const projectArchiveAction = defineAction({
    name: 'project.archive',
    reversibility: REVERSIBILITY.full,
    undoWindowMs: 30 * 60 * 1000,

    input: {
        parse(input) {
            if (typeof input !== 'object' || input === null || Array.isArray(input)) {
                throw new Error('Expected project archive input.');
            }

            return input as {
                readonly workspaceId: string;
                readonly projectId: string;
            };
        },
    },

    async preview({ input }) {
        return {
            title: 'Archive project',
            summary: 'The project will be hidden from active workspace views.',
            impact: [
                { label: `Project ${input.projectId} moves to archived state`, severity: 'warning' },
                { label: 'Previous project state will be saved for undo', severity: 'info' },
            ],
            reversibility: REVERSIBILITY.full,
        };
    },

    async execute({ input, snapshots }) {
        const previousProject = await loadProject(input.workspaceId, input.projectId);

        await snapshots.save('previousProject', previousProject);
        await archiveProject(input.workspaceId, input.projectId);

        return {
            data: {
                projectId: input.projectId,
                status: 'archived',
            },
        };
    },

    async undo({ snapshots }) {
        const snapshot = await snapshots.get('previousProject');

        if (snapshot === null) {
            throw new Error('Previous project snapshot is missing.');
        }

        await restoreProject(snapshot.value);

        return {
            data: snapshot.value,
        };
    },
});

const rollbackkit = createRollbackKit({
    actions: [projectArchiveAction],
});
```

The application supplies the actual product reads/writes (`loadProject`, `archiveProject`, `restoreProject`) and authorization rules. RollbackKit supplies the lifecycle, persistence contracts, history and undo safety boundaries.

## Local Demo

Create a local PostgreSQL database, then run:

```bash
ROLLBACKKIT_DEMO_DATABASE_URL="postgres://user:password@localhost:5432/rollbackkit_test" \
pnpm --filter @rollbackkit/demo-next db:reset
```

Start the demo:

```bash
ROLLBACKKIT_DEMO_DATABASE_URL="postgres://user:password@localhost:5432/rollbackkit_test" \
pnpm --filter @rollbackkit/demo-next dev
```

Open:

```text
http://localhost:3000
```

The demo currently covers:

- `project.archive`;
- `member.change_role`;
- `member.remove`;
- action preview;
- audit history;
- undo.

Planned demo scenarios include document archive, customer import rollback, conflict handling and irreversible side-effect warnings.

## PostgreSQL Migrations

From source:

```bash
pnpm build

ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm --filter @rollbackkit/cli exec node dist/bin.mjs doctor

ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm --filter @rollbackkit/cli exec node dist/bin.mjs migrate
```

The PostgreSQL migration runner stores applied migrations and checksums in `rollbackkit_schema_migrations`.

## Non-Goals

RollbackKit is not:

- a workflow engine;
- an event sourcing framework;
- a database backup tool;
- a low-code automation platform;
- a magic rollback layer for arbitrary external side effects.

If an action cannot be safely undone, RollbackKit should make that explicit instead of pretending otherwise.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
