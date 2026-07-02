/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3-ui CLI — render east-ui / e3-ui components to PNG.
 *
 * One screenshot verb, three `--from-*` sources (mirroring e3-cli's
 * `--from-zip` / `--from-source`):
 *   e3-ui shot --from-source <file.tsx>           a TS/TSX component
 *   e3-ui shot --from-ir <file.beast2|.json>      serialized component IR
 *   e3-ui shot --from-task <ws.task> --repo <r>   a live e3 task's output (dataflow must have run)
 *
 * Plus the browser lifecycle for headless servers:
 *   e3-ui install-browser [--with-deps]           download the managed headless Chromium
 *   e3-ui doctor                                  diagnose the browser setup
 *
 * @packageDocumentation
 */

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { shotCommand } from './commands/shot.js';
import { installBrowser, doctor } from './browser.js';
import { CAPTURE_DEFAULTS as D } from './capture.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version: string };

const program = new Command();

program
    .name('e3-ui')
    .description('Render east-ui / e3-ui components to PNG')
    .version(packageJson.version);

program
    .command('shot')
    .description('Render an east-ui / e3-ui component to a PNG — from a source file, serialized IR, or a live e3 task')
    // Exactly one source (mutually exclusive).
    .option('--from-source <file>', 'Render a TS/TSX component source file (.ts/.tsx)')
    .option('--from-ir <file>', 'Render serialized component IR (.beast2/.json); "-" reads from stdin')
    .option('--from-task <ws.task>', 'Render a live e3 task\'s output (requires --repo; the workspace dataflow must have already run)')
    .option('--repo <path>', 'Local e3 repository path for --from-task')
    // --from-source only.
    .option('-e, --export <name>', 'Which exported component to render (default: the default / sole export)')
    // Shared.
    .option('-o, --output <path>', 'Output PNG path (default: derived from the source / task name)')
    .option('--html', 'Also write a self-contained HTML next to the PNG')
    .option('--viewport <WxH>', `Chromium viewport (default ${D.viewport.width}x${D.viewport.height})`)
    .option('--dpr <n>', `Device scale factor / pixel ratio (default ${D.deviceScaleFactor})`)
    .option('--full-page', 'Capture the full page instead of the component frame')
    .option('--element <selector>', 'Capture a specific CSS selector instead of the component frame')
    .option('--wait <ms>', `Extra settle time after fonts/skeletons clear (default ${D.settleMs})`)
    .option('--timeout <ms>', `Max time to wait for the render to complete (default ${D.timeoutMs}); raise for slow live tasks`)
    .option('--storage-key <key>', 'Storage key prefix for persisted component state')
    .action(shotCommand);

program
    .command('install-browser')
    .description('Download the version-matched headless Chromium into the playwright-managed cache (honors PLAYWRIGHT_BROWSERS_PATH)')
    .option('--with-deps', 'Also install required system libraries (Linux only)')
    .action(async (options: { withDeps?: boolean }) => {
        process.exit(await installBrowser(options));
    });

program
    .command('doctor')
    .description('Diagnose the browser setup: env overrides, launch cascade, and remediation')
    .action(async () => {
        process.exit(await doctor());
    });

program.parseAsync().catch((err: unknown) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
