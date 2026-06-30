import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const helpersDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(helpersDirectory, '../..');

export function readDemoSql(relativePath: string): Promise<string> {
    return readFile(resolve(appDirectory, relativePath), 'utf8');
}
