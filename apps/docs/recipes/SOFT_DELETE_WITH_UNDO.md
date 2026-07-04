# Soft Delete With Undo

Use this recipe when a product record should disappear from active views without being destroyed.

The common example is archiving a project. The action should preview the impact, save the previous
state, change the project status, and restore the previous state during undo.

## What Problem It Solves

A raw soft-delete handler usually looks harmless:

```ts
await archiveProject(projectId);
```

But the product still needs answers:

- what will happen before the user confirms;
- whether related records stay attached;
- what previous state is needed for undo;
- when undo expires;
- what makes undo unsafe.

RollbackKit puts those answers in the action definition.

## When To Use It

Use this pattern for:

- project archive;
- document archive;
- workspace item deactivation;
- hiding a record from active views while keeping history.

Do not use this pattern for hard delete. Hard delete needs a different snapshot and retention
strategy.

## Action Shape

```ts
import { defineAction, REVERSIBILITY, RollbackKitError } from '@rollbackkit/core';

const PREVIOUS_PROJECT_STATE = 'previousProjectState';

export const projectArchiveAction = defineAction({
    name: 'project.archive',
    reversibility: REVERSIBILITY.full,
    undoWindowMs: 30 * 60 * 1000,

    input: {
        parse(input) {
            const candidate = input as { readonly workspaceId?: unknown; readonly projectId?: unknown };

            if (typeof candidate.workspaceId !== 'string') {
                throw new Error('workspaceId is required.');
            }

            if (typeof candidate.projectId !== 'string') {
                throw new Error('projectId is required.');
            }

            return {
                workspaceId: candidate.workspaceId,
                projectId: candidate.projectId,
            };
        },
    },

    async preview({ input }) {
        const project = await loadProject(input.workspaceId, input.projectId);

        return {
            title: `Archive ${project.name}`,
            summary: 'The project will be removed from active views.',
            impact: [
                { label: 'Project moves to archived state', severity: 'warning' },
                { label: `${project.documentCount} documents remain attached`, severity: 'info' },
                { label: 'Previous project state will be saved for undo', severity: 'info' },
            ],
            reversibility: REVERSIBILITY.full,
        };
    },

    async execute({ input, snapshots }) {
        const project = await loadProject(input.workspaceId, input.projectId);

        if (project.status === 'archived') {
            throw new RollbackKitError({
                code: 'ACTION_CONFLICT',
                message: 'Project is already archived.',
                details: { projectId: project.id },
            });
        }

        await snapshots.save(PREVIOUS_PROJECT_STATE, {
            id: project.id,
            workspaceId: project.workspaceId,
            status: project.status,
            archivedAt: project.archivedAt,
            updatedAt: project.updatedAt,
        });

        const archivedProject = await archiveProject(project.workspaceId, project.id);

        return {
            data: {
                projectId: archivedProject.id,
                status: archivedProject.status,
                archivedAt: archivedProject.archivedAt,
            },
        };
    },

    async checkConflicts({ snapshots, conflicts }) {
        const snapshot = await snapshots.get<{
            readonly workspaceId: string;
            readonly id: string;
        }>(PREVIOUS_PROJECT_STATE);

        if (snapshot === null) {
            throw new Error('Previous project state snapshot is missing.');
        }

        const currentProject = await loadProject(snapshot.value.workspaceId, snapshot.value.id);

        if (currentProject.status !== 'archived') {
            await conflicts.record('Project is no longer archived, so undo would be unsafe.', {
                projectId: currentProject.id,
            });

            throw new RollbackKitError({
                code: 'ACTION_CONFLICT',
                message: 'Project is no longer archived, so undo would be unsafe.',
                details: { projectId: currentProject.id },
            });
        }
    },

    async undo({ snapshots }) {
        const snapshot = await snapshots.get<{
            readonly workspaceId: string;
            readonly id: string;
            readonly status: 'active' | 'archived';
            readonly archivedAt: string | null;
            readonly updatedAt: string;
        }>(PREVIOUS_PROJECT_STATE);

        if (snapshot === null) {
            throw new Error('Previous project state snapshot is missing.');
        }

        const restoredProject = await restoreProject(snapshot.value);

        return {
            data: {
                projectId: restoredProject.id,
                status: restoredProject.status,
                archivedAt: restoredProject.archivedAt,
            },
        };
    },
});
```

`loadProject`, `archiveProject` and `restoreProject` are application-owned data access functions.
RollbackKit owns the lifecycle and persistence boundary, not your product schema.

## Wire Preview, Execute And Undo

```ts
const preview = await rollbackkit.preview({
    name: 'project.archive',
    actor,
    tenantId: workspaceId,
    input: { workspaceId, projectId },
});

const run = await rollbackkit.execute({
    name: 'project.archive',
    actor,
    tenantId: workspaceId,
    input: { workspaceId, projectId },
    idempotencyKey: requestId,
});

await rollbackkit.undo({
    actionRunId: run.id,
    actor,
    tenantId: workspaceId,
});
```

## Expected Result

- Preview shows the project impact before mutation.
- Execute saves the previous project state and archives the project.
- Audit history stores the action run, actor, target, input, timestamps and result.
- Undo restores the saved project state if the project is still archived.
- Undo fails with a conflict if another change already made rollback unsafe.

## Common Mistakes

- Saving too little state in the snapshot.
- Treating archive as hard delete.
- Mutating product state in `preview`.
- Letting undo blindly write old state without checking current state.
- Reusing an idempotency key with different input.

## Related Pages

- [Getting Started](../GETTING_STARTED.md)
- [Core Lifecycle](../CORE_LIFECYCLE.md)
- [Why rollback-first](../WHY_ROLLBACK_FIRST.md)
- [PostgreSQL Setup](../POSTGRESQL_SETUP.md)
