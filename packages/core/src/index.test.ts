import { describe, expect, it } from 'vitest';
import packageJson from '../package.json';

import {
    defineAction,
    isRollbackKitError,
    isUndoable,
    REVERSIBILITY,
    RollbackKitError,
    rollbackkitVersion,
} from './index';

describe('@rollbackkit/core', () => {
    it('exports package version from package metadata', () => {
        expect(rollbackkitVersion).toBe(packageJson.version);
    });

    it('defines action contracts', () => {
        const action = defineAction({
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
                undoWindowMs: 30_000,
            }),
            execute: async () => ({
                data: {
                    archived: true,
                },
            }),
            undo: async () => ({
                data: {
                    restored: true,
                },
            }),
        });

        expect(action.name).toBe('project.archive');
        expect(isUndoable(action.reversibility)).toBe(true);
    });

    it('serializes RollbackKit errors', () => {
        const error = new RollbackKitError({
            code: 'ACTION_NOT_UNDOABLE',
            message: 'Action cannot be undone.',
            details: {
                actionRunId: 'run_123',
            },
        });

        expect(isRollbackKitError(error)).toBe(true);
        expect(error.toJSON()).toEqual({
            code: 'ACTION_NOT_UNDOABLE',
            message: 'Action cannot be undone.',
            details: {
                actionRunId: 'run_123',
            },
        });
    });
});
