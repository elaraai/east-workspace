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
import { execFileSync } from 'node:child_process';
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
import { importedPackages, pythonProviders } from './functions-resolve.js';

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
    // no manifest given and no uv workspace holds the package: the export names the import and both ways out
    await assert.rejects(
      export_(pkg, path.join(tempDir, 'no-manifest.zip')),
      /task "use_shout" imports from "pricing", but no function manifest was given for it and it is not a member of the uv workspace/,
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

// ── self-resolving imports (#652) ─────────────────────────────────────────────

function toolAvailable(cmd: string, probe: string[]): boolean {
  try { execFileSync(cmd, probe, { stdio: 'ignore', shell: process.platform === 'win32' }); return true; } catch { return false; }
}

describe('export_ resolves an imported workspace package itself (#652)', () => {
  // the resolver honours EAST_PY (a named east-py), as does this gate
  const hasTools = toolAvailable('uv', ['--version']) && toolAvailable(process.env['EAST_PY'] || 'east-py', ['--help']);
  let ws: string;
  let events: string[];

  before(() => {
    if (!hasTools) return;
    // A uv workspace with one member, `pricing`, whose root module declares
    // `east_functions` — the python package a TypeScript task imports from.
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-resolve-ws-'));
    fs.writeFileSync(path.join(ws, 'pyproject.toml'),
      '[project]\nname = "root"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n\n' +
      '[tool.uv.workspace]\nmembers = ["packages/*"]\n');
    const dir = path.join(ws, 'packages', 'pricing');
    fs.mkdirSync(path.join(dir, 'src', 'pricing'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pyproject.toml'),
      '[project]\nname = "pricing"\nversion = "2.5.0"\nrequires-python = ">=3.11"\n\n' +
      '[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n');
    fs.writeFileSync(path.join(dir, 'src', 'pricing', '__init__.py'),
      'from east import East, IntegerType\n\n' +
      'triple = East.function([IntegerType], IntegerType, lambda b, x: x * 3)\n' +
      'east_functions = {"triple": triple}\n');
    execFileSync('uv', ['lock'], { cwd: ws, stdio: 'ignore', shell: process.platform === 'win32' });
  });
  after(() => { if (hasTools) fs.rmSync(ws, { recursive: true, force: true }); });

  /** Runs `f` with the workspace as the export's working directory. */
  async function inWorkspace<T>(f: () => Promise<T>): Promise<T> {
    const prev = process.cwd();
    process.chdir(ws);
    try { return await f(); } finally { process.chdir(prev); }
  }

  it('finds the package in the uv workspace, exports it with east-py, and links — no manifest given',
    { skip: hasTools ? false : 'uv and east-py on PATH' }, async () => {
      const triple = East.importFunction('pricing', 'triple', FunctionType([IntegerType], IntegerType));
      const n = input('n', IntegerType, 4n);
      const use = task('use_triple', [n], East.function([IntegerType], IntegerType, ($, x) => triple(x).add(1n)));
      const pkg = package_('importer', '1.0.0', use);
      const zipPath = path.join(ws, 'importer.zip');
      events = [];
      await inWorkspace(() => export_(pkg, zipPath, { onEvent: (e) => { if (e.kind === 'functions') events.push(`${e.package}:${e.count}:${e.tool}`); } }));
      assert.deepStrictEqual(events, ['pricing:1:east-py export-functions']);
      const bundle = irAt(await readZip(zipPath), 'tasks/use_triple/function_ir');
      assert.strictEqual(countImports(bundle.ir), 0);
      assert.strictEqual(bundle.compile([])(4n), 13n);
    });

  it('an explicit manifest wins for its package, and no export runs for it',
    { skip: hasTools ? false : 'uv and east-py on PATH' }, async () => {
      const given = East.exportFunctions('pricing', '0.0.1', { triple: East.function([IntegerType], IntegerType, ($, x) => x.multiply(30n)) });
      const triple = East.importFunction('pricing', 'triple', FunctionType([IntegerType], IntegerType));
      const n = input('n', IntegerType, 4n);
      const use = task('use_triple', [n], East.function([IntegerType], IntegerType, ($, x) => triple(x)));
      const pkg = package_('importer', '1.0.0', use);
      const zipPath = path.join(ws, 'importer-explicit.zip');
      events = [];
      await inWorkspace(() => export_(pkg, zipPath, { functions: [given], onEvent: (e) => { if (e.kind === 'functions') events.push(e.package); } }));
      assert.deepStrictEqual(events, []);
      assert.strictEqual(irAt(await readZip(zipPath), 'tasks/use_triple/function_ir').compile([])(4n), 120n);
    });

  it("a function the package does not export is the exporter's own error, naming the import",
    { skip: hasTools ? false : 'uv and east-py on PATH' }, async () => {
      const missing = East.importFunction('pricing', 'quadruple', FunctionType([IntegerType], IntegerType));
      const n = input('n', IntegerType, 4n);
      const use = task('use_missing', [n], East.function([IntegerType], IntegerType, ($, x) => missing(x)));
      const pkg = package_('importer', '1.0.0', use);
      await assert.rejects(
        inWorkspace(() => export_(pkg, path.join(ws, 'missing.zip'))),
        /package "pricing" exports no function "quadruple" — it exports triple/,
      );
    });

  it('the packages an IR imports from, and the python providers a runner implies', () => {
    const both = East.function([IntegerType], IntegerType, ($, x) => { $(sh(East.print(x))); return dbl(x); });
    assert.deepStrictEqual(importedPackages(both.toIR().ir), ['pricing']);
    assert.deepStrictEqual(importedPackages(East.function([IntegerType], IntegerType, ($, x) => x).toIR().ir), []);
    assert.deepStrictEqual(pythonProviders({ runtime: 'east-node', platforms: ['@elaraai/east-node-std', '@elaraai/east-node-io'] }), ['east-py-io', 'east-py-std']);
    assert.deepStrictEqual(pythonProviders({ runtime: 'east-c', platforms: ['east-c-std'] }), ['east-py-std']);
    assert.deepStrictEqual(pythonProviders({ runtime: 'east-py', platforms: ['east-py-std', { custom: 'acme' }] }), ['acme', 'east-py-std']);
    assert.deepStrictEqual(pythonProviders({ runtime: 'east-node', platforms: [{ custom: '@acme/node-platform' }] }), []);
    assert.deepStrictEqual(pythonProviders({ runtime: 'custom', command: ['uv', 'run', 'east-py', 'run'] }), []);
    assert.deepStrictEqual(pythonProviders(undefined), []);
  });
});
