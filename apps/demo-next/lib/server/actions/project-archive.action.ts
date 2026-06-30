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

export const PROJECT_ARCHIVE_ACTION_NAME = 'project.archive';

const PROJECT_ARCHIVE_UNDO_WINDOW_MS = 30 * 60 * 1000;
const PREVIOUS_PROJECT_STATE_SNAPSHOT_KEY = 'previousProjectState';

type ProjectArchiveInput = JsonObject & {
    readonly projectId: string;
};

interface ProjectArchiveResult extends JsonObject {
    readonly projectId: string;
    readonly status: DemoProjectStorageStatus;
    readonly archivedAt: string | null;
}

interface PreviousProjectStateSnapshot extends JsonObject {
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
            const project = await getProjectOrThrow(executor, context.input.projectId);

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
            const project = await getProjectOrThrow(executor, context.input.projectId);
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
            const project = await getProjectOrThrow(executor, context.input.projectId);

            if (project.status === 'archived') {
                throw createProjectConflictError(project.id, 'Project is already archived.');
            }

            await context.snapshots.save(
                PREVIOUS_PROJECT_STATE_SNAPSHOT_KEY,
                createPreviousProjectStateSnapshot(project),
            );

            const archivedProject = await archiveProject(executor, project.id);

            return {
                data: mapProjectResult(archivedProject),
                metadata: {
                    projectName: project.name,
                },
            };
        },

        undo: async (context) => {
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

            const currentProject = await getProjectOrThrow(executor, snapshot.value.projectId);

            if (currentProject.status !== 'archived') {
                throw createProjectConflictError(
                    currentProject.id,
                    'Project is no longer archived, so undo would be unsafe.',
                );
            }

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

function parseProjectArchiveInput(input: unknown): ProjectArchiveInput {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error('Project archive input must be an object.');
    }

    const candidate = input as {
        readonly projectId?: unknown;
    };

    if (typeof candidate.projectId !== 'string' || candidate.projectId.trim() === '') {
        throw new Error('Project archive input requires projectId.');
    }

    return {
        projectId: candidate.projectId.trim(),
    } as ProjectArchiveInput;
}

async function getProjectOrThrow(
    executor: PostgresQueryExecutor,
    projectId: string,
): Promise<DemoProjectRecord> {
    const project = await findDemoProjectById(executor, projectId);

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
    projectId: string,
): Promise<DemoProjectRecord> {
    await archiveDemoProject(executor, projectId);

    return getProjectOrThrow(executor, projectId);
}

async function restoreProject(
    executor: PostgresQueryExecutor,
    snapshot: PreviousProjectStateSnapshot,
): Promise<DemoProjectRecord> {
    await restoreDemoProject(executor, snapshot);

    return getProjectOrThrow(executor, snapshot.projectId);
}

function createPreviousProjectStateSnapshot(
    project: DemoProjectRecord,
): PreviousProjectStateSnapshot {
    return {
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
