'use client';

import type { PreviewResult } from '@rollbackkit/core';
import { useState, useTransition } from 'react';
import type { DemoActionResponse, DemoActionRunDto } from '@/lib/demo-action-types';
import type { ActionPreviewError } from './action-preview-dialog';

interface PreviewableDemoActionOptions {
    readonly createIdempotencyKey: () => string;
    readonly preview: () => Promise<DemoActionResponse<PreviewResult>>;
    readonly execute: (idempotencyKey: string) => Promise<DemoActionResponse<DemoActionRunDto>>;
}

export interface PreviewableDemoActionState {
    readonly isBusy: boolean;
    readonly isDialogOpen: boolean;
    readonly preview: PreviewResult | null;
    readonly error: ActionPreviewError | null;
    readonly openPreview: () => void;
    readonly closeDialog: () => void;
    readonly confirm: () => void;
}

export function usePreviewableDemoAction(
    options: PreviewableDemoActionOptions,
): PreviewableDemoActionState {
    const [isPending, startTransition] = useTransition();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [error, setError] = useState<ActionPreviewError | null>(null);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

    function openPreview() {
        const requestId = options.createIdempotencyKey();

        setError(null);
        setPreview(null);
        setIdempotencyKey(requestId);
        setIsDialogOpen(true);

        startTransition(async () => {
            const response = await options.preview();

            if (!response.ok) {
                setError(response.error);
                return;
            }

            setPreview(response.data);
        });
    }

    function closeDialog() {
        if (isPending) {
            return;
        }

        resetDialog();
    }

    function confirm() {
        setError(null);

        startTransition(async () => {
            const requestId = idempotencyKey ?? options.createIdempotencyKey();

            setIdempotencyKey(requestId);

            const response = await options.execute(requestId);

            if (!response.ok) {
                setError(response.error);
                return;
            }

            resetDialog();
        });
    }

    function resetDialog() {
        setIsDialogOpen(false);
        setPreview(null);
        setError(null);
        setIdempotencyKey(null);
    }

    return {
        isBusy: isPending,
        isDialogOpen,
        preview,
        error,
        openPreview,
        closeDialog,
        confirm,
    };
}
