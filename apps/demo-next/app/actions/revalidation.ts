import { revalidatePath } from 'next/cache';

export function revalidateDemoHome(): void {
    revalidatePath('/');
}
