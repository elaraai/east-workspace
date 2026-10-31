/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for `east-node export-functions` (#628): a module's `eastFunctions`
 * export becomes a manifest that links and runs; unprovided platform
 * dependencies and a missing export are named.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { East, EastIR, FunctionExportBatchType, FunctionType, IntegerType, encodeBeast2For, type FunctionExportBatchEntry } from '@elaraai/east';

import { exportFunctionsFromModule } from './export-functions.js';

const EAST = import.meta.resolve('@elaraai/east');
const bin = fileURLToPath(new URL('../bin/east-node.mjs', import.meta.url));

/** Runs `east-node export-functions` in `dir`, with `env` added to the environment. */
function exportCli(dir: string, args: string[], env: Record<string, string> = {}) {
    return spawnSync(process.execPath, [bin, 'export-functions', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
}

/** Writes a batch in `dir`. */
function writeBatch(dir: string, entries: FunctionExportBatchEntry[]): string {
    const path = join(dir, 'batch.beast2');
    writeFileSync(path, encodeBeast2For(FunctionExportBatchType)(entries));
    return path;
}

const MODULE = `
import { East, IntegerType, NullType, StringType } from ${JSON.stringify(EAST)};
const log = East.platform("log", [StringType], NullType);
export const double = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
export const shout = East.function([StringType], NullType, ($, s) => { $(log(s.upperCase())); });
export const eastFunctions = { double, shout };
`;

/**
 * Plants the module under a fake project that also provides the `log`
 * platform as its own `./platform` package (`acme-platform`), the way the
 * loader resolves a project's platform from the cwd.
 */
function plant(source: string): { dir: string; path: string } {
    const dir = mkdtempSync(join(tmpdir(), 'enc-export-'));
    const path = join(dir, 'pricing.mjs');
    writeFileSync(path, source, 'utf-8');
    const pkg = join(dir, 'node_modules', 'acme-platform');
    mkdirSync(join(pkg, 'dist'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({
        name: 'acme-platform', version: '1.0.0', type: 'module',
        exports: { './platform': './dist/platform.js', './package.json': './package.json' },
    }));
    writeFileSync(join(pkg, 'dist', 'platform.js'),
        'export default [{ name: "log", inputs: [{ type: "String", value: null }], output: { type: "Null", value: null }, type: "sync", fn: () => null }];\n');
    return { dir, path };
}

/** Runs `fn` with `process.cwd()` at `dir`, where the fake platform package resolves. */
async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
    const prev = process.cwd();
    process.chdir(dir);
    try {
        return await fn();
    } finally {
        process.chdir(prev);
    }
}

describe('east-node export-functions', () => {
    it('writes a manifest that links and runs, recording each dependency\'s provider', async () => {
        const { dir, path } = plant(MODULE);
        try {
            const manifest = await withCwd(dir, () => exportFunctionsFromModule(path, { version: '2.0.0', packages: ['acme-platform'] }));
            assert.equal(manifest.package, 'pricing');
            assert.equal(manifest.version, '2.0.0');
            assert.deepEqual(manifest.functions.map(f => f.name), ['double', 'shout']);
            assert.equal(manifest.functions[1]!.platforms[0]!.provider.value, 'acme-platform');

            const back = East.decodeFunctionManifest(East.encodeFunctionManifest(manifest));
            const imported = East.importFunction('pricing', 'double', FunctionType([IntegerType], IntegerType));
            const user = East.function([IntegerType], IntegerType, ($, x) => imported(x).add(1n));
            const { ir } = East.linkImports(user, [back]);
            assert.equal(new EastIR(ir as any).compile([])(4n), 9n);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('names a platform dependency no package provides', async () => {
        const { dir, path } = plant(MODULE);
        try {
            await assert.rejects(exportFunctionsFromModule(path, {}), /no -p package provides: log/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('exports only the named functions — a sibling\'s unprovided platform call no longer matters — and names an unknown one', async () => {
        const { dir, path } = plant(MODULE);
        try {
            // `shout` calls `log`, which no -p package provides here; exporting `double` alone is fine
            const manifest = await exportFunctionsFromModule(path, { only: ['double'] });
            assert.deepEqual(manifest.functions.map(f => f.name), ['double']);
            await assert.rejects(exportFunctionsFromModule(path, { only: ['double', 'nope'] }), /exports no function "nope" — its eastFunctions are double, shout/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('--batch writes each entry\'s manifest from one import, byte for byte what its own call writes', () => {
        // The module says each time it is evaluated, so one import for the whole batch shows.
        const { dir, path } = plant(`${MODULE}\nimport { appendFileSync } from 'node:fs';\nappendFileSync(process.env.IMPORT_LOG, 'imported\\n');\n`);
        try {
            const env = { IMPORT_LOG: join(dir, 'imports.log') };
            const common = ['--name', 'pricing', '--package-version', '2.0.0'];
            // relative outputs are relative to the batch's directory
            const batch = writeBatch(dir, [
                { only: ['double'], output: 'double.beast2', packages: [] },
                { only: [], output: join(dir, 'all.beast2'), packages: ['acme-platform'] },
            ]);
            const result = exportCli(dir, [path, '--batch', batch, ...common], env);
            assert.equal(result.status, 0, result.stderr);
            assert.equal(readFileSync(env.IMPORT_LOG, 'utf8'), 'imported\n');
            assert.match(result.stderr, /Exported 1 function\(s\) of pricing@2\.0\.0/);
            assert.match(result.stderr, /Exported 2 function\(s\) of pricing@2\.0\.0/);

            assert.equal(exportCli(dir, [path, '-o', join(dir, 'double-alone.beast2'), '--only', 'double', ...common], env).status, 0);
            assert.deepEqual(readFileSync(join(dir, 'double.beast2')), readFileSync(join(dir, 'double-alone.beast2')));
            assert.equal(exportCli(dir, [path, '-o', join(dir, 'all-alone.beast2'), '-p', 'acme-platform', ...common], env).status, 0);
            assert.deepEqual(readFileSync(join(dir, 'all.beast2')), readFileSync(join(dir, 'all-alone.beast2')));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('--batch ends at the first entry that fails, and takes no -p or --only of its own', () => {
        const { dir, path } = plant(MODULE);
        try {
            // `shout` calls `log`, which no package of the second entry provides; the third never runs
            const batch = writeBatch(dir, [
                { only: ['double'], output: 'first.beast2', packages: [] },
                { only: ['shout'], output: 'second.beast2', packages: [] },
                { only: ['double'], output: 'third.beast2', packages: [] },
            ]);
            const result = exportCli(dir, [path, '--batch', batch]);
            assert.equal(result.status, 1);
            assert.match(result.stderr, /no -p package provides: log/);
            assert.deepEqual(['first', 'second', 'third'].map(n => existsSync(join(dir, `${n}.beast2`))), [true, false, false]);

            assert.match(exportCli(dir, [path]).stderr, /writes one manifest with -o <file>, or several with --batch <file>/);
            assert.match(exportCli(dir, [path, '-o', join(dir, 'x.beast2'), '--batch', batch]).stderr, /writes one manifest with -o <file>, or several with --batch <file>/);
            assert.match(exportCli(dir, [path, '--batch', batch, '--only', 'double']).stderr, /with --batch, each entry names its own -p packages and --only functions/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('needs the eastFunctions export', async () => {
        const { dir, path } = plant('export const x = 1;\n');
        try {
            await assert.rejects(exportFunctionsFromModule(path, {}), /exports no `eastFunctions` object/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
