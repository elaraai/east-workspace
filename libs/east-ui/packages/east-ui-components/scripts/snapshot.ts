/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Snapshot driver for pure east-ui components. Discovers every
 * `east-ui/test/**\/*.examples.ts`, then emits one HTML + PNG per file
 * (all examples in that file stacked — fine for small widgets, and far
 * fewer captures than per-example). The boot → navigate → capture loop is
 * the shared {@link captureFiles} helper; the browser entry
 * (`snapshot/main.tsx`) renders the `?file=<pathKey>` page.
 *
 * Output: `dist-examples/<Category>__<pathKey>.{html,png}`.
 *
 * CLI flags:
 *   --file=<pathKey>   restrict to one file (e.g. `--file=buttons/button`)
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureFiles, type SnapshotTarget } from '../../../scripts/snapshot-capture.mts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_ROOT = path.join(PKG_ROOT, 'snapshot');
const VITE_CONFIG = path.join(SNAPSHOT_ROOT, 'vite.config.ts');
const TEST_DIR = path.resolve(PKG_ROOT, '../east-ui/test');
const OUT_DIR = path.join(PKG_ROOT, 'dist-examples');

function parseFileArg(argv: string[]): string | undefined {
    for (const arg of argv) {
        const m = /^--file=(.+)$/.exec(arg);
        if (m) return m[1];
    }
    return undefined;
}

function sanitise(s: string): string {
    return s.replace(/[^a-zA-Z0-9-_]/g, '_');
}

function categoryOf(pathKey: string): string {
    const seg = pathKey.split('/')[0] ?? pathKey;
    return seg.charAt(0).toUpperCase() + seg.slice(1);
}

/** pathKeys for `east-ui/test/<cat>/<name>.examples.ts` (skip top-level). */
async function discoverPathKeys(): Promise<string[]> {
    const entries = await fs.readdir(TEST_DIR, { recursive: true });
    return entries
        .filter(f => f.endsWith('.examples.ts'))
        .map(f => f.replace(/\\/g, '/').replace(/\.examples\.ts$/, ''))
        .filter(k => k.includes('/'))
        .sort();
}

async function main(): Promise<void> {
    const only = parseFileArg(process.argv.slice(2));
    const keys = await discoverPathKeys();
    const selected = only ? keys.filter(k => k === only) : keys;
    if (only && selected.length === 0) {
        console.error(`[snapshot] no example file matches --file=${only}`);
        console.error(`[snapshot] available pathKeys:\n  ${keys.join('\n  ')}`);
        process.exit(2);
    }

    const targets: SnapshotTarget[] = selected.map(pathKey => ({
        query: { file: pathKey },
        outName: `${sanitise(categoryOf(pathKey))}__${sanitise(pathKey)}`,
    }));
    console.log(`[snapshot] ${targets.length} file(s)`);

    const { failed } = await captureFiles({
        viteRoot: SNAPSHOT_ROOT,
        configFile: VITE_CONFIG,
        outDir: OUT_DIR,
        targets,
    });
    if (failed > 0) process.exitCode = 1;
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
