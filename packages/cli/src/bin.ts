#!/usr/bin/env node

import { runCli } from './program';

runCli().then((exitCode) => {
    process.exitCode = exitCode;
});
