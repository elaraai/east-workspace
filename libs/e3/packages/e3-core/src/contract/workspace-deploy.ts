/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A deploy's contract over a workspace's inputs, over any backend: what it does
 * with each, as its plan says — an input the deployed package set, one someone
 * set, one whose type changed, one the new package takes from a file, one the
 * deployed package took from a file, one new to the package and one it drops —
 * under each policy, a deploy that reads no file, and a plan that writes
 * nothing.
 */

import { describe, it, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { East, IntegerType, StringType, encodeBeast2For, variant, type EastType } from '@elaraai/east';
import e3 from '@elaraai/e3';
import type { InputPlan, InputPolicy, TreePath } from '@elaraai/e3-types';
import { packageImport } from '../package-files.js';
import { workspaceGetDataset, workspaceSetDataset } from '../trees.js';
import { workspaceCreate, workspaceGetPackage } from '../workspaces.js';
import { workspaceDeploy } from '../workspace-files.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { BackendSetup } from './setup.js';

const PKG = 'inputs-pkg';
const WS = 'inputs-ws';

/** An input's dataset path. */
const input = (name: string): TreePath => [variant('field', 'inputs'), variant('field', name)];

/** A workspace in a fresh backend. */
interface Deployed {
  storage: StorageBackend;
  repo: string;
}

/**
 * Registers a deploy's contract suite over a workspace's inputs.
 *
 * @remarks
 * Every case deploys through the storage interfaces, so a backend runs it over
 * its own stores by giving its own setup. The package's versions:
 * - `1.0.0`: `note` (String, `one`), `limit` (Integer, 10) and `gone`
 *   (String, `g`), and a task over `note`
 * - `2.0.0`: `note` (String, `two`), `limit` a String (`ten`), `fresh`
 *   (Integer, 1), and no `gone`
 * - `3.0.0`: `note` taken from a file, and `limit` as 2.0.0 has it
 *
 * @param setup - Makes a fresh backend and a repository in it for each test
 */
export function workspaceDeployTests(setup: BackendSetup): void {
  describe('a deploy\'s inputs', () => {
    let dir: string;
    let file: string;
    const zips = new Map<string, string>();

    before(async () => {
      dir = mkdtempSync(join(tmpdir(), 'e3-contract-'));
      file = join(dir, 'note.beast2');
      writeFileSync(file, encodeBeast2For(StringType)('from the file'));
      const echo = (note: ReturnType<typeof e3.input<'note', typeof StringType>>) =>
        e3.task('echo', [note], East.function([StringType], StringType, ($, x) => x));
      const versions = {
        '1.0.0': [
          echo(e3.input('note', StringType, variant('value', 'one'))),
          e3.input('limit', IntegerType, variant('value', 10n)),
          e3.input('gone', StringType, variant('value', 'g')),
        ],
        '2.0.0': [
          echo(e3.input('note', StringType, variant('value', 'two'))),
          e3.input('limit', StringType, variant('value', 'ten')),
          e3.input('fresh', IntegerType, variant('value', 1n)),
        ],
        '3.0.0': [
          echo(e3.input('note', StringType, variant('file', file))),
          e3.input('limit', StringType, variant('value', 'ten')),
        ],
      };
      for (const [version, members] of Object.entries(versions)) {
        const zip = join(dir, `${PKG}-${version}.zip`);
        await e3.export(e3.package(PKG, version, ...members), zip);
        zips.set(version, zip);
      }
    });

    after(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    /** A workspace with 1.0.0 deployed, in a fresh backend holding every
     *  version of the package. */
    const deployed = async (t: TestContext): Promise<Deployed> => {
      const { storage, repo } = await setup(t);
      for (const zip of zips.values()) await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, WS);
      await workspaceDeploy(storage, repo, WS, PKG, '1.0.0');
      return { storage, repo };
    };

    /** Deploy a version: each input's plan, in the order the deploy says them. */
    const deploy = async (
      { storage, repo }: Deployed,
      version: string,
      options: { inputs?: InputPolicy; plan?: boolean; resolveFileSources?: boolean } = {},
    ): Promise<InputPlan[]> => {
      const plans: InputPlan[] = [];
      await workspaceDeploy(storage, repo, WS, PKG, version, { ...options, onInputPlan: (plan) => plans.push(plan) });
      return plans;
    };

    /** Each input's fate, by its path. */
    const fates = (plans: InputPlan[]): Array<[string, string]> => plans.map((plan) => [plan.input, plan.action.type]);

    /** The reason a plan gives for resetting `path`. */
    const reason = (plans: InputPlan[], path: string): string => {
      const action = plans.find((plan) => plan.input === path)?.action;
      assert.ok(action?.type === 'reset', `${path} is reset`);
      return action.value.reason;
    };

    const value = ({ storage, repo }: Deployed, name: string): Promise<unknown> => workspaceGetDataset(storage, repo, WS, input(name));
    const set = ({ storage, repo }: Deployed, name: string, to: unknown, type: EastType): Promise<void> =>
      workspaceSetDataset(storage, repo, WS, input(name), to, type);

    it('gives each input the package\'s value on a workspace\'s first deploy', async (t) => {
      const { storage, repo } = await setup(t);
      await packageImport(storage, repo, zips.get('1.0.0')!);
      await workspaceCreate(storage, repo, WS);
      assert.deepEqual(fates(await deploy({ storage, repo }, '1.0.0', { inputs: 'keep-edited' })),
        [['inputs/gone', 'package'], ['inputs/limit', 'package'], ['inputs/note', 'package']]);
      assert.equal(await value({ storage, repo }, 'note'), 'one');
    });

    it('gives an input as the deployed package set it the new package\'s value', async (t) => {
      const ws = await deployed(t);
      const plans = await deploy(ws, '2.0.0', { inputs: 'keep-edited' });
      assert.deepEqual(fates(plans).find(([path]) => path === 'inputs/note'), ['inputs/note', 'package']);
      assert.equal(await value(ws, 'note'), 'two');
    });

    it('keeps an input someone set whose type is the new package\'s, as the workspace holds it', async (t) => {
      const ws = await deployed(t);
      await set(ws, 'note', 'mine', StringType);
      const held = await ws.storage.datasets.read(ws.repo, WS, 'inputs/note');

      const plans = await deploy(ws, '2.0.0', { inputs: 'keep-edited' });
      assert.deepEqual(fates(plans).find(([path]) => path === 'inputs/note'), ['inputs/note', 'keep']);
      assert.equal(await value(ws, 'note'), 'mine');
      assert.deepEqual(await ws.storage.datasets.read(ws.repo, WS, 'inputs/note'), held,
        'the ref the workspace held, its value and where it came from');
      assert.equal((await workspaceGetPackage(ws.storage, ws.repo, WS)).version, '2.0.0');
    });

    it('resets an input someone set whose type changed to the new package\'s value, and says why', async (t) => {
      const ws = await deployed(t);
      await set(ws, 'limit', 99n, IntegerType);

      const plans = await deploy(ws, '2.0.0', { inputs: 'keep-edited' });
      assert.match(reason(plans, 'inputs/limit'), /^was set in the workspace, and changed type:\n {4}\S/);
      assert.equal(await value(ws, 'limit'), 'ten');
    });

    it('resets every input someone set under reset, as it always has, and names the policy that keeps it', async (t) => {
      const ws = await deployed(t);
      await set(ws, 'note', 'mine', StringType);

      const plans = await deploy(ws, '2.0.0');
      assert.match(reason(plans, 'inputs/note'), /the keep-edited policy keeps it$/);
      assert.deepEqual(plans.find((plan) => plan.input === 'inputs/note')?.action,
        variant('reset', { reason: reason(plans, 'inputs/note'), policy: true }), 'only the policy resets it');
      assert.equal(await value(ws, 'note'), 'two');
    });

    it('says a changed type under reset too, which keep-edited would reset as well', async (t) => {
      const ws = await deployed(t);
      await set(ws, 'limit', 99n, IntegerType);

      const plans = await deploy(ws, '2.0.0');
      assert.match(reason(plans, 'inputs/limit'), /^was set in the workspace, and changed type:/);
      assert.deepEqual(plans.find((plan) => plan.input === 'inputs/limit')?.action,
        variant('reset', { reason: reason(plans, 'inputs/limit'), policy: false }));
    });

    it('gives an input new to the package its value, and drops one the package no longer declares', async (t) => {
      const ws = await deployed(t);
      await set(ws, 'gone', 'mine', StringType);

      assert.deepEqual(fates(await deploy(ws, '2.0.0', { inputs: 'keep-edited' })),
        [['inputs/fresh', 'package'], ['inputs/limit', 'package'], ['inputs/note', 'package'], ['inputs/gone', 'drop']]);
      assert.equal(await value(ws, 'fresh'), 1n);
      assert.equal(await ws.storage.datasets.read(ws.repo, WS, 'inputs/gone'), null);
    });

    it('takes an input the new package names a file for from its file, whoever set it', async (t) => {
      const ws = await deployed(t);
      await set(ws, 'note', 'mine', StringType);

      const plans = await deploy(ws, '3.0.0', { inputs: 'keep-edited' });
      assert.deepEqual(plans.find((plan) => plan.input === 'inputs/note')?.action, variant('file', { path: file, taken: true }));
      assert.equal(await value(ws, 'note'), 'from the file');
    });

    it('resets an input the deployed package took from a file under either policy, and says why: a value set since cannot be told from the file\'s', async (t) => {
      const ws = await deployed(t);
      await deploy(ws, '3.0.0');
      await set(ws, 'note', 'mine', StringType);

      for (const inputs of ['keep-edited', 'reset'] as const) {
        const plans = await deploy(ws, '2.0.0', { inputs, plan: true });
        assert.match(reason(plans, 'inputs/note'), /^took its value from a file under the deployed package, and a value set since cannot be told from the file's$/);
      }
      await deploy(ws, '2.0.0', { inputs: 'keep-edited' });
      assert.equal(await value(ws, 'note'), 'two');
    });

    it('leaves an input for its file unassigned when the deploy reads no file, and says so', async (t) => {
      const ws = await deployed(t);

      const plans = await deploy(ws, '3.0.0', { resolveFileSources: false });
      assert.deepEqual(plans.find((plan) => plan.input === 'inputs/note')?.action, variant('file', { path: file, taken: false }));
      assert.equal((await ws.storage.datasets.read(ws.repo, WS, 'inputs/note'))?.type, 'unassigned');
      assert.deepEqual(fates(await deploy(ws, '2.0.0', { inputs: 'keep-edited' })).find(([path]) => path === 'inputs/note'),
        ['inputs/note', 'package'], 'nothing was set, so the next package\'s value is given');
    });

    it('says each input\'s fate under a plan, and writes nothing', async (t) => {
      const ws = await deployed(t);
      await set(ws, 'note', 'mine', StringType);
      await set(ws, 'limit', 99n, IntegerType);

      const plans = await deploy(ws, '2.0.0', { inputs: 'keep-edited', plan: true });
      assert.deepEqual(fates(plans),
        [['inputs/fresh', 'package'], ['inputs/limit', 'reset'], ['inputs/note', 'keep'], ['inputs/gone', 'drop']]);
      assert.equal((await workspaceGetPackage(ws.storage, ws.repo, WS)).version, '1.0.0');
      assert.equal(await value(ws, 'note'), 'mine');
      assert.equal(await value(ws, 'limit'), 99n);
      assert.equal(await value(ws, 'gone'), 'g');
    });
  });
}
