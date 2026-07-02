import { readdir, readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const docsRoot = new URL('..', import.meta.url);
export const workspaceRoot = new URL('../..', docsRoot);

const README_LINK_ENTRYPOINTS = [
    new URL('README.md', workspaceRoot),
    new URL('apps/demo-next/README.md', workspaceRoot),
    new URL('packages/cli/README.md', workspaceRoot),
    new URL('packages/core/README.md', workspaceRoot),
    new URL('packages/postgres/README.md', workspaceRoot),
];

const DOCS_SKIP_DIRECTORIES = new Set(['node_modules', 'scripts']);
const WORKSPACE_LINK_TARGET_SKIP_DIRECTORIES = new Set([
    '.git',
    '.next',
    '.turbo',
    'coverage',
    'dist',
    'node_modules',
]);

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
    const markdownFiles = await findMarkdownFiles(docsRoot, DOCS_SKIP_DIRECTORIES);
    const checkLinks = options.checkLinks === true;
    const readmeLinkEntrypoints = checkLinks ? README_LINK_ENTRYPOINTS : [];
    const filesToCheck = uniqueFileUrls([...markdownFiles, ...readmeLinkEntrypoints]);
    const markdownPathnames = new Set(
        (checkLinks
            ? await findMarkdownFiles(workspaceRoot, WORKSPACE_LINK_TARGET_SKIP_DIRECTORIES)
            : markdownFiles
        ).map((fileUrl) => fileUrl.pathname),
    );
    const errors = [];

    for (const fileUrl of filesToCheck) {
        const source = await readFile(fileUrl, 'utf8');
        errors.push(
            ...checkMarkdownFile(fileUrl, source, {
                checkLinks,
                markdownPathnames,
            }),
        );
    }

    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }

    if (options.log !== false) {
        if (readmeLinkEntrypoints.length > 0) {
            console.log(
                `Checked ${markdownFiles.length} RollbackKit docs file(s) and ${readmeLinkEntrypoints.length} README link entrypoint(s).`,
            );
        } else {
            console.log(`Checked ${markdownFiles.length} RollbackKit docs file(s).`);
        }
    }

    return {
        checkedFiles: markdownFiles.length,
        files: markdownFiles.map((fileUrl) => relative(process.cwd(), fileURLToPath(fileUrl))),
    };
}

export async function findMarkdownFiles(directoryUrl, skipDirectories = DOCS_SKIP_DIRECTORIES) {
    const entries = await readdir(directoryUrl, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        if (entry.isDirectory() && skipDirectories.has(entry.name)) {
            continue;
        }

        const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directoryUrl);

        if (entry.isDirectory()) {
            files.push(...(await findMarkdownFiles(entryUrl, skipDirectories)));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(entryUrl);
        }
    }

    return files.sort((first, second) => first.pathname.localeCompare(second.pathname));
}

function uniqueFileUrls(fileUrls) {
    const seen = new Set();
    const unique = [];

    for (const fileUrl of fileUrls) {
        if (seen.has(fileUrl.pathname)) {
            continue;
        }

        seen.add(fileUrl.pathname);
        unique.push(fileUrl);
    }

    return unique;
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
    let match = linkPattern.exec(source);

    while (match !== null) {
        const target = match[1]?.trim();

        if (target === undefined || target === '' || isExternalOrAnchorLink(target)) {
            match = linkPattern.exec(source);
            continue;
        }

        const targetWithoutHash = target.split('#')[0];

        if (targetWithoutHash === undefined || targetWithoutHash === '') {
            match = linkPattern.exec(source);
            continue;
        }

        const targetUrl = new URL(targetWithoutHash, fileUrl);

        if (!markdownPathnames.has(targetUrl.pathname)) {
            const lineNumber = source.slice(0, match.index).split(/\r?\n/).length;
            fileErrors.push(`${filePath}:${lineNumber}: missing markdown link target ${target}.`);
        }

        match = linkPattern.exec(source);
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
