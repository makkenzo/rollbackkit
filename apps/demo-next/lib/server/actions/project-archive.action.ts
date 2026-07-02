import 'server-only';

import { defineAction, type JsonObject, REVERSIBILITY, RollbackKitError } from '@rollbackkit/core';
import type { PostgresQueryExecutor } from '@rollbackkit/postgres';
import {
    archiveDemoProject,
    type DemoProjectRecord,
    type DemoProjectStorageStatus,
    findDemoProjectById,
    restoreDemoProject,
} from '../repositories/project-repository';
import { assertDemoWorkspaceScope } from './demo-action-scope';

export const PROJECT_ARCHIVE_ACTION_NAME = 'project.archive';

const PROJECT_ARCHIVE_UNDO_WINDOW_MS = 30 * 60 * 1000;
const PREVIOUS_PROJECT_STATE_SNAPSHOT_KEY = 'previousProjectState';

type ProjectArchiveInput = JsonObject & {
    readonly workspaceId: string;
    readonly projectId: string;
};

interface ProjectArchiveResult extends JsonObject {
    readonly projectId: string;
    readonly status: DemoProjectStorageStatus;
    readonly archivedAt: string | null;
}

interface PreviousProjectStateSnapshot extends JsonObject {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly status: DemoProjectStorageStatus;
    readonly archivedAt: string | null;
    readonly updatedAt: string;
}

export function createProjectArchiveAction(executor: PostgresQueryExecutor) {
    return defineAction<ProjectArchiveInput, ProjectArchiveResult, ProjectArchiveResult>({
        name: PROJECT_ARCHIVE_ACTION_NAME,
        input: {
            parse: parseProjectArchiveInput,
        },
        reversibility: REVERSIBILITY.full,
        undoWindowMs: PROJECT_ARCHIVE_UNDO_WINDOW_MS,

        resolveTarget: async (context) => {
            assertDemoWorkspaceScope(context);

            const project = await getProjectOrThrow(
                executor,
                context.input.workspaceId,
                context.input.projectId,
            );

            return {
                id: project.id,
                type: 'project',
                label: project.name,
                metadata: {
                    status: project.status,
                },
            };
        },

        preview: async (context) => {
            assertDemoWorkspaceScope(context);

            const project = await getProjectOrThrow(
                executor,
                context.input.workspaceId,
                context.input.projectId,
            );
            const documentCount = parseDocumentCount(project.document_count);
            const alreadyArchived = project.status === 'archived';

            return {
                title: `Archive ${project.name}`,
                summary:
                    'The project will be removed from active workspace views while its data remains available for undo.',
                impact: [
                    {
                        label: 'Project moves to archived state',
                        severity: 'warning',
                    },
                    {
                        label: formatDocumentImpact(documentCount),
                        severity: 'info',
                    },
                    {
                        label: 'Previous project state will be saved for undo',
                        severity: 'info',
                    },
                ],
                reversibility: REVERSIBILITY.full,
                ...(alreadyArchived
                    ? {
                          warnings: ['This project is already archived.'],
                      }
                    : {}),
            };
        },

        execute: async (context) => {
            assertDemoWorkspaceScope(context);

            const project = await getProjectOrThrow(
                executor,
                context.input.workspaceId,
                context.input.projectId,
            );

            if (project.status === 'archived') {
                throw createProjectConflictError(project.id, 'Project is already archived.');
            }

            await context.snapshots.save(
                PREVIOUS_PROJECT_STATE_SNAPSHOT_KEY,
                createPreviousProjectStateSnapshot(project),
            );

            const archivedProject = await archiveProject(
                executor,
                context.input.workspaceId,
                project.id,
            );

            return {
                data: mapProjectResult(archivedProject),
                metadata: {
                    projectName: project.name,
                },
            };
        },

        checkConflicts: async (context) => {
            assertDemoWorkspaceScope(context);

            const snapshot = await readPreviousProjectStateSnapshot(context);
            const currentProject = await findDemoProjectById(
                executor,
                snapshot.value.workspaceId,
                snapshot.value.projectId,
            );

            if (currentProject === null) {
                const reason = 'Project no longer exists, so undo would be unsafe.';

                await context.conflicts.record(reason, {
                    expectedState: 'Project exists and is Archived',
                    actualState: 'Project no longer exists',
                    suggestedNextStep: 'Review the current project status before retrying undo.',
                });

                throw createProjectConflictError(snapshot.value.projectId, reason);
            }

            if (currentProject.status !== 'archived') {
                const reason = 'Project is no longer archived, so undo would be unsafe.';

                await context.conflicts.record(reason, {
                    expectedState: 'Project status is Archived',
                    actualState: `Project status is ${formatProjectStatusLabel(currentProject.status)}`,
                    suggestedNextStep: 'Review the current project status before retrying undo.',
                });

                throw createProjectConflictError(currentProject.id, reason);
            }
        },

        undo: async (context) => {
            assertDemoWorkspaceScope(context);

            const snapshot = await readPreviousProjectStateSnapshot(context);

            const restoredProject = await restoreProject(executor, snapshot.value);

            return {
                data: mapProjectResult(restoredProject),
                metadata: {
                    projectName: restoredProject.name,
                },
            };
        },
    });
}

