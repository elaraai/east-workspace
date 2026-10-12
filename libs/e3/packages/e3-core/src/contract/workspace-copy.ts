/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A workspace copy's contract, over any backend: the target becomes the source
 * as it is now — its package and every dataset ref, each record's head and
 * each task's output among them — and nothing in the source changes; a write
 * to either afterwards leaves the other as it was. A target that exists is
 * replaced whole, and so are the refs a copy cut short left; a copy onto a
 * workspace a dataflow runs in is refused, and a source held shared is copied.
 * A copy holds both workspaces as a copy, and the repository's running work,
 * so gc holding the repository still refuses it.
 */

import { describe, it, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { East, IntegerType, StringType, encodeBeast2For, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { WorkspaceRecordType, type TreePath } from '@elaraai/e3-types';
import { InvalidNameError, WorkspaceLockError, WorkspaceNotFoundError } from '../errors.js';
import { packageImport } from '../package-files.js';
import { workspaceGetDataset, workspaceSetDataset } from '../trees.js';
import { workspaceCopy, workspaceCreate, workspaceGetPackage, workspaceGetState, workspaceList, workspaceRemove } from '../workspaces.js';
import { workspaceDeploy } from '../workspace-files.js';
import { TASKS_LOCK } from '../running-work.js';
import { uuidv7 } from '../uuid.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { BackendSetup } from './setup.js';

const PKG = 'copy-pkg';
const PROD = 'production';
const STAGING = 'staging';

/** An input's dataset path. */
const input = (name: string): TreePath => [variant('field', 'inputs'), variant('field', name)];

/** A backend, a repository in it, and production deployed there. */
interface Deployed {
  storage: StorageBackend;
  repo: string;
}

/**
 * Registers a workspace copy's contract suite.
 *
 * @remarks
 * Every case copies through the storage interfaces, so a backend runs it over
 * its own stores by giving its own setup. The package's versions:
 * - `1.0.0`: `note` (String, `one`), a task over it, and a record, `counts`
 * - `2.0.0`: 1.0.0 and `extra` (Integer, 1)
 *
 * @param setup - Makes a fresh backend and a repository in it for each test
 */
export function workspaceCopyTests(setup: BackendSetup): void {
  describe('a workspace copy', () => {
    let dir: string;
    const zips: string[] = [];

    before(async () => {
      dir = mkdtempSync(join(tmpdir(), 'e3-contract-'));
      for (const version of ['1.0.0', '2.0.0']) {
        const note = e3.input('note', StringType, variant('value', 'one'));
        const members = [
          e3.task('echo', [note], East.function([StringType], StringType, ($, x) => x)),
          e3.record('counts', IntegerType, 0n),
          ...(version === '2.0.0' ? [e3.input('extra', IntegerType, variant('value', 1n))] : []),
        ];
        const zip = join(dir, `${PKG}-${version}.zip`);
        await e3.export(e3.package(PKG, version, ...members), zip);
        zips.push(zip);
      }
    });

    after(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    /** Production with 1.0.0 deployed, its note set, and its task's output
     *  written and its current run named as a run that succeeded leaves them. */
    const production = async (t: TestContext): Promise<Deployed> => {
      const { storage, repo } = await setup(t);
      for (const zip of zips) await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, PROD);
      await workspaceDeploy(storage, repo, PROD, PKG, '1.0.0');
      await workspaceSetDataset(storage, repo, PROD, input('note'), 'mine', StringType);
      const output = await storage.objects.write(repo, encodeBeast2For(StringType)('mine'));
      await storage.datasets.write(repo, PROD, 'tasks/echo/output', variant('value', { hash: output, versions: new Map() }));
      const deployed = await workspaceGetState(storage, repo, PROD);
      assert.ok(deployed !== null);
      await storage.refs.workspaceWrite(repo, PROD, encodeBeast2For(WorkspaceRecordType)(some({ ...deployed, currentRunId: some(uuidv7()) })));
      return { storage, repo };
    };

    const refs = ({ storage, repo }: Deployed, ws: string) => storage.datasets.readAll(repo, ws);
    const note = ({ storage, repo }: Deployed, ws: string): Promise<unknown> => workspaceGetDataset(storage, repo, ws, input('note'));

    it('makes the target the source as it is now: its package and every dataset ref, each record\'s head and each task\'s output among them', async (t) => {
      const ws = await production(t);
      await workspaceCopy(ws.storage, ws.repo, PROD, STAGING);

      const copied = await refs(ws, STAGING);
      assert.deepEqual(copied, await refs(ws, PROD));
      assert.deepEqual([...copied.keys()].sort(), ['inputs/note', 'records/counts', 'tasks/echo/output']);
      assert.deepEqual(await workspaceGetPackage(ws.storage, ws.repo, STAGING), await workspaceGetPackage(ws.storage, ws.repo, PROD));
      assert.equal(await note(ws, STAGING), 'mine');
      const state = await workspaceGetState(ws.storage, ws.repo, STAGING);
      assert.deepEqual(state?.currentRunId, none, 'the target names no run of its own');
      assert.ok((await workspaceList(ws.storage, ws.repo)).includes(STAGING));
    });

    it('leaves the source as it was, and a write to either afterwards leaves the other as it was', async (t) => {
      const ws = await production(t);
      const before = await refs(ws, PROD);
      const deployed = await workspaceGetState(ws.storage, ws.repo, PROD);
      await workspaceCopy(ws.storage, ws.repo, PROD, STAGING);
      assert.deepEqual(await refs(ws, PROD), before);
      assert.deepEqual(await workspaceGetState(ws.storage, ws.repo, PROD), deployed);

      await workspaceSetDataset(ws.storage, ws.repo, STAGING, input('note'), 'staged', StringType);
      assert.equal(await note(ws, PROD), 'mine');
      await workspaceSetDataset(ws.storage, ws.repo, PROD, input('note'), 'live', StringType);
      assert.equal(await note(ws, STAGING), 'staged');
    });

    it('replaces a target that exists, whole: its refs and its runs go', async (t) => {
      const ws = await production(t);
      await workspaceCreate(ws.storage, ws.repo, STAGING);
      await workspaceDeploy(ws.storage, ws.repo, STAGING, PKG, '2.0.0');
      await workspaceSetDataset(ws.storage, ws.repo, STAGING, input('note'), 'old', StringType);
      await ws.storage.refs.dataflowRunWrite(ws.repo, STAGING, {
        runId: uuidv7(),
        workspaceName: STAGING,
        packageRef: `${PKG}@2.0.0`,
        startedAt: new Date(),
        completedAt: none,
        status: variant('running', {}),
        inputVersions: new Map(),
        outputVersions: none,
        taskExecutions: new Map(),
        summary: { total: 1n, completed: 0n, cached: 0n, failed: 0n, skipped: 0n, reexecuted: 0n },
      });

      await workspaceCopy(ws.storage, ws.repo, PROD, STAGING);
      assert.deepEqual(await refs(ws, STAGING), await refs(ws, PROD), 'no ref of the target\'s own is left: 2.0.0\'s extra goes');
      assert.equal((await workspaceGetPackage(ws.storage, ws.repo, STAGING)).version, '1.0.0');
      assert.deepEqual(await ws.storage.refs.dataflowRunList(ws.repo, STAGING), [], 'the target\'s runs went with it');
    });

    it('clears the refs a copy cut short left at a name no workspace has, which a removal finds nothing at', async (t) => {
      const ws = await production(t);
      // A copy cut short wrote refs, and no record.
      const stray = await ws.storage.objects.write(ws.repo, encodeBeast2For(StringType)('stray'));
      await ws.storage.datasets.write(ws.repo, STAGING, 'inputs/stray', variant('value', { hash: stray, versions: new Map() }));
      await assert.rejects(workspaceRemove(ws.storage, ws.repo, STAGING), WorkspaceNotFoundError);

      await workspaceCopy(ws.storage, ws.repo, PROD, STAGING);
      assert.deepEqual(await refs(ws, STAGING), await refs(ws, PROD), 'the stray ref went');
    });

    it('holds both workspaces as a copy, so what either lock refuses, and what reads them, sees a copy', async (t) => {
      const ws = await production(t);
      const taken: string[] = [];
      const acquire = ws.storage.locks.acquire.bind(ws.storage.locks);
      ws.storage.locks.acquire = (repo, resource, operation, options) => {
        if (resource === PROD || resource === STAGING) taken.push(`${resource} ${operation.type} ${options?.mode ?? 'exclusive'}`);
        return acquire(repo, resource, operation, options);
      };
      await workspaceCopy(ws.storage, ws.repo, PROD, STAGING);
      assert.deepEqual(taken, [`${STAGING} workspace_copy exclusive`, `${PROD} workspace_copy shared`]);
    });

    it('copies a workspace nothing is deployed to as one nothing is deployed to', async (t) => {
      const ws = await production(t);
      await workspaceCreate(ws.storage, ws.repo, 'empty');
      await workspaceCopy(ws.storage, ws.repo, PROD, STAGING);

      await workspaceCopy(ws.storage, ws.repo, 'empty', STAGING);
      assert.equal(await workspaceGetState(ws.storage, ws.repo, STAGING), null);
      assert.ok((await workspaceList(ws.storage, ws.repo)).includes(STAGING), 'the target exists');
      assert.equal((await refs(ws, STAGING)).size, 0);
    });

    it('is refused while a dataflow runs in the target or something holds the source exclusively, and copies a source held shared', async (t) => {
      const ws = await production(t);
      await workspaceCreate(ws.storage, ws.repo, STAGING);

      const running = await ws.storage.locks.acquire(ws.repo, STAGING, variant('dataflow', null), { mode: 'shared' });
      assert.ok(running !== null);
      await assert.rejects(workspaceCopy(ws.storage, ws.repo, PROD, STAGING), WorkspaceLockError);
      await running.release();

      const deploying = await ws.storage.locks.acquire(ws.repo, PROD, variant('deployment', null));
      assert.ok(deploying !== null);
      await assert.rejects(workspaceCopy(ws.storage, ws.repo, PROD, STAGING), WorkspaceLockError);
      await deploying.release();

      const writing = await ws.storage.locks.acquire(ws.repo, PROD, variant('dataflow', null), { mode: 'shared' });
      assert.ok(writing !== null);
      await workspaceCopy(ws.storage, ws.repo, PROD, STAGING);
      await writing.release();
      assert.deepEqual(await refs(ws, STAGING), await refs(ws, PROD));
      assert.equal(await ws.storage.locks.getState(ws.repo, STAGING), null, 'the copy let the target go');
    });

    it('is refused, writing nothing, while gc holds the repository still', async (t) => {
      const ws = await production(t);
      // gc holds the repository's running work exclusively: the refs a copy
      // writes name objects a sweep could take before the target names them.
      const gc = await ws.storage.locks.acquire(ws.repo, TASKS_LOCK, variant('dataflow', null));
      assert.ok(gc !== null);
      await assert.rejects(workspaceCopy(ws.storage, ws.repo, PROD, STAGING), /a garbage collection or an upgrade holds this repository/);
      await gc.release();
      assert.ok(!(await workspaceList(ws.storage, ws.repo)).includes(STAGING), 'no target was made');
      assert.equal(await ws.storage.locks.getState(ws.repo, STAGING), null, 'the copy let the target go');

      await workspaceCopy(ws.storage, ws.repo, PROD, STAGING);
      assert.deepEqual(await refs(ws, STAGING), await refs(ws, PROD));
    });

    it('refuses a source that does not exist, a copy onto itself, and a name no workspace can have', async (t) => {
      const ws = await production(t);
      await assert.rejects(workspaceCopy(ws.storage, ws.repo, 'missing', STAGING), WorkspaceNotFoundError);
      await assert.rejects(workspaceCopy(ws.storage, ws.repo, PROD, PROD), (err: unknown) => err instanceof InvalidNameError &&
        err.message === `the workspace name ${JSON.stringify(PROD)} is the workspace copied: a workspace cannot be copied onto itself`);
      await assert.rejects(workspaceCopy(ws.storage, ws.repo, PROD, 'a#b'), InvalidNameError);
      assert.ok(!(await workspaceList(ws.storage, ws.repo)).includes('missing'));
    });
  });
}
