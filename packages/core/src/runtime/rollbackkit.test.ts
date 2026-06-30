import { describe, expect, it } from 'vitest';

import {
    type ActionActor,
    createRollbackKit,
    defineAction,
    type JsonObject,
    REVERSIBILITY,
    RollbackKitError,
} from '../index';

const actor: ActionActor = {
    id: 'user_1',
    type: 'user',
    displayName: 'Test User',
};

describe('RollbackKit preview lifecycle', () => {
    it('runs action preview', async () => {
        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    undoWindowMs: 30_000,
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [
                            {
                                label: 'Project will be archived',
                                severity: 'warning',
                            },
                        ],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                }),
            ],
        });

        await expect(
            kit.preview({
                name: 'project.archive',
                actor,
                input: {
                    projectId: 'project_1',
                },
            }),
        ).resolves.toEqual({
            title: 'Archive project',
            impact: [
                {
                    label: 'Project will be archived',
                    severity: 'warning',
                },
            ],
            reversibility: REVERSIBILITY.full,
            undoWindowMs: 30_000,
        });
    });

    it('validates input through action input parser', async () => {
        const kit = createRollbackKit({
            actions: [
                defineAction<JsonObject>({
                    name: 'member.change_role',
                    input: {
                        parse: (input) => {
                            if (
                                typeof input === 'object' &&
                                input !== null &&
                                'memberId' in input &&
                                'role' in input &&
                                typeof input.memberId === 'string' &&
                                typeof input.role === 'string'
                            ) {
                                return {
                                    memberId: input.memberId,
                                    role: input.role,
                                };
                            }

                            throw new Error('Invalid member role input.');
                        },
                    },
                    reversibility: REVERSIBILITY.full,
                    preview: async (context) => ({
                        title: `Change role to ${context.input.role}`,
                        impact: [
                            {
                                label: `Member ${context.input.memberId} will be updated`,
                            },
                        ],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                }),
            ],
        });

        await expect(
            kit.preview({
                name: 'member.change_role',
                actor,
                input: {
                    memberId: 'member_1',
                    role: 'admin',
                },
            }),
        ).resolves.toEqual({
            title: 'Change role to admin',
            impact: [
                {
                    label: 'Member member_1 will be updated',
                },
            ],
            reversibility: REVERSIBILITY.full,
        });
    });

    it('rejects invalid input from parser', async () => {
        const kit = createRollbackKit({
            actions: [
                defineAction<JsonObject>({
                    name: 'member.change_role',
                    input: {
                        parse: () => {
                            throw new Error('Invalid input.');
                        },
                    },
                    reversibility: REVERSIBILITY.full,
                    preview: async () => ({
                        title: 'Change role',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                }),
            ],
        });

        await expect(
            kit.preview({
                name: 'member.change_role',
                actor,
                input: {
                    memberId: 'member_1',
                },
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_INPUT_INVALID',
        });
    });

    it('rejects non-json input when no parser is provided', async () => {
        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                }),
            ],
        });

        await expect(
            kit.preview({
                name: 'project.archive',
                actor,
                input: {
                    projectId: 'project_1',
                    invalid: new Date(),
                },
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_INPUT_INVALID',
        });
    });

    it('resolves target before preview', async () => {
        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    resolveTarget: async (context) => ({
                        id:
                            typeof context.input === 'object' &&
                            context.input !== null &&
                            !Array.isArray(context.input) &&
                            typeof context.input.projectId === 'string'
                                ? context.input.projectId
                                : 'unknown',
                        type: 'project',
                        label: 'Demo project',
                    }),
                    preview: async (context) => ({
                        title: `Archive ${context.target?.label}`,
                        impact: [
                            {
                                label: `Target: ${context.target?.type}/${context.target?.id}`,
                            },
                        ],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                }),
            ],
        });

        await expect(
            kit.preview({
                name: 'project.archive',
                actor,
                input: {
                    projectId: 'project_1',
                },
            }),
        ).resolves.toEqual({
            title: 'Archive Demo project',
            impact: [
                {
                    label: 'Target: project/project_1',
                },
            ],
            reversibility: REVERSIBILITY.full,
        });
    });

    it('checks preview permission', async () => {
        const kit = createRollbackKit({
            actions: [
                defineAction({
                    name: 'project.archive',
                    reversibility: REVERSIBILITY.full,
                    authorize: async () => ({
                        allowed: false,
                        reason: 'Only workspace owners can archive projects.',
                    }),
                    preview: async () => ({
                        title: 'Archive project',
                        impact: [],
                        reversibility: REVERSIBILITY.full,
                    }),
                    execute: async () => ({}),
                }),
            ],
        });

        await expect(
            kit.preview({
                name: 'project.archive',
                actor,
                input: {
                    projectId: 'project_1',
                },
            }),
        ).rejects.toMatchObject({
            code: 'ACTION_PERMISSION_DENIED',
        });
    });

    it('accepts typed action definitions in constructor options', async () => {
        interface ProjectArchiveInput extends JsonObject {
            readonly projectId: string;
        }

        const action = defineAction<ProjectArchiveInput>({
            name: 'project.archive.typed',
            input: {
                parse: (input) => {
                    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
                        throw new Error('Invalid project archive input.');
                    }

                    const candidate = input as {
                        readonly projectId?: unknown;
                    };

                    if (typeof candidate.projectId !== 'string') {
                        throw new Error('Invalid project archive input.');
                    }

                    return {
                        projectId: candidate.projectId,
                    };
                },
            },
            reversibility: REVERSIBILITY.full,
            resolveTarget: async (context) => ({
                id: context.input.projectId,
                type: 'project',
            }),
            preview: async (context) => ({
                title: `Archive ${context.input.projectId}`,
                impact: [],
                reversibility: REVERSIBILITY.full,
            }),
            execute: async (context) => ({
                data: {
                    projectId: context.input.projectId,
                },
            }),
        });

        const kit = createRollbackKit({
            actions: [action],
        });

        expect(kit.registry.has('project.archive.typed')).toBe(true);

        await expect(
            kit.preview({
                name: 'project.archive.typed',
                actor,
                input: {
                    projectId: 'project_1',
                },
            }),
        ).resolves.toEqual({
            title: 'Archive project_1',
            impact: [],
            reversibility: REVERSIBILITY.full,
        });
    });

    it('throws for missing actions', async () => {
        const kit = createRollbackKit();

        await expect(
            kit.preview({
                name: 'missing.action',
                actor,
                input: {},
            }),
        ).rejects.toBeInstanceOf(RollbackKitError);
    });
});
