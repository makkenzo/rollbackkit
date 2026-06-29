import { describe, expect, it } from 'vitest';

import {
    ActionRegistry,
    createActionRegistry,
    defineAction,
    isRollbackKitError,
    REVERSIBILITY,
    RollbackKitError,
} from './index';

function createTestAction(name: string) {
    return defineAction({
        name,
        reversibility: REVERSIBILITY.full,
        preview: async () => ({
            title: name,
            impact: [],
            reversibility: REVERSIBILITY.full,
        }),
        execute: async () => ({}),
    });
}

describe('ActionRegistry', () => {
    it('starts empty', () => {
        const registry = createActionRegistry();

        expect(registry.size).toBe(0);
        expect(registry.list()).toEqual([]);
    });

    it('registers and retrieves actions', () => {
        const action = createTestAction('project.archive');
        const registry = createActionRegistry();

        registry.register(action);

        expect(registry.size).toBe(1);
        expect(registry.has('project.archive')).toBe(true);
        expect(registry.get('project.archive')).toBe(action);
        expect(registry.require('project.archive')).toBe(action);
        expect(registry.list()).toEqual([action]);
    });

    it('registers initial actions from constructor', () => {
        const action = createTestAction('member.remove');
        const registry = new ActionRegistry([action]);

        expect(registry.size).toBe(1);
        expect(registry.require('member.remove')).toBe(action);
    });

    it('registers multiple actions', () => {
        const first = createTestAction('project.archive');
        const second = createTestAction('member.change_role');

        const registry = createActionRegistry();

        registry.registerMany([first, second]);

        expect(registry.size).toBe(2);
        expect(registry.list()).toEqual([first, second]);
    });

    it('rejects duplicate action names', () => {
        const registry = createActionRegistry();

        registry.register(createTestAction('project.archive'));

        try {
            registry.register(createTestAction('project.archive'));
        } catch (error) {
            if (!isRollbackKitError(error)) {
                throw error;
            }

            expect(error).toBeInstanceOf(RollbackKitError);
            expect(error.code).toBe('ACTION_ALREADY_REGISTERED');
            expect(error.details).toEqual({
                actionName: 'project.archive',
            });

            return;
        }

        throw new Error('Expected duplicate action registration to fail.');
    });

    it('throws when requiring a missing action', () => {
        const registry = createActionRegistry();

        try {
            registry.require('missing.action');
        } catch (error) {
            if (!isRollbackKitError(error)) {
                throw error;
            }

            expect(error).toBeInstanceOf(RollbackKitError);
            expect(error.code).toBe('ACTION_NOT_FOUND');
            expect(error.details).toEqual({
                actionName: 'missing.action',
            });

            return;
        }

        throw new Error('Expected missing action lookup to fail.');
    });
});
