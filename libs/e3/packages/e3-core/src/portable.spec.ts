/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The portable entry (`@elaraai/e3-core/portable`).
 *
 * What it exports is the root entry's — the same functions, classes and errors
 * — but for the forms of a few operations that read files or run tasks on this
 * machine, which the root entry has its own of, and the hash, which the root
 * entry computes natively. Each of those operations refuses here what only
 * this machine can do. And a dataflow runs through it, a task split into
 * pieces and a task after it, and a package's zip is imported and exported
 * through it, in a process with no Node module loaded, no `Buffer`, and no way
 * to reach Node's builtins: which modules the entry imports is
 * `seams.spec.ts`'s, and this is what they do.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { ArrayType, DictType, East, IntegerType, SortedMap, StringType, compareFor, encodeBeast2For, toEastTypeValue, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import * as portable from './portable.js';
import * as root from './index.js';
import { PIECE_SIZES } from './execution/pieces.js';
import { MockTaskRunner } from './execution/MockTaskRunner.js';
import { packageImport } from './package-files.js';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import { createTempDir, removeTempDir } from './test-helpers.js';

/** The names whose root form reads files or runs tasks on this machine, or
 *  hashes with Node's own SHA-256. */
const ROOT_FORMS = [
  'LocalOrchestrator', 'probeExecutionCache', 'executeSplitTask', 'storeCollection', 'intakeDelivery', 'workspaceDeploy',
  'openZip', 'packageImport', 'packageZipOpen', 'handleProcessImport', 'packageExport', 'workspaceExport', 'handleProcessExport',
  'computeHash',
];

/** A fresh in-memory repository. */
async function inMemory(): Promise<InMemoryStorage> {
  const storage = new InMemoryStorage();
  await storage.repos.create('repo');
  return storage;
}

