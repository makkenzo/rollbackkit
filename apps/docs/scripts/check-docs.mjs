import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const docsRoot = new URL('..', import.meta.url);
const markdownFiles = await findMarkdownFiles(docsRoot);
const errors = [];

for (const fileUrl of markdownFiles) {
    const source = await readFile(fileUrl, 'utf8');
    errors.push(...checkMarkdownFile(fileUrl, source));
}

if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exit(1);
}

if (process.env.npm_lifecycle_event === 'build') {
    await writeBuildMarker(markdownFiles.length);
}

console.log(`Checked ${markdownFiles.length} RollbackKit docs file(s).`);

async function findMarkdownFiles(directoryUrl) {
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

function checkMarkdownFile(fileUrl, source) {
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

    return fileErrors;
}

async function writeBuildMarker(checkedFiles) {
    const outputDirectory = new URL('.turbo/docs/', docsRoot);

    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
        new URL('check.json', outputDirectory),
        `${JSON.stringify({ checkedFiles }, null, 4)}\n`,
    );
}
