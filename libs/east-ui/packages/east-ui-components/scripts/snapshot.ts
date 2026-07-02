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
 *   --file=<pathKey>                restrict to one file (e.g. `--file=buttons/button`)
 *   --file=<pathKey>:<exampleName>  snapshot ONE example from that file, full-bleed
 *                                   (e.g. `--file=collections/schematic:schematicNets`);
 *                                   `--example=<name>` alongside `--file=` is equivalent.
 *
 * Output: per-file `dist-examples/<Category>__<pathKey>.{html,png}`, or
 * per-example `<Category>__<pathKey>__<exampleName>.{html,png}`.
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

function parseArgs(argv: string[]): { file?: string; example?: string } {
    let file: string | undefined;
    let example: string | undefined;
    for (const arg of argv) {
        const f = /^--file=(.+)$/.exec(arg);
        if (f) file = f[1];
        const e = /^--example=(.+)$/.exec(arg);
        if (e) example = e[1];
    }
    // `--file=path:example` sugar (the Makefile's per-example targets use it).
    if (file !== undefined && file.includes(":")) {
        const i = file.indexOf(":");
        example = example ?? file.slice(i + 1);
        file = file.slice(0, i);
    }
    return { file, example };
}

/** Export names carrying `example(...)` defs in one examples source file. */
async function exampleNamesOf(pathKey: string): Promise<string[]> {
    for (const ext of [".examples.tsx", ".examples.ts"]) {
        try {
            const src = await fs.readFile(path.join(TEST_DIR, pathKey + ext), "utf8");
            return [...src.matchAll(/^export const ([A-Za-z0-9_]+)/gm)].map(m => m[1]!);
        } catch { /* try the other extension */ }
    }
    return [];
}

function sanitise(s: string): string {
    return s.replace(/[^a-zA-Z0-9-_]/g, '_');
}

function categoryOf(pathKey: string): string {
    const seg = pathKey.split('/')[0] ?? pathKey;
    return seg.charAt(0).toUpperCase() + seg.slice(1);
}

/** pathKeys for `east-ui/test/<cat>/<name>.examples.{ts,tsx}` (skip top-level). */
async function discoverPathKeys(): Promise<string[]> {
    const entries = await fs.readdir(TEST_DIR, { recursive: true });
    return entries
        .filter(f => /\.examples\.tsx?$/.test(f))
        .map(f => f.replace(/\\/g, '/').replace(/\.examples\.tsx?$/, ''))
        .filter(k => k.includes('/'))
        .sort();
}

async function main(): Promise<void> {
    const { file: only, example } = parseArgs(process.argv.slice(2));
    const keys = await discoverPathKeys();
    const selected = only ? keys.filter(k => k === only) : keys;
    if (only && selected.length === 0) {
        console.error(`[snapshot] no example file matches --file=${only}`);
        console.error(`[snapshot] available pathKeys:\n  ${keys.join('\n  ')}`);
        process.exit(2);
    }
    if (example !== undefined && only === undefined) {
        console.error(`[snapshot] --example requires --file=<pathKey>`);
        process.exit(2);
    }
    if (example !== undefined) {
        const names = await exampleNamesOf(only!);
        if (!names.includes(example)) {
            console.error(`[snapshot] no example \`${example}\` in ${only}`);
            console.error(`[snapshot] available examples:\n  ${names.join('\n  ')}`);
            process.exit(2);
        }
    }

    const targets: SnapshotTarget[] = selected.map(pathKey => ({
        query: example !== undefined ? { file: pathKey, example } : { file: pathKey },
        outName: `${sanitise(categoryOf(pathKey))}__${sanitise(pathKey)}`
            + (example !== undefined ? `__${sanitise(example)}` : ''),
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
