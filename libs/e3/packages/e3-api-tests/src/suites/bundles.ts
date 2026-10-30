/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Workspace bundle test suite: a workspace written out as a bundle, and a
 * workspace made from one, over the API (`GET` and `POST
 * …/workspaces/:ws/bundle`).
 *
 * Not one of `apiTestSuites`: a host mounts the bundle routes where a
 * workspace's bundle fits in a request — e3-api-server's own process, and the
 * browser's e3 — and a host that serves them registers this suite as well.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { IntegerType, encodeBeast2For, none, some, variant } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import {
  ApiError,
  dataflowExecute,
  datasetGet,
  datasetGetPage,
  packageImport,
  workspaceBundle,
  workspaceBundleImport,
  workspaceCreate,
  workspaceDeploy,
  workspaceList,
  workspaceRecordMutate,
  workspaceStatus,
} from '@elaraai/e3-api-client';

import { assertMutationCommitted } from '../assertions.js';
import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createKeyedRecordPackageZip, createPackageZip } from '../fixtures.js';

const SOURCE = 'bundled-ws';
const MADE = 'made-ws';
const plansPath: TreePath = [variant('field', 'records'), variant('field', 'plans')];

/** Whether an error is an API error of the code. */
const refusedAs = (code: string) => (err: unknown): boolean => err instanceof ApiError && err.code === code;

/**
 * Register workspace bundle tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function workspaceBundleTests(setup: TestSetup<TestContext>): void {
  /** A workspace the compute package is deployed to and its dataflow run. */
  const withRun = async (t: Parameters<TestSetup<TestContext>>[0]): Promise<TestContext> => {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(await createPackageZip(ctx.tempDir, 'bundle-pkg', '1.0.0')), opts);
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, SOURCE, opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, SOURCE, 'bundle-pkg@1.0.0', opts);
    const run = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, SOURCE, {}, opts);
    assert.ok(run.success, 'the dataflow ran');
    return ctx;
  };

  describe('workspace bundles', { concurrency: false }, () => {
    it('makes a workspace from another\'s bundle, its datasets as they were and its tasks up to date', async (t) => {
      const ctx = await withRun(t);
      const opts = await ctx.opts();
      const bundle = await workspaceBundle(ctx.config.baseUrl, ctx.repoName, SOURCE, opts);
      const made = await workspaceBundleImport(ctx.config.baseUrl, ctx.repoName, MADE, bundle, opts);
      assert.equal(made.name, MADE);
      assert.equal(made.deployed, true);
      assert.deepEqual(made.packageName, some('bundle-pkg'));
      assert.ok((await workspaceList(ctx.config.baseUrl, ctx.repoName, opts)).some((ws) => ws.name === MADE));

      const output: TreePath = [variant('field', 'tasks'), variant('field', 'compute'), variant('field', 'output')];
      const read = async (ws: string) => (await datasetGet(ctx.config.baseUrl, ctx.repoName, ws, output, opts)).data;
      assert.deepEqual(await read(MADE), await read(SOURCE));
      const status = await workspaceStatus(ctx.config.baseUrl, ctx.repoName, MADE, opts);
      assert.deepEqual(status.tasks.map((task) => [task.name, task.status.type]), [['compute', 'up-to-date']],
        'the execution its output came from travelled with it');
    });

    it('carries a record whole: its rows, and its index read in the index\'s own order', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();
      await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(await createKeyedRecordPackageZip(ctx.tempDir, 'bundle-records', '1.0.0')), opts);
      await workspaceCreate(ctx.config.baseUrl, ctx.repoName, SOURCE, opts);
      await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, SOURCE, 'bundle-records@1.0.0', opts);
      const seeded = await workspaceRecordMutate(ctx.config.baseUrl, ctx.repoName, SOURCE, 'plans', 'seed',
        { args: [encodeBeast2For(IntegerType)(30n)], actor: none, limits: none }, opts);
      assertMutationCommitted(seeded, 'seeding');

      await workspaceBundleImport(ctx.config.baseUrl, ctx.repoName, MADE, await workspaceBundle(ctx.config.baseUrl, ctx.repoName, SOURCE, opts), opts);
      const rows = async (ws: string) => (await datasetGet(ctx.config.baseUrl, ctx.repoName, ws, plansPath, opts)).data;
      assert.deepEqual(await rows(MADE), await rows(SOURCE));
      const page = async (ws: string) => (await datasetGetPage(ctx.config.baseUrl, ctx.repoName, ws, plansPath, { offset: 0, limit: 10, index: 'by_status' }, opts)).data;
      assert.deepEqual(await page(MADE), await page(SOURCE));
    });

    it('refuses a name a workspace has: workspace_exists', async (t) => {
      const ctx = await withRun(t);
      const opts = await ctx.opts();
      const bundle = await workspaceBundle(ctx.config.baseUrl, ctx.repoName, SOURCE, opts);
      await assert.rejects(workspaceBundleImport(ctx.config.baseUrl, ctx.repoName, SOURCE, bundle, opts), refusedAs('workspace_exists'));
    });

    it('refuses bytes that are no bundle, and a bundle cut short: bundle_invalid, and no workspace is made', async (t) => {
      const ctx = await withRun(t);
      const opts = await ctx.opts();
      const bundle = await workspaceBundle(ctx.config.baseUrl, ctx.repoName, SOURCE, opts);
      await assert.rejects(workspaceBundleImport(ctx.config.baseUrl, ctx.repoName, MADE, encodeBeast2For(IntegerType)(1n), opts), refusedAs('bundle_invalid'));
      await assert.rejects(workspaceBundleImport(ctx.config.baseUrl, ctx.repoName, MADE, bundle.subarray(0, Math.floor(bundle.byteLength / 2)), opts),
        refusedAs('bundle_invalid'));
      assert.ok(!(await workspaceList(ctx.config.baseUrl, ctx.repoName, opts)).some((ws) => ws.name === MADE));
    });

    it('answers workspace_not_found for the bundle of a workspace that does not exist, and workspace_not_deployed for one with no package', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();
      await assert.rejects(workspaceBundle(ctx.config.baseUrl, ctx.repoName, 'nowhere', opts), refusedAs('workspace_not_found'));
      await workspaceCreate(ctx.config.baseUrl, ctx.repoName, SOURCE, opts);
      await assert.rejects(workspaceBundle(ctx.config.baseUrl, ctx.repoName, SOURCE, opts), refusedAs('workspace_not_deployed'));
    });
  });
}