async function readPreviousProjectStateSnapshot(context: {
    readonly run: { readonly id: string };
    readonly snapshots: {
        get<TValue extends JsonObject>(key: string): Promise<{ readonly value: TValue } | null>;
    };
}): Promise<{ readonly value: PreviousProjectStateSnapshot }> {
    const snapshot = await context.snapshots.get<PreviousProjectStateSnapshot>(
        PREVIOUS_PROJECT_STATE_SNAPSHOT_KEY,
    );

    if (snapshot === null) {
        throw new RollbackKitError({
            code: 'SNAPSHOT_NOT_FOUND',
            message: 'Previous project state snapshot was not found.',
            details: {
                actionRunId: context.run.id,
                snapshotKey: PREVIOUS_PROJECT_STATE_SNAPSHOT_KEY,
            },
        });
    }

    return snapshot;
}

function parseProjectArchiveInput(input: unknown): ProjectArchiveInput {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error('Project archive input must be an object.');
    }

    const candidate = input as {
        readonly workspaceId?: unknown;
        readonly projectId?: unknown;
    };

    if (typeof candidate.workspaceId !== 'string' || candidate.workspaceId.trim() === '') {
        throw new Error('Project archive input requires workspaceId.');
    }

    if (typeof candidate.projectId !== 'string' || candidate.projectId.trim() === '') {
        throw new Error('Project archive input requires projectId.');
    }

    return {
        workspaceId: candidate.workspaceId.trim(),
        projectId: candidate.projectId.trim(),
    } as ProjectArchiveInput;
}

async function getProjectOrThrow(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    projectId: string,
): Promise<DemoProjectRecord> {
    const project = await findDemoProjectById(executor, workspaceId, projectId);

    if (project === null) {
        throw new RollbackKitError({
            code: 'ACTION_NOT_FOUND',
            message: `Project "${projectId}" was not found.`,
            details: {
                projectId,
            },
        });
    }

    return project;
}

async function archiveProject(
    executor: PostgresQueryExecutor,
    workspaceId: string,
    projectId: string,
): Promise<DemoProjectRecord> {
    await archiveDemoProject(executor, workspaceId, projectId);

    return getProjectOrThrow(executor, workspaceId, projectId);
}

async function restoreProject(
    executor: PostgresQueryExecutor,
    snapshot: PreviousProjectStateSnapshot,
): Promise<DemoProjectRecord> {
    await restoreDemoProject(executor, snapshot);

    return getProjectOrThrow(executor, snapshot.workspaceId, snapshot.projectId);
}

function createPreviousProjectStateSnapshot(
    project: DemoProjectRecord,
): PreviousProjectStateSnapshot {
    return {
        workspaceId: project.workspace_id,
        projectId: project.id,
        status: project.status,
        archivedAt: normalizeNullableDate(project.archived_at),
        updatedAt: normalizeDate(project.updated_at),
    };
}

function mapProjectResult(project: DemoProjectRecord): ProjectArchiveResult {
    return {
        projectId: project.id,
        status: project.status,
        archivedAt: normalizeNullableDate(project.archived_at),
    };
}

function normalizeNullableDate(value: Date | string | null): string | null {
    return value === null ? null : normalizeDate(value);
}

function normalizeDate(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new TypeError('Invalid project timestamp value.');
    }

    return date.toISOString();
}

function parseDocumentCount(value: number | string): number {
    const count = Number(value);

    if (!Number.isInteger(count) || count < 0) {
        throw new TypeError('Invalid project document count.');
    }

    return count;
}

function formatDocumentImpact(count: number): string {
    return count === 1 ? '1 document remains attached' : `${count} documents remain attached`;
}

function formatProjectStatusLabel(status: DemoProjectStorageStatus): string {
    switch (status) {
        case 'active':
            return 'Active';
        case 'archived':
            return 'Archived';
    }
}

function createProjectConflictError(projectId: string, reason: string): RollbackKitError {
    return new RollbackKitError({
        code: 'ACTION_CONFLICT',
        message: `Project "${projectId}" cannot be archived safely: ${reason}`,
        details: {
            projectId,
            reason,
        },
    });
}
