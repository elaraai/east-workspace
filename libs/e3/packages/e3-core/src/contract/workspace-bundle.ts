/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A workspace bundle's contract, over any backend: a bundle written from a
 * workspace makes, in another store, the workspace as it was — its package,
 * every dataset's ref and value, each record's history, and its tasks'
 * outputs read up to date by the executions they came from — and an object
 * larger than an entry carries travels in pieces. An object the receiving
 * repository holds need not travel, and one said to be held that it does not
 * hold refuses the import. A refused import makes no workspace: a name a
 * workspace has, bytes that are no bundle or are cut short, a ref its package
 * declares no dataset at, an execution that did not succeed, or its package's
 * name and version held by another package.
 */

import { describe, it, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DictType, East, IntegerType, StringType, decodeBeast2ElementsFor, encodeBeast2For, equalFor, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { DatasetRefType, WorkspaceBundleType, WorkspaceRecordType, type TreePath, type WorkspaceBundleEntry } from '@elaraai/e3-types';
import { PackageExistsError, WorkspaceBundleInvalidError, WorkspaceExistsError, WorkspaceNotDeployedError } from '../errors.js';
import { MockTaskRunner } from '../execution/MockTaskRunner.js';
import { inputsHash } from '../executions.js';
import { packageRead } from '../packages.js';
import { packageImport } from '../package-files.js';
import { workspaceGetDataset, workspaceGetDatasetHash, workspaceSetDataset } from '../trees.js';
import { uuidv7 } from '../uuid.js';
import { workspaceBundleExport, workspaceBundleImport, type WorkspaceBundleExportOptions } from '../workspace-bundle.js';
import { workspaceCreate, workspaceGetPackage, workspaceGetState, workspaceList } from '../workspaces.js';
import { workspaceDeploy } from '../workspace-files.js';
import { workspaceStatus } from '../workspaceStatus.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { BackendSetup } from './setup.js';

const PKG = 'bundle-pkg';
const PROD = 'production';
const MADE = 'made';

/** An input's dataset path. */
const input = (name: string): TreePath => [variant('field', 'inputs'), variant('field', name)];

/** Whether two workspaces' refs are the same, by path. */
const sameRefs = equalFor(DictType(StringType, DatasetRefType));

/** Text no codec makes much smaller: `length` characters drawn by a fixed
 *  generator. */
function incompressible(length: number): string {
  let seed = 1;
  return Array.from({ length }, () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return String.fromCharCode(48 + ((seed >>> 16) % 64));
  }).join('');
}

/** A backend, and a repository in it. */
interface Repository {
  storage: StorageBackend;
  repo: string;
}

/** A stream that keeps what is written to it, and how it ended. */
function collecting(): { stream: WritableStream<Uint8Array>; bytes: () => Uint8Array; ended: () => 'open' | 'closed' | 'aborted' } {
  const chunks: Uint8Array[] = [];
  let ended: 'open' | 'closed' | 'aborted' = 'open';
  const stream = new WritableStream<Uint8Array>({
    write: (chunk) => {
      chunks.push(chunk.slice());
    },
    close: () => {
      ended = 'closed';
    },
    abort: () => {
      ended = 'aborted';
    },
  });
  const bytes = (): Uint8Array => {
    const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.byteLength;
    }
    return out;
  };
  return { stream, bytes, ended: () => ended };
}

/** A bundle's entries. */
async function entriesOf(bytes: Uint8Array): Promise<WorkspaceBundleEntry[]> {
  const entries: WorkspaceBundleEntry[] = [];
  for await (const entry of decodeBeast2ElementsFor(WorkspaceBundleType)([bytes])) entries.push(entry);
  return entries;
}

/**
 * Registers a workspace bundle's contract suite.
 *
 * @remarks
 * Every case writes a bundle from a workspace of one backend and makes the
 * workspace in another, both of the setup's making, through the storage
 * interfaces alone. The package, `1.0.0`: `note` (String, `one`), a task over
 * it, and a record, `counts`, with a mutation that names no program; and
 * another package of the same name and version, whose `note` is `two`.
 *
 * @param setup - Makes a fresh backend and a repository in it for each call
 */
