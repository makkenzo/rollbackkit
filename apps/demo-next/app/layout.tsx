import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
    title: 'RollbackKit Demo',
    description: 'Preview, audit and undo dangerous SaaS actions.',
};

interface RootLayoutProps {
    readonly children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
