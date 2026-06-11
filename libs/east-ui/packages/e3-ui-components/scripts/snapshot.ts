/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Snapshot driver for e3-task-bound east-ui components. Discovers every
 * `e3-ui/test/*.examples.ts`, enumerates each file's `example()` exports,
 * and emits one HTML + PNG per example (graph editors need a full canvas
 * each — a stacked per-file image makes them illegible). The boot →
 * navigate → capture loop is the shared {@link captureFiles} helper; the
 * browser entry (`snapshot/main.tsx`) seeds a dataset cache before render.
 *
 * Output: `dist-examples/<file>__<example>.{html,png}`.
 *
 * CLI flags:
 *   --file=<key>   restrict to one example file (e.g. `--file=ontology`)
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
const TEST_DIR = path.resolve(PKG_ROOT, '../e3-ui/test');
const OUT_DIR = path.join(PKG_ROOT, 'dist-examples');

function parseFileArg(argv: string[]): string | undefined {
    for (const arg of argv) {
        const m = /^--file=(.+)$/.exec(arg);
        if (m) return m[1];
    }
    return undefined;
}

function isExample(x: unknown): x is { fn: unknown } {
    return typeof x === 'object' && x !== null && 'fn' in x
        && typeof (x as { fn?: { toIR?: unknown } }).fn?.toIR === 'function';
}

async function discoverKeys(): Promise<string[]> {
    const entries = await fs.readdir(TEST_DIR, { recursive: true }) as string[];
    return entries
        .map(f => f.replace(/\\/g, '/'))
        .filter(f => /\.examples\.tsx?$/.test(f))
        .map(f => f.replace(/\.examples\.tsx?$/, ''))
        .sort();
}

/** Import a built examples module and return its `example()` export names. */
async function exampleNames(key: string): Promise<string[]> {
    const mod = await import(`@elaraai/e3-ui/examples/${key}`) as Record<string, unknown>;
    return Object.entries(mod).filter(([, v]) => isExample(v)).map(([n]) => n).sort();
}

async function main(): Promise<void> {
    const only = parseFileArg(process.argv.slice(2));
    const keys = await discoverKeys();
    const selected = only ? keys.filter(k => k === only) : keys;
    if (only && selected.length === 0) {
        console.error(`[snapshot] no example file matches --file=${only}`);
        console.error(`[snapshot] available: ${keys.join(', ')}`);
        process.exit(2);
    }

    const targets: SnapshotTarget[] = [];
    for (const key of selected) {
        const names = await exampleNames(key);
        for (const name of names) {
            targets.push({ query: { file: key, example: name }, outName: `${key.replace(/\//g, '_')}__${name}` });
        }
    }
    console.log(`[snapshot] ${targets.length} example(s) across ${selected.length} file(s): ${selected.join(', ')}`);

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