export function workspaceBundleTests(setup: BackendSetup): void {
  describe('a workspace bundle', () => {
    let dir: string;
    let zip: string;
    let otherZip: string;

    before(async () => {
      dir = mkdtempSync(join(tmpdir(), 'e3-contract-'));
      const members = (note: string) => {
        const input = e3.input('note', StringType, variant('value', note));
        return [
          e3.task('echo', [input], East.function([StringType], StringType, ($, x) => x)),
          // A record with no delta addressed by key: its mutation names no
          // program, only its reducer
          e3.record('counts', IntegerType, {
            initial: 0n,
            mutations: (mutation) => ({ bump: mutation.reduce(East.function([IntegerType], IntegerType, ($, n) => n.add(1n))) }),
          }),
        ];
      };
      zip = join(dir, `${PKG}.zip`);
      await e3.export(e3.package(PKG, '1.0.0', ...members('one')), zip);
      otherZip = join(dir, `${PKG}-other.zip`);
      await e3.export(e3.package(PKG, '1.0.0', ...members('two')), otherZip);
    });

    after(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    /** Production, the package deployed, its note set, and its task's output
     *  written by an execution over the note that succeeded. */
    const production = async (t: TestContext, note = 'mine'): Promise<Repository> => {
      const { storage, repo } = await setup(t);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, PROD);
      await workspaceDeploy(storage, repo, PROD, PKG, '1.0.0');
      await workspaceSetDataset(storage, repo, PROD, input('note'), note, StringType);
      const noted = (await workspaceGetDatasetHash(storage, repo, PROD, input('note'))).hash;
      assert.ok(noted !== null);
      const output = await storage.objects.write(repo, encodeBeast2For(StringType)(note));
      await storage.datasets.write(repo, PROD, 'tasks/echo/output', variant('value', { hash: output, versions: new Map([['.inputs.note', noted]]) }));
      const taskHash = (await packageRead(storage, repo, PKG, '1.0.0')).tasks.get('echo')!;
      const executionId = uuidv7();
      await storage.refs.executionWrite(repo, taskHash, inputsHash([noted]), executionId, variant('success', {
        executionId, inputHashes: [noted], outputHash: output, startedAt: new Date(), completedAt: new Date(),
        peakBytes: none, plan: none, unit: false,
      }));
      const deployed = await workspaceGetState(storage, repo, PROD);
      assert.ok(deployed !== null);
      await storage.refs.workspaceWrite(repo, PROD, encodeBeast2For(WorkspaceRecordType)(some({ ...deployed, currentRunId: some(uuidv7()) })));
      return { storage, repo };
    };

    /** The workspace's bundle, and what its export answered. */
    const bundleOf = async ({ storage, repo }: Repository, options?: WorkspaceBundleExportOptions) => {
      const out = collecting();
      const result = await workspaceBundleExport(storage, repo, PROD, out.stream, options);
      assert.equal(out.ended(), 'closed', 'the stream is closed once the bundle is whole');
      return { bytes: out.bytes(), result };
    };

    /** That no workspace of the name was made, and no ref written under it. */
    const madeNothing = async ({ storage, repo }: Repository, ws: string): Promise<void> => {
      assert.ok(!(await workspaceList(storage, repo)).includes(ws), 'no workspace was made');
      assert.equal((await storage.datasets.readAll(repo, ws)).size, 0, 'no ref was written under its name');
    };

    it('makes, in another store, the workspace as it was: its package, every dataset\'s ref and value, and its task\'s output up to date', async (t) => {
      const source = await production(t);
      const { bytes, result } = await bundleOf(source);
      assert.deepEqual(result.package, { name: PKG, version: '1.0.0' });
      assert.equal(result.bytes, bytes.byteLength);

      const target = await setup(t);
      const made = await workspaceBundleImport(target.storage, target.repo, MADE, [bytes]);
      assert.deepEqual(made, { package: { name: PKG, version: '1.0.0' }, objects: result.objects });

      assert.ok(sameRefs(await target.storage.datasets.readAll(target.repo, MADE), await source.storage.datasets.readAll(source.repo, PROD)),
        'every dataset\'s ref is the source\'s');
      assert.deepEqual(await workspaceGetPackage(target.storage, target.repo, MADE), await workspaceGetPackage(source.storage, source.repo, PROD));
      assert.equal(await workspaceGetDataset(target.storage, target.repo, MADE, input('note')), 'mine');
      assert.equal(await workspaceGetDataset(target.storage, target.repo, MADE, [variant('field', 'tasks'), variant('field', 'echo'), variant('field', 'output')]), 'mine');
      const state = await workspaceGetState(target.storage, target.repo, MADE);
      const deployed = await workspaceGetState(source.storage, source.repo, PROD);
      assert.ok(state !== null && deployed !== null);
      assert.deepEqual(state.currentRunId, none, 'it names no run of its own');
      assert.deepEqual(state.deployedAt, deployed.deployedAt, 'its deployment is the one the bundle carries');
      assert.equal(await target.storage.refs.packageResolve(target.repo, PKG, '1.0.0'), deployed.packageHash, 'its package is listed');

      const echo = (await workspaceStatus(target.storage, new MockTaskRunner(), target.repo, MADE)).tasks.find((task) => task.name === 'echo');
      assert.deepEqual(echo?.status, { type: 'up-to-date', cached: true }, 'the execution its output came from travelled');
    });

    it('carries each record\'s history: the commit its ref names as its head', async (t) => {
      const source = await production(t);
      const { bytes } = await bundleOf(source);
      const target = await setup(t);
      await workspaceBundleImport(target.storage, target.repo, MADE, [bytes]);

      const ref = await target.storage.datasets.read(target.repo, MADE, 'records/counts');
      assert.ok(ref?.type === 'value');
      const head = ref.value.versions.get('.records.counts');
      assert.ok(head !== undefined, 'a record\'s ref names its head commit');
      assert.ok(await target.storage.objects.exists(target.repo, head));
      assert.equal(await workspaceGetDataset(target.storage, target.repo, MADE, [variant('field', 'records'), variant('field', 'counts')]), 0n);
    });

    it('carries an object larger than an entry in pieces, and makes it whole', async (t) => {
      const long = incompressible(20_000);
      const source = await production(t, long);
      const { bytes } = await bundleOf(source, { pieceBytes: 1024 });
      const entries = await entriesOf(bytes);
      assert.ok(entries.filter((entry) => entry.type === 'piece').length >= 10, 'the note travelled in pieces');

      const target = await setup(t);
      await workspaceBundleImport(target.storage, target.repo, MADE, [bytes]);
      assert.equal(await workspaceGetDataset(target.storage, target.repo, MADE, input('note')), long);
    });

    it('leaves out the objects the receiving repository holds, and makes the workspace from those it holds', async (t) => {
      const source = await production(t);
      const target = await setup(t);
      await workspaceBundleImport(target.storage, target.repo, MADE, [(await bundleOf(source)).bytes]);

      const { bytes, result } = await bundleOf(source, { have: (hashes) => target.storage.objects.touch(target.repo, hashes) });
      assert.equal(result.objects, 0, 'the repository holds every object already');
      assert.deepEqual((await entriesOf(bytes)).map((entry) => entry.type), ['workspace']);
      await workspaceBundleImport(target.storage, target.repo, 'again', [bytes]);
      assert.ok(sameRefs(await target.storage.datasets.readAll(target.repo, 'again'), await target.storage.datasets.readAll(target.repo, MADE)));
    });

    it('refuses an object said to be held that the repository does not hold, and makes no workspace', async (t) => {
      const source = await production(t);
      const { bytes } = await bundleOf(source, { have: async (hashes) => hashes.map(() => true) });
      const target = await setup(t);
      await assert.rejects(workspaceBundleImport(target.storage, target.repo, MADE, [bytes]), WorkspaceBundleInvalidError);
      await madeNothing(target, MADE);
    });

    it('refuses a name a workspace has', async (t) => {
      const source = await production(t);
      const { bytes } = await bundleOf(source);
      const target = await setup(t);
      await workspaceCreate(target.storage, target.repo, MADE);
      await assert.rejects(workspaceBundleImport(target.storage, target.repo, MADE, [bytes]), WorkspaceExistsError);
      assert.equal(await target.storage.datasets.read(target.repo, MADE, 'inputs/note'), null);
    });

    it('refuses bytes that are no bundle, and a bundle cut short, and makes no workspace', async (t) => {
      const source = await production(t);
      const { bytes } = await bundleOf(source);
      const target = await setup(t);
      await assert.rejects(workspaceBundleImport(target.storage, target.repo, MADE, [encodeBeast2For(StringType)('no bundle')]), WorkspaceBundleInvalidError);
      await assert.rejects(workspaceBundleImport(target.storage, target.repo, MADE, [bytes.subarray(0, Math.floor(bytes.byteLength / 2))]), WorkspaceBundleInvalidError);
      await madeNothing(target, MADE);
    });

    it('refuses a ref its package declares no dataset at, and an execution that did not succeed, and makes no workspace', async (t) => {
      const source = await production(t);
      const entries = await entriesOf((await bundleOf(source)).bytes);
      const [first, ...objects] = entries;
      assert.ok(first?.type === 'workspace');
      const target = await setup(t);

      for (const path of ['../escaped', 'inputs/undeclared']) {
        const datasets = new Map([...first.value.datasets, [path, variant('unassigned', null)]]);
        const crafted = encodeBeast2For(WorkspaceBundleType)([variant('workspace', { ...first.value, datasets }), ...objects]);
        await assert.rejects(workspaceBundleImport(target.storage, target.repo, MADE, [crafted]),
          (err: unknown) => err instanceof WorkspaceBundleInvalidError && err.message.includes(path));
        await madeNothing(target, MADE);
      }

      const [execution] = first.value.executions;
      assert.ok(execution !== undefined && execution.status.type === 'success');
      const failed = variant('failed', { ...execution.status.value, exitCode: 1n });
      const crafted = encodeBeast2For(WorkspaceBundleType)([
        variant('workspace', { ...first.value, executions: [{ ...execution, status: failed }] }), ...objects,
      ]);
      await assert.rejects(workspaceBundleImport(target.storage, target.repo, MADE, [crafted]), WorkspaceBundleInvalidError);
      await madeNothing(target, MADE);
    });

    it('refuses a bundle whose package\'s name and version the repository holds as another package', async (t) => {
      const source = await production(t);
      const { bytes } = await bundleOf(source);
      const target = await setup(t);
      await packageImport(target.storage, target.repo, otherZip);
      await assert.rejects(workspaceBundleImport(target.storage, target.repo, MADE, [bytes]), PackageExistsError);
      await madeNothing(target, MADE);
    });

    it('refuses a workspace with no package deployed, and aborts the stream', async (t) => {
      const { storage, repo } = await setup(t);
      await workspaceCreate(storage, repo, PROD);
      const out = collecting();
      await assert.rejects(workspaceBundleExport(storage, repo, PROD, out.stream), WorkspaceNotDeployedError);
      assert.equal(out.ended(), 'aborted');
    });
  });
}
