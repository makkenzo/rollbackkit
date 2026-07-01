import { readdir, readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const docsRoot = new URL('..', import.meta.url);

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
    try {
        await checkDocs({
            checkLinks: process.argv.includes('--links'),
        });
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

export async function checkDocs(options = {}) {
    const markdownFiles = await findMarkdownFiles(docsRoot);
    const markdownPathnames = new Set(markdownFiles.map((fileUrl) => fileUrl.pathname));
    const errors = [];

    for (const fileUrl of markdownFiles) {
        const source = await readFile(fileUrl, 'utf8');
        errors.push(
            ...checkMarkdownFile(fileUrl, source, {
                checkLinks: options.checkLinks === true,
                markdownPathnames,
            }),
        );
    }

    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }

    if (options.log !== false) {
        console.log(`Checked ${markdownFiles.length} RollbackKit docs file(s).`);
    }

    return {
        checkedFiles: markdownFiles.length,
        files: markdownFiles.map((fileUrl) => relative(process.cwd(), fileURLToPath(fileUrl))),
    };
}

export async function findMarkdownFiles(directoryUrl) {
    const entries = await readdir(directoryUrl, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'scripts') {
            continue;
        }

        const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directoryUrl);

        if (entry.isDirectory()) {
            files.push(...(await findMarkdownFiles(entryUrl)));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(entryUrl);
        }
    }

    return files.sort((first, second) => first.pathname.localeCompare(second.pathname));
}

function checkMarkdownFile(fileUrl, source, options) {
    const filePath = relative(process.cwd(), fileURLToPath(fileUrl));
    const fileErrors = [];
    let openFenceLine = null;

    source.split(/\r?\n/).forEach((line, index) => {
        const lineNumber = index + 1;

        if (line.startsWith('````')) {
            fileErrors.push(`${filePath}:${lineNumber}: use exactly three backticks for fences.`);
            return;
        }

        if (!line.startsWith('```')) {
            return;
        }

        if (openFenceLine === null) {
            openFenceLine = lineNumber;
            return;
        }

        openFenceLine = null;
    });

    if (openFenceLine !== null) {
        fileErrors.push(`${filePath}:${openFenceLine}: code fence is not closed.`);
    }

    if (options.checkLinks) {
        fileErrors.push(...checkMarkdownLinks(fileUrl, source, options.markdownPathnames));
    }

    return fileErrors;
}

function checkMarkdownLinks(fileUrl, source, markdownPathnames) {
    const filePath = relative(process.cwd(), fileURLToPath(fileUrl));
    const fileErrors = [];
    const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
    let match;

    while ((match = linkPattern.exec(source)) !== null) {
        const target = match[1]?.trim();

        if (target === undefined || target === '' || isExternalOrAnchorLink(target)) {
            continue;
        }

        const targetWithoutHash = target.split('#')[0];

        if (targetWithoutHash === undefined || targetWithoutHash === '') {
            continue;
        }

        const targetUrl = new URL(targetWithoutHash, fileUrl);

        if (!markdownPathnames.has(targetUrl.pathname)) {
            const lineNumber = source.slice(0, match.index).split(/\r?\n/).length;
            fileErrors.push(`${filePath}:${lineNumber}: missing markdown link target ${target}.`);
        }
    }

    return fileErrors;
}

function isExternalOrAnchorLink(target) {
    return (
        target.startsWith('#') ||
        target.startsWith('http://') ||
        target.startsWith('https://') ||
        target.startsWith('mailto:')
    );
}
