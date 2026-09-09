/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A preload for the bin smoke (`--import <this file>`): once the process
 * is exiting — after the bin shim and the CLI have run — it loads `react`
 * under the process's NODE_ENV and appends which build the resolution
 * picked (`react.production.js` or `react.development.js`) to the file
 * named by `E3_UI_REACT_PROBE`. Test-only.
 *
 * @packageDocumentation
 */

import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const require = createRequire(import.meta.url);

process.on('exit', () => {
    const file = process.env['E3_UI_REACT_PROBE'];
    if (file === undefined || file === '') return;
    require('react');
    const builds = Object.keys(require.cache)
        .filter(key => /[\\/]cjs[\\/]react\.[a-z]+\.js$/.test(key))
        .map(key => path.basename(key));
    appendFileSync(file, `NODE_ENV=${process.env['NODE_ENV'] ?? ''}\n${builds.join('\n')}\n`);
});
