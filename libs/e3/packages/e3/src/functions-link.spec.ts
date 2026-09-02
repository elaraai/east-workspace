/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Cross-language functions at `e3 export` (#628): a task's
 * `East.importFunction` references resolve against the manifests the
 * export is given, embed as pure IR in the task's function_ir object, and
 * are checked against the task's runner for the platform packages the
 * embedded functions need.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yauzl from 'yauzl';
import {
  East, FunctionType, IntegerType, NullType, StringType,
  decodeBeast2For, decodeEastIR, walkIR, IMPORT_PLATFORM,
} from '@elaraai/east';
import { DatasetRefType } from '@elaraai/e3-types';
import { export_ } from './export.js';
import { package_ } from './package.js';
import { task } from './task.js';
import { input } from './input.js';
import { function_ } from './function.js';
import { runnerProvides } from './runner.js';

const log = East.platform('log', [StringType], NullType);
const double = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
const shout = East.function([StringType], NullType, ($, s) => { $(log(s.upperCase())); });
const manifest = East.exportFunctions('pricing', '1.0.0', { double, shout }, { providers: { log: 'east-py-std' } });

const dbl = East.importFunction('pricing', 'double', FunctionType([IntegerType], IntegerType));
const sh = East.importFunction('pricing', 'shout', FunctionType([StringType], NullType));

function countImports(ir: unknown): number {
  let n = 0;
  walkIR(ir as any, (node) => { if (node.type === 'Platform' && node.value.name === IMPORT_PLATFORM) n += 1; });
  return n;
}

/** Reads a zip into a path → bytes map. */
async function readZip(zipPath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      if (!zipfile) return reject(new Error('No zipfile'));
      const entries = new Map<string, Buffer>();
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
        } else {
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) return reject(err);
            if (!readStream) return reject(new Error('No read stream'));
            const chunks: Buffer[] = [];
            readStream.on('data', (chunk) => chunks.push(chunk));
            readStream.on('end', () => {
              entries.set(entry.fileName, Buffer.concat(chunks));
              zipfile.readEntry();
            });
          });
        }
      });
      zipfile.on('end', () => resolve(entries));
      zipfile.on('error', reject);
    });
  });
}

/** The IR object a bundle holds for `data/<refPath>.ref`. */
function irAt(entries: Map<string, Buffer>, refPath: string) {
  const ref = decodeBeast2For(DatasetRefType)(new Uint8Array(entries.get(`data/${refPath}.ref`)!));
  assert.strictEqual(ref.type, 'value');
  const hash = (ref as any).value.hash as string;
  return decodeEastIR(new Uint8Array(entries.get(`objects/${hash.slice(0, 2)}/${hash.slice(2)}.beast2`)!));
}

describe('export_ links East.importFunction references (#628)', () => {
  let tempDir: string;
  before(() => { tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-link-')); });
  after(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  it("embeds the exported IR in the task's function_ir and the program runs", async () => {
    const greeting = input('greeting', StringType, 'hello');
    const use = task('use_double', [greeting], East.function([StringType], IntegerType, ($, s) => dbl(s.length()).add(1n)));
    const pkg = package_('importer', '1.0.0', use);
    const zipPath = path.join(tempDir, 'importer.zip');
    await export_(pkg, zipPath, { functions: [manifest] });

    const entries = await readZip(zipPath);
    const bundle = irAt(entries, 'tasks/use_double/function_ir');
    assert.strictEqual(countImports(bundle.ir), 0);
    assert.strictEqual(bundle.compile([])('hello'), 11n);
  });

  it('reads manifests from files and accepts a platform dependency the runner provides through its stock family', async () => {
    const manifestPath = path.join(tempDir, 'pricing.functions.beast2');
    fs.writeFileSync(manifestPath, East.encodeFunctionManifest(manifest));
    const greeting = input('greeting', StringType, 'hello');
    // default runner: east-node + @elaraai/east-node-std, the family of east-py-std
    const use = task('use_shout', [greeting], East.function([StringType], NullType, ($, s) => { $(sh(s)); }));
    const pkg = package_('importer', '1.0.0', use);
    const zipPath = path.join(tempDir, 'importer-file.zip');
    await export_(pkg, zipPath, { functions: [manifestPath] });
    const bundle = irAt(await readZip(zipPath), 'tasks/use_shout/function_ir');
    assert.strictEqual(countImports(bundle.ir), 0);
  });

  it("rejects a runner that lists no package providing an embedded function's platform call", async () => {
    const greeting = input('greeting', StringType, 'hello');
    const use = task('use_shout', [greeting], East.function([StringType], NullType, ($, s) => { $(sh(s)); }), {
      runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-io'] },
    });
    const pkg = package_('importer', '1.0.0', use);
    await assert.rejects(
      export_(pkg, path.join(tempDir, 'bad-runner.zip'), { functions: [manifest] }),
      /task "use_shout" imports pricing\.shout, which calls platform function "log" provided by east-py-std, but its east-node runner lists @elaraai\/east-node-io/,
    );
  });

  it('rejects a dependency whose manifest names no provider, and an import with no manifest', async () => {
    const unprovided = East.exportFunctions('pricing', '1.0.0', { shout });
    const greeting = input('greeting', StringType, 'hello');
    const use = task('use_shout', [greeting], East.function([StringType], NullType, ($, s) => { $(sh(s)); }));
    const pkg = package_('importer', '1.0.0', use);
    await assert.rejects(
      export_(pkg, path.join(tempDir, 'no-provider.zip'), { functions: [unprovided] }),
      /names no package providing it/,
    );
    await assert.rejects(
      export_(pkg, path.join(tempDir, 'no-manifest.zip')),
      /no function manifest for package "pricing"/,
    );
  });

  it('links e3.function bodies too, against their own runner', async () => {
    const fn = function_('use_double', East.function([IntegerType], IntegerType, ($, n) => dbl(n)), {
      runner: { runtime: 'east-py', platforms: ['east-py-std'] },
    });
    const pkg = package_('importer', '1.0.0', fn);
    const zipPath = path.join(tempDir, 'fn.zip');
    await export_(pkg, zipPath, { functions: [manifest] });
    const entries = await readZip(zipPath);
    // every object is linked: no IMPORT platform survives anywhere in the bundle
    for (const [name, bytes] of entries) {
      if (!name.startsWith('objects/')) continue;
      try {
        const bundle = decodeEastIR(new Uint8Array(bytes));
        assert.strictEqual(countImports(bundle.ir), 0, name);
      } catch {
        // not an IR object
      }
    }
  });

  it('runnerProvides: exact names, stock families, custom runners', () => {
    assert.ok(runnerProvides({ runtime: 'east-node', platforms: ['@elaraai/east-node-std'] }, 'east-py-std'));
    assert.ok(runnerProvides({ runtime: 'east-c', platforms: ['east-c-std'] }, '@elaraai/east-node-std'));
    assert.ok(!runnerProvides({ runtime: 'east-node', platforms: ['@elaraai/east-node-std'] }, 'east-py-datascience'));
    assert.ok(runnerProvides({ runtime: 'east-py', platforms: [{ custom: 'acme' }] }, 'acme'));
    assert.ok(!runnerProvides({ runtime: 'east-py', platforms: [{ custom: 'acme' }] }, 'acme2'));
    assert.ok(runnerProvides({ runtime: 'custom', command: ['uv', 'run', 'east-py', 'run'] }, 'anything'));
  });
});
