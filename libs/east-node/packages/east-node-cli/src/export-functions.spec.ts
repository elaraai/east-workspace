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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { East, EastIR, FunctionType, IntegerType } from '@elaraai/east';

import { exportFunctionsFromModule } from './export-functions.js';

const EAST = import.meta.resolve('@elaraai/east');

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

    it('needs the eastFunctions export', async () => {
        const { dir, path } = plant('export const x = 1;\n');
        try {
            await assert.rejects(exportFunctionsFromModule(path, {}), /exports no `eastFunctions` object/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