/** A pattern matching `text` exactly. */
function exactly(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

/**
 * The resolve hook a child process runs its imports through: it refuses every
 * Node builtin, and, for a module of e3-core, every package but East and e3's
 * types. The one exception is the file functions the in-memory test backend
 * imports for `adoptFile` and `materialize`, which a dataflow never calls:
 * they resolve to functions that fail if it does.
 */
const HOOKS = [
  "import { isBuiltin } from 'node:module';",
  "let core = '';",
  "let files = '';",
  'export function initialize(data) {',
  '  core = data.core;',
  '  files = data.files;',
  '}',
  "const PACKAGES = new Set(['@elaraai/east', '@elaraai/east/internal', '@elaraai/e3-types']);",
  'export async function resolve(specifier, context, nextResolve) {',
  "  const parent = context.parentURL ?? '';",
  '  if (isBuiltin(specifier)) {',
  "    if (specifier === 'node:fs/promises' && parent === core + 'storage/in-memory/InMemoryStorage.js') return { url: files, shortCircuit: true };",
  "    throw new Error('a Node module was loaded: ' + specifier + ', imported by ' + parent);",
  '  }',
  "  const bare = !/^(\\.|\\/|[a-z]+:)/.test(specifier);",
  '  if (bare && parent.startsWith(core) && !PACKAGES.has(specifier)) {',
  "    throw new Error('a package besides East and e3\\'s types was loaded: ' + specifier + ', imported by ' + parent);",
  '  }',
  '  return nextResolve(specifier, context);',
  '}',
].join('\n');

/** What the in-memory backend's file functions are in the child: failures. */
const FILES = `data:text/javascript,${encodeURIComponent([
  "export const readFile = () => Promise.reject(new Error('the portable run read a file'));",
  "export const writeFile = () => Promise.reject(new Error('the portable run wrote a file'));",
].join('\n'))}`;

/**
 * The child: it registers the hook, drops what a browser lacks, and then runs
 * a deployed workspace's dataflow through the portable entry, with a mock
 * runner whose units give back what they were given. It prints what it saw.
 */
const CHILD = [
  "import { register } from 'node:module';",
  'const [hooks, core, files] = process.argv.slice(2);',
  'register(hooks, { data: { core, files } });',
  "let text = '';",
  "process.stdin.setEncoding('utf8');",
  'for await (const chunk of process.stdin) text += chunk;',
  'const input = JSON.parse(text);',
  '',
  "// What a browser lacks: Buffer, and the door to Node's builtins.",
  'delete globalThis.Buffer;',
  'delete process.getBuiltinModule;',
  'const report = { globals: [typeof globalThis.Buffer, typeof process.getBuiltinModule] };',
  '',
  'const at = (path) => new URL(path, core).href;',
  "const portable = await import(at('portable.js'));",
  "const { MockTaskRunner } = await import(at('execution/MockTaskRunner.js'));",
  "const { InMemoryStorage } = await import(at('storage/in-memory/InMemoryStorage.js'));",
  "const pieces = await import(at('execution/pieces.js'));",
  '',
  '// The pieces are planned at the platform sizes until the host says to read',
  '// a test\'s: this host says so, and pieces of 16 to 256 bytes are a segment each.',
  'report.defaultPieceSizes = pieces.pieceSizes();',
  "pieces.readTestPieceBytesFrom(() => '64');",
  '',
  'const storage = new InMemoryStorage();',
  "await storage.repos.create('repo');",
  'report.misnamed = [];',
  'for (const [hash, base64] of input.objects) {',
  '  const binary = atob(base64);',
  '  const bytes = new Uint8Array(binary.length);',
  '  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);',
  "  if (await storage.objects.write('repo', bytes) !== hash) report.misnamed.push(hash);",
  '}',
  "await storage.refs.packageWrite('repo', input.name, input.version, input.packageHash);",
  "await portable.workspaceCreate(storage, 'repo', 'ws');",
  "await portable.workspaceDeploy(storage, 'repo', 'ws', input.name, input.version);",
  "const tasks = (await portable.packageRead(storage, 'repo', input.name, input.version)).tasks;",
  '',
  'const runner = new MockTaskRunner();',
  "runner.setUnitResult(tasks.get('same'), (unit) => ({ state: 'success', cached: false, outputHash: unit.merge === null ? unit.inputs[0] : 'merged' }));",
  'report.counted = [];',
  "runner.setResult(tasks.get('count'), (inputs) => {",
  '  report.counted.push(inputs);',
  "  return { state: 'success', cached: false, outputHash: 'counted' };",
  '});',
  'const orchestrator = new portable.LocalOrchestrator(new portable.InMemoryStateStore());',
  "const ran = await orchestrator.wait(await orchestrator.start(storage, 'repo', 'ws', { runner, width: 4 }));",
  'report.ran = { success: ran.success, executed: ran.executed, cached: ran.cached, failed: ran.failed };',
  '',
  "const rows = (await storage.datasets.read('repo', 'ws', 'inputs/rows')).value.hash;",
  "report.same = (await storage.datasets.read('repo', 'ws', 'tasks/same/output')).value.hash;",
  'report.rows = rows;',
  'report.pieces = runner.getUnitCalls().filter((call) => call.unit.merge === null).length;',
  'report.merges = runner.getUnitCalls().filter((call) => call.unit.merge !== null).length;',
  "const own = await storage.refs.executionGetLatest('repo', tasks.get('same'), portable.inputsHash([rows]));",
  'report.own = own.type;',
  "report.owner = await storage.refs.executionOwnerRead('repo', tasks.get('same'), portable.inputsHash([rows]), own.value.executionId);",
  'process.stdout.write(JSON.stringify(report));',
].join('\n');

/**
 * The child that imports a package's zip, as the SDK wrote it — its entries
 * deflated — and exports the package to a stream, and imports what it wrote,
 * through the portable entry, with nothing of Node: east inflates the entries
 * and checks and writes their CRC-32s itself. It prints what it saw.
 */
const ZIP_CHILD = [
  "import { register } from 'node:module';",
  'const [hooks, core, files] = process.argv.slice(2);',
  'register(hooks, { data: { core, files } });',
  "let text = '';",
  "process.stdin.setEncoding('utf8');",
  'for await (const chunk of process.stdin) text += chunk;',
  'const input = JSON.parse(text);',
  '',
  "// What a browser lacks: Buffer, and the door to Node's builtins.",
  'delete globalThis.Buffer;',
  'delete process.getBuiltinModule;',
  'const report = { globals: [typeof globalThis.Buffer, typeof process.getBuiltinModule] };',
  '',
  'const at = (path) => new URL(path, core).href;',
  "const portable = await import(at('portable.js'));",
  "const { InMemoryStorage } = await import(at('storage/in-memory/InMemoryStorage.js'));",
  'const bytesOf = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));',
  "const base64Of = (bytes) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));",
  'const sourceOf = (bytes) => ({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) });',
  'const fresh = async () => {',
  '  const storage = new InMemoryStorage();',
  "  await storage.repos.create('repo');",
  '  return storage;',
  '};',
  '',
  'const storage = await fresh();',
  "report.imported = await portable.packageImport(storage, 'repo', sourceOf(bytesOf(input.zip)));",
  'const chunks = [];',
  "const exported = await portable.packageExport(storage, 'repo', report.imported.name, report.imported.version,",
  '  new WritableStream({ write(chunk) { chunks.push(chunk.slice()); } }));',
  'const zip = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));',
  'chunks.reduce((offset, chunk) => { zip.set(chunk, offset); return offset + chunk.length; }, 0);',
  'report.exported = { bytes: exported.bytes, packageHash: exported.packageHash, objectCount: exported.objectCount, zip: base64Of(zip) };',
  "report.reimported = await portable.packageImport(await fresh(), 'repo', sourceOf(zip));",
  'process.stdout.write(JSON.stringify(report));',
].join('\n');

/** A child that only asks the hook to load the root entry, which imports
 *  Node's modules: the hook must refuse it, or it refuses nothing. */
const ROOT_CHILD = [
  "import { register } from 'node:module';",
  'const [hooks, core, files] = process.argv.slice(2);',
  'register(hooks, { data: { core, files } });',
  "await import(new URL('index.js', core).href);",
].join('\n');

describe('the portable entry', () => {
  it('exports the root entry\'s own functions, classes and errors, but for the forms that read files, run tasks or hash natively on this machine', () => {
    const rooted = root as Record<string, unknown>;
    for (const [name, value] of Object.entries(portable)) {
      assert.ok(name in rooted, `${name} is the root entry's too`);
      if (ROOT_FORMS.includes(name)) assert.notEqual(rooted[name], value, `${name}: the root entry's form reads files, runs tasks or hashes natively here`);
      else assert.equal(rooted[name], value, `${name} is the root entry's own`);
    }
    for (const name of ROOT_FORMS) assert.ok(name in portable, `${name} is the portable entry's too`);
    assert.ok(root.LocalOrchestrator.prototype instanceof portable.LocalOrchestrator,
      'the root entry\'s orchestrator is the shared one, with this process as its host');
  });

  it('throws, through the root entry, errors of the portable entry\'s classes', async () => {
    const storage = await inMemory();
    await assert.rejects(root.workspaceGetPackage(storage, 'repo', 'nowhere'), (err: unknown) =>
      err instanceof portable.WorkspaceNotFoundError && err instanceof portable.E3Error);
    await assert.rejects(root.workspaceDeploy(storage, 'repo', 'ws', 'missing', '1.0.0'), portable.PackageNotFoundError);
    await assert.rejects(new root.LocalOrchestrator().resume(storage, 'repo', 'ws', 'run'), portable.DataflowError);
  });

  describe('refuses what only this machine can do', () => {
    const TableType = ArrayType(IntegerType);

    it('a LocalOrchestrator given no runner, before it takes a lock', async () => {
      const storage = await inMemory();
      const orchestrator = new portable.LocalOrchestrator(new portable.InMemoryStateStore());
      for (const refused of [orchestrator.start(storage, 'repo', 'ws', {}), orchestrator.resume(storage, 'repo', 'ws', 'run', {})]) {
        await assert.rejects(refused, (err: unknown) => err instanceof portable.DataflowError &&
          err.message === 'this LocalOrchestrator has no runner of its own: a run names the runner its tasks run on (options.runner), ' +
            'or the orchestrator is the root entry\'s, which runs them on this machine');
      }
      assert.equal(await storage.locks.getState('repo', 'ws'), null, 'nothing holds the workspace');
    });

    it('a collection stored from a file', async () => {
      const storage = await inMemory();
      const file = { file: '/deliveries/rows.beast2' } as unknown as portable.CollectionSource;
      await assert.rejects(portable.storeCollection(storage, 'repo', TableType, [file]), (err: unknown) => err instanceof TypeError &&
        err.message === 'store: a source is a stored collection, chunks or elements, and ["file"] is none: ' +
          'a file on this machine is stored through the root entry of @elaraai/e3-core');
      assert.equal(await storage.objects.count('repo'), 0, 'nothing was stored');
    });

    it('a delivery taken in from a file', async () => {
      const storage = await inMemory();
      const runner = new MockTaskRunner();
      await assert.rejects(
        portable.intakeDelivery(storage, 'repo', runner, { file: '/deliveries/rows.beast2' }, toEastTypeValue(TableType), 'f'.repeat(64), 1024),
        exactly('Error: intake: the delivery is the file /deliveries/rows.beast2, which is read on the machine it lies on: ' +
          'take it in through the root entry of @elaraai/e3-core'),
      );
      assert.deepEqual(runner.getIntakeCalls(), [], 'no unit ran');
    });

    it('a deploy\'s `file` source, which it leaves to the root entry\'s deploy to read where it lies', async (t) => {
      const dir = createTempDir();
      t.after(() => removeTempDir(dir));
      const delivery = join(dir, 'limit.beast2');
      writeFileSync(delivery, encodeBeast2For(IntegerType)(42n));
      const zip = join(dir, 'sourced.zip');
      await e3.export(e3.package('sourced', '1.0.0', e3.input('limit', IntegerType, variant('file', delivery))), zip);
      const storage = await inMemory();
      await packageImport(storage, 'repo', zip);
      await portable.workspaceCreate(storage, 'repo', 'ws');
      const readsNoFiles = `input 'limit' is the file ${delivery}, and this e3 reads no files: deploy the package where the file lies, ` +
        'or complete the input over the dataset transfer protocol (resolveFileSources: false)';
      const limit = [variant('field', 'inputs'), variant('field', 'limit')];

      // Without a sink for its warnings, the deploy is refused before it writes.
      await assert.rejects(portable.workspaceDeploy(storage, 'repo', 'ws', 'sourced', '1.0.0'), exactly(`Error: ${readsNoFiles}`));
      assert.equal(await portable.workspaceGetState(storage, 'repo', 'ws'), null, 'nothing was deployed');

      // With one, the input is left unassigned, as a server leaves it.
      const warnings: string[] = [];
      await portable.workspaceDeploy(storage, 'repo', 'ws', 'sourced', '1.0.0', { sourceWarning: (message) => warnings.push(message) });
      assert.deepEqual(warnings, [`input 'limit' is left unassigned: ${readsNoFiles}`]);
      assert.equal((await portable.workspaceGetDatasetStatus(storage, 'repo', 'ws', limit)).refType, 'unassigned');

      // The root entry's deploy reads it here.
      await root.workspaceDeploy(storage, 'repo', 'ws', 'sourced', '1.0.0');
      assert.equal(await portable.workspaceGetDataset(storage, 'repo', 'ws', limit), 42n);
    });

    it('a zip given as a file, which it reads only from a source, before it reads anything', async (t) => {
      const dir = createTempDir();
      t.after(() => removeTempDir(dir));
      const zip = join(dir, 'pathed.zip');
      await e3.export(e3.package('pathed', '1.0.0'), zip);
      const storage = await inMemory();
      const path = zip as unknown as portable.ZipSource;
      const importStore = { get: () => assert.fail('the job was read') } as unknown as portable.PackageImportStore;
      for (const [doing, refused] of [
        ['import', portable.packageImport(storage, 'repo', path)],
        ['open', portable.packageZipOpen(path)],
        ['open', portable.openZip(path)],
        ['import job', portable.handleProcessImport({ storage, importStore }, { id: 'job', repo: 'repo', zip: path })],
      ] as const) {
        await assert.rejects(refused, exactly(`TypeError: ${doing}: the zip is the file ${zip}, which is read on the machine it lies on: ` +
          `${doing} it through the root entry of @elaraai/e3-core`));
      }
      assert.equal(await storage.objects.count('repo'), 0, 'nothing was imported');

      // The root entry's import reads it here.
      assert.equal((await root.packageImport(storage, 'repo', zip)).name, 'pathed');
    });

    it('a zip written to a file or a Node stream, which it writes only to a WritableStream, before it reads anything', async () => {
      const storage = await inMemory();
      const exportStore = { get: () => assert.fail('the job was read') } as unknown as portable.PackageExportStore;
      const refusal = (doing: string, given: string): RegExp => exactly(`TypeError: ${doing}: a zip is written to a WritableStream here, and ` +
        `${given} is none: a file or a Node stream is written to through the root entry of @elaraai/e3-core`);
      const file = '/exports/package.zip' as unknown as WritableStream<Uint8Array>;
      const stream = new Writable() as unknown as WritableStream<Uint8Array>;
      await assert.rejects(portable.packageExport(storage, 'repo', 'missing', '1.0.0', file), refusal('export', 'the file /exports/package.zip'));
      await assert.rejects(portable.packageExport(storage, 'repo', 'missing', '1.0.0', stream), refusal('export', 'what it was given'));
      await assert.rejects(portable.workspaceExport(storage, 'repo', 'ws', file), refusal('export', 'the file /exports/package.zip'));
      await assert.rejects(portable.workspaceExport(storage, 'repo', 'ws', stream), refusal('export', 'what it was given'));
      await assert.rejects(portable.handleProcessExport({ storage, exportStore }, { id: 'job', repo: 'repo', zip: file }),
        refusal('export job', 'the file /exports/package.zip'));
      assert.equal(await storage.locks.getState('repo', 'ws'), null, 'nothing holds the workspace');
    });
  });

  it('runs a dataflow — a task split into pieces, and a task after it — with no Node module loaded', async (t) => {
    const dir = createTempDir();
    t.after(() => removeTempDir(dir));
    const Rows = DictType(IntegerType, IntegerType);
    const rows = e3.input('rows', Rows, variant('value', new SortedMap(
      Array.from({ length: 8000 }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType))));
    const same = e3.streamTask('same', {
      inputs: [e3.partition(rows)],
      output: e3.output.dict(IntegerType, IntegerType),
    }, ($, rows, emit) => {
      $.for(rows, ($, value, key) => {
        $(emit(key, value));
      });
    });
    const count = e3.task('count', [same.output], East.function([Rows], IntegerType, ($, rows) => rows.size()));
    const zip = join(dir, 'flow.zip');
    await e3.export(e3.package('flow', '1.0.0', rows, same, count), zip);
    const storage = await inMemory();
    const imported = await packageImport(storage, 'repo', zip);
    const objects = await Promise.all((await storage.objects.list('repo')).map(async (hash) =>
      [hash, Buffer.from(await storage.objects.read('repo', hash)).toString('base64')]));

    const hooks = join(dir, 'hooks.mjs');
    writeFileSync(hooks, HOOKS);
    const child = join(dir, 'child.mjs');
    writeFileSync(child, CHILD);
    const core = new URL('./', import.meta.url).href;
    const ran = spawnSync(process.execPath, [child, pathToFileURL(hooks).href, core, FILES], {
      input: JSON.stringify({ name: imported.name, version: imported.version, packageHash: imported.packageHash, objects }),
      encoding: 'utf8',
      // Were the entry to read the piece size a test sets from the
      // environment, it would plan with these.
      env: { ...process.env, E3_TEST_PIECE_BYTES: '4' },
    });
    assert.equal(ran.status, 0, ran.stderr);
    const report = JSON.parse(ran.stdout) as {
      globals: string[];
      defaultPieceSizes: unknown;
      misnamed: string[];
      counted: string[][];
      ran: { success: boolean; executed: number; cached: number; failed: number };
      rows: string;
      same: string;
      pieces: number;
      merges: number;
      own: string;
      owner: unknown;
    };

    assert.deepEqual(report.globals, ['undefined', 'undefined'], 'the run had no Buffer, and no way to Node\'s builtins');
    assert.deepEqual(report.defaultPieceSizes, PIECE_SIZES, 'the entry reads no piece size from the environment until its host says to');
    assert.deepEqual(report.misnamed, [], 'every object is named by the hash Node\'s crypto gave it');
    assert.deepEqual(report.ran, { success: true, executed: 2, cached: 0, failed: 0 });
    assert.ok(report.pieces > 4, `the input was cut into many pieces, not ${report.pieces}`);
    assert.equal(report.merges, 0, 'the pieces\' keys are disjoint: they concatenate, with no merge');
    assert.equal(report.same, report.rows, 'the pieces, each given back, assemble into the input');
    assert.deepEqual(report.counted, [[report.rows]], 'the task after it read what it assembled');
    assert.equal(report.own, 'success');
    assert.equal(report.owner, null, 'a host that names no owner records none');
  });

  it('imports a zip the SDK deflated, and exports and imports a package zip, with no Node module loaded', async (t) => {
    const dir = createTempDir();
    t.after(() => removeTempDir(dir));
    const zipPath = join(dir, 'zipped.zip');
    const Rows = DictType(IntegerType, StringType);
    await e3.export(e3.package('zipped', '1.0.0',
      e3.input('words', StringType, variant('value', 'the same few words, again and again; '.repeat(300))),
      e3.input('rows', Rows, variant('value', new SortedMap(
        Array.from({ length: 2000 }, (_, i) => [BigInt(i), `row ${i}`] as [bigint, string]), compareFor(IntegerType))))), zipPath);
    const sdkZip = readFileSync(zipPath);
    // The first entry's method: the SDK deflates, so the child inflates.
    assert.equal(sdkZip.readUInt16LE(8), 8, 'the SDK deflates its entries');

    // The same, on Node: imported, and exported to a file.
    const storage = await inMemory();
    const imported = await root.packageImport(storage, 'repo', zipPath);
    const exportPath = join(dir, 'exported.zip');
    const exported = await root.packageExport(storage, 'repo', 'zipped', '1.0.0', exportPath);

    const hooks = join(dir, 'hooks.mjs');
    writeFileSync(hooks, HOOKS);
    const child = join(dir, 'zip-child.mjs');
    writeFileSync(child, ZIP_CHILD);
    const ran = spawnSync(process.execPath, [child, pathToFileURL(hooks).href, new URL('./', import.meta.url).href, FILES], {
      input: JSON.stringify({ zip: sdkZip.toString('base64') }),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(ran.status, 0, ran.stderr);
    const report = JSON.parse(ran.stdout) as {
      globals: string[];
      imported: unknown;
      exported: { bytes: number; packageHash: string; objectCount: number; zip: string };
      reimported: unknown;
    };

    assert.deepEqual(report.globals, ['undefined', 'undefined'], 'the run had no Buffer, and no way to Node\'s builtins');
    assert.deepEqual(report.imported, imported, 'the deflated zip imports as on Node');
    assert.deepEqual({ ...report.exported, zip: undefined }, { ...exported, zip: undefined });
    assert.ok(Buffer.from(report.exported.zip, 'base64').equals(readFileSync(exportPath)),
      'the zip written with east\'s own CRC-32 is the one written with zlib\'s');
    assert.deepEqual(report.reimported, imported, 'and it imports to the same package');
  });

  it('is run by a hook that refuses what the root entry loads', async (t) => {
    const dir = createTempDir();
    t.after(() => removeTempDir(dir));
    const hooks = join(dir, 'hooks.mjs');
    writeFileSync(hooks, HOOKS);
    const child = join(dir, 'root.mjs');
    writeFileSync(child, ROOT_CHILD);
    const ran = spawnSync(process.execPath, [child, pathToFileURL(hooks).href, new URL('./', import.meta.url).href, FILES], { encoding: 'utf8' });
    assert.notEqual(ran.status, 0);
    assert.match(ran.stderr, /a Node module was loaded: /);
  });
});
