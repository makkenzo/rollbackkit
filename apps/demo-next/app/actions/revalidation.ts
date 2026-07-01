import { revalidatePath } from 'next/cache';

export function revalidateDemoHome(): void {
    try {
        revalidatePath('/');
    } catch (error) {
        if (process.env.NODE_ENV === 'test' && isMissingStaticGenerationStoreError(error)) {
            return;
        }

        throw error;
    }
}

function isMissingStaticGenerationStoreError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('static generation store missing');
}
