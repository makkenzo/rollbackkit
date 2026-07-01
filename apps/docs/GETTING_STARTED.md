# Getting Started

This guide shows the shortest path from installation to a first reversible action.

## What Problem It Solves

You have a product mutation that should not be just a raw server handler. You want to preview its
impact, execute it through a lifecycle, keep an action run, and support undo when the action is
still safe to reverse.

## When To Use It

Start with `@rollbackkit/core` when you are modeling the action shape. Add `@rollbackkit/postgres`
when you need durable action history and snapshots.

## 1. Install

```bash
pnpm add @rollbackkit/core
```

For PostgreSQL persistence:

```bash
pnpm add @rollbackkit/core @rollbackkit/postgres pg
pnpm add -D @rollbackkit/cli
```

RollbackKit currently targets Node.js 22 or newer and ESM projects.

## 2. Define An Action

```ts
import { createRollbackKit, defineAction, REVERSIBILITY } from '@rollbackkit/core';

interface Project {
    readonly id: string;
    readonly status: 'active' | 'archived';
}

const projects = new Map<string, Project>([
    ['project_1', { id: 'project_1', status: 'active' }],
]);

const projectArchiveAction = defineAction({
    name: 'project.archive',
    reversibility: REVERSIBILITY.full,
    undoWindowMs: 30 * 60 * 1000,

    input: {
        parse(input) {
            if (typeof input !== 'object' || input === null || Array.isArray(input)) {
                throw new Error('Expected project archive input.');
            }

            const projectId = (input as { readonly projectId?: unknown }).projectId;

            if (typeof projectId !== 'string') {
                throw new Error('Expected projectId.');
            }

            return { projectId };
        },
    },

    async preview({ input }) {
        return {
            title: 'Archive project',
            summary: `Project ${input.projectId} will be hidden from active views.`,
            impact: [
                { label: 'Project status changes to archived', severity: 'warning' },
                { label: 'Previous project state is saved for undo', severity: 'info' },
            ],
            reversibility: REVERSIBILITY.full,
        };
    },

    async execute({ input, snapshots }) {
        const project = projects.get(input.projectId);

        if (project === undefined) {
            throw new Error('Project not found.');
        }

        await snapshots.save('previousProject', project);
        projects.set(input.projectId, { ...project, status: 'archived' });

        return {
            data: {
                projectId: input.projectId,
                status: 'archived',
            },
        };
    },

    async undo({ snapshots }) {
        const snapshot = await snapshots.get<Project>('previousProject');

        if (snapshot === null) {
            throw new Error('Previous project snapshot is missing.');
        }

        projects.set(snapshot.value.id, snapshot.value);

        return {
            data: snapshot.value,
        };
    },
});

export const rollbackkit = createRollbackKit({
    actions: [projectArchiveAction],
});
```

## 3. Preview Before Mutation

```ts
const preview = await rollbackkit.preview({
    name: 'project.archive',
    actor: {
        id: 'user_1',
        type: 'user',
    },
    input: {
        projectId: 'project_1',
    },
});
```

Expected result: the UI can show the title, summary, impact list and reversibility before the
project is archived.

## 4. Execute With Idempotency

```ts
const run = await rollbackkit.execute({
    name: 'project.archive',
    actor: {
        id: 'user_1',
        type: 'user',
    },
    input: {
        projectId: 'project_1',
    },
    idempotencyKey: 'request_123',
});
```

Expected result: RollbackKit creates an action run, saves the snapshot from `execute`, marks the run
completed and returns the run. Retrying the same request with the same idempotency key and input
returns the existing run.

## 5. Undo

```ts
const undone = await rollbackkit.undo({
    actionRunId: run.id,
    actor: {
        id: 'user_1',
        type: 'user',
    },
});
```

Expected result: RollbackKit checks the action run, undo window and current status, reads the saved
snapshot, calls the action undo handler and marks the action run as undone.

## 6. Add PostgreSQL Persistence

The default storage is in memory. For real applications, run PostgreSQL migrations and create a
`PostgresStore`.

```bash
ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm exec rollbackkit migrate
```

```ts
import { createPostgresStore } from '@rollbackkit/postgres';
import { Client } from 'pg';

const client = new Client({
    connectionString: process.env.ROLLBACKKIT_DATABASE_URL,
});

await client.connect();

const rollbackkit = createRollbackKit({
    storage: createPostgresStore({
        executor: client,
    }),
    actions: [projectArchiveAction],
});
```

See [PostgreSQL Setup](./POSTGRESQL_SETUP.md) for migration commands, locking notes and table
details.

If a setup command fails, see [Troubleshooting](./TROUBLESHOOTING.md) for the common database URL,
workspace build, migration checksum, idempotency and undo errors.

## Common Mistakes

- Do not mutate product state in `preview`.
- Do not accept `actor` or `tenantId` from untrusted client payloads.
- Do not mark an action as fully reversible unless its undo handler can actually restore state.
- Do not store secrets or unnecessary sensitive data in snapshots.
- Do not pass a bare `pg.Pool` directly to `createPostgresStore` for undo flows; use a single
  `pg.Client` or `pg.PoolClient`.
- Do not reuse an idempotency key with different input.

## Related Pages

- [Introduction](./INTRODUCTION.md)
- [Why rollback-first](./WHY_ROLLBACK_FIRST.md)
- [Core Lifecycle](./CORE_LIFECYCLE.md)
- [Security Baseline](./SECURITY.md)
- [PostgreSQL Setup](./POSTGRESQL_SETUP.md)
- [Troubleshooting](./TROUBLESHOOTING.md)
- [Recipes](./recipes/README.md)
- [Soft Delete With Undo](./recipes/SOFT_DELETE_WITH_UNDO.md)
- [Change User Role Safely](./recipes/CHANGE_USER_ROLE.md)
- [Remove Workspace Member With Undo](./recipes/REMOVE_WORKSPACE_MEMBER.md)
- [Conflict Detection](./recipes/CONFLICT_DETECTION.md)
