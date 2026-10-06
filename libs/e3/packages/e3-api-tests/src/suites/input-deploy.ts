/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Input deploy test suite.
 *
 * A deploy gives each input the new package's value, or keeps the one someone
 * set while its type is the new package's when the client asks it to
 * (`inputs: 'keep-edited'`), and its job says what it did with each input, as
 * it says what it did with each record. This takes the policy through the API
 * against a real server: the request, the job, its result and the values the
 * workspace holds after it.
 */

import { describe, it, type TestContext as NodeTestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { IntegerType, StringType, decodeBeast2For, encodeBeast2For, variant } from '@elaraai/east';
import {
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  workspaceGet,
  datasetGet,
  datasetSet,
  type InputPlan,
  type WorkspaceDeployOptions,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createInputsPackageZip, type InputsFixtureVersion } from '../fixtures.js';

const PKG = 'inputs-pkg';
const WS = 'inputs-ws';
const note = [variant('field', 'inputs'), variant('field', 'note')];
const limit = [variant('field', 'inputs'), variant('field', 'limit')];

export function inputDeployTests(setup: TestSetup<TestContext>): void {
  /** A fresh repository holding both versions of the package, with 1.0.0
   *  deployed to a workspace, and its note and limit set there. */
  async function edited(t: NodeTestContext): Promise<TestContext> {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    for (const version of ['1.0.0', '2.0.0'] as const) {
      const zip = await createInputsPackageZip(ctx.tempDir, PKG, version);
      await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(zip), opts);
    }
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, WS, opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, WS, `${PKG}@1.0.0`, opts);
    await datasetSet(ctx.config.baseUrl, ctx.repoName, WS, note, encodeBeast2For(StringType)('mine'), opts);
    await datasetSet(ctx.config.baseUrl, ctx.repoName, WS, limit, encodeBeast2For(IntegerType)(99n), opts);
    return ctx;
  }

  /** Deploy a version of the package: what the deploy decided for each input. */
  async function deploy(ctx: TestContext, version: InputsFixtureVersion, options: WorkspaceDeployOptions = {}): Promise<InputPlan[]> {
    return (await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, WS, `${PKG}@${version}`, await ctx.opts(), options)).inputs;
  }

  /** The note the workspace holds. */
  async function noteOf(ctx: TestContext): Promise<string> {
    return decodeBeast2For(StringType)((await datasetGet(ctx.config.baseUrl, ctx.repoName, WS, note, await ctx.opts())).data);
  }

  describe('input deploys', { concurrency: false }, () => {
    it('keeps an input someone set when asked, resets one whose type changed, and its job says which it did', async (t) => {
      const ctx = await edited(t);

      // A plan says it, and writes nothing.
      const plans = await deploy(ctx, '2.0.0', { inputs: 'keep-edited', plan: true });
      assert.deepEqual(plans.map((plan) => [plan.input, plan.action.type]), [['inputs/limit', 'reset'], ['inputs/note', 'keep']]);
      assert.equal((await workspaceGet(ctx.config.baseUrl, ctx.repoName, WS, await ctx.opts())).packageVersion, '1.0.0');

      assert.deepEqual(await deploy(ctx, '2.0.0', { inputs: 'keep-edited' }), plans);
      assert.equal(await noteOf(ctx), 'mine', 'the note someone set is kept');
      const reset = plans.find((plan) => plan.input === 'inputs/limit')!.action;
      assert.ok(reset.type === 'reset' && /changed type/.test(reset.value.reason), 'the limit changed type, which the plan says');
      assert.equal(
        decodeBeast2For(StringType)((await datasetGet(ctx.config.baseUrl, ctx.repoName, WS, limit, await ctx.opts())).data),
        'ten', 'the limit takes the package\'s value');
    });

    it('resets every input someone set when not asked to keep it, naming the policy that keeps it', async (t) => {
      const ctx = await edited(t);
      const plans = await deploy(ctx, '2.0.0');
      const reset = plans.find((plan) => plan.input === 'inputs/note')!.action;
      assert.ok(reset.type === 'reset' && reset.value.policy && /the keep-edited policy keeps it/.test(reset.value.reason),
        'the plan says only the policy resets it, and which keeps it');
      assert.equal(await noteOf(ctx), 'two', 'the note takes the package\'s value');
    });
  });
}
