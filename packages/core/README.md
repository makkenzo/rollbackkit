# @rollbackkit/core

Core lifecycle and contracts for RollbackKit.

Use this package to define previewable, auditable and undoable product actions without choosing a
storage adapter.

## Install

```bash
pnpm add @rollbackkit/core
```

## Example

```ts
import { createRollbackKit, defineAction, REVERSIBILITY } from '@rollbackkit/core';

const archiveProject = defineAction({
    name: 'project.archive',
    reversibility: REVERSIBILITY.full,
    undoWindowMs: 30 * 60 * 1000,
    preview: async () => ({
        title: 'Archive project',
        impact: [{ label: 'Project will be hidden from active lists', severity: 'warning' }],
        reversibility: REVERSIBILITY.full,
    }),
    execute: async ({ snapshots }) => {
        await snapshots.save('previousProject', { status: 'active' });

        return {
            data: { status: 'archived' },
        };
    },
    undo: async ({ snapshots }) => {
        const previousProject = await snapshots.require('previousProject');

        return {
            data: previousProject.value,
        };
    },
});

const rollbackkit = createRollbackKit({
    actions: [archiveProject],
});
```

The default storage adapter is in memory. Use `@rollbackkit/postgres` for persistent action runs,
snapshots, side effects, conflicts and history.
