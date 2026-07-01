import { mkdir, writeFile } from 'node:fs/promises';

import { checkDocs, docsRoot } from './check-docs.mjs';

const result = await checkDocs({
    checkLinks: true,
    log: false,
});

const outputDirectory = new URL('dist/', docsRoot);

await mkdir(outputDirectory, { recursive: true });
await writeFile(
    new URL('docs-manifest.json', outputDirectory),
    `${JSON.stringify(
        {
            checkedFiles: result.checkedFiles,
            files: result.files,
        },
        null,
        4,
    )}\n`,
);

console.log(`Built RollbackKit docs manifest for ${result.checkedFiles} file(s).`);
