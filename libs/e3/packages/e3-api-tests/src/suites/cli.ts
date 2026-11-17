/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * CLI operations test suite.
 *
 * Tests CLI commands against remote URLs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  East, IntegerType, PatchType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, encodeEastIR, variant,
  type PatchTypeOf, type ValueTypeOf,
} from '@elaraai/east';

import { computeHash } from '@elaraai/e3-core';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { removeWorkspaceAfter, runE3Command, writeCliCredentials } from '../cli.js';
import {
  createPackageZip, createFunctionPackageZip, createDraftsPackageZip, createKeyedRecordPackageZip, createMigrationPackageZip,
  createCompositeRecordPackageZip, DraftJobsType, ErpOrdersType, PlansType,
} from '../fixtures.js';

/** What one touched key of a plans patch carries — derived from the patch type
 *  rather than hand-written, so it follows the row type. */
type PlanOp = Extract<ValueTypeOf<PatchTypeOf<typeof PlansType>>, { type: 'patch' }>['value'] extends Map<string, infer Op>
  ? Op : never;
/** What one touched key of a patch of the drafts fixture's jobs carries. */
type DraftJobOp = Extract<ValueTypeOf<PatchTypeOf<typeof DraftJobsType>>, { type: 'patch' }>['value'] extends Map<string, infer Op>
  ? Op : never;

/**
 * Register CLI operation tests.
 *
 * These tests run CLI commands against a remote URL and verify output.
 *
 * @param setup - Factory that creates a fresh test context per test
 * @param getCredentialsEnv - Function that returns env vars for auth (E3_CREDENTIALS_PATH, etc.)
 */
export function cliTests(
  setup: TestSetup<TestContext>,
  getCredentialsEnv: () => Record<string, string>
): void {
  const withCli: TestSetup<TestContext & { remoteUrl: string; workDir: string }> = async (t) => {
    const ctx = await setup(t);
    const remoteUrl = `${ctx.config.baseUrl}/repos/${ctx.repoName}`;
    const workDir = join(ctx.tempDir, 'cli-work');
    mkdirSync(workDir, { recursive: true });
    return Object.assign(ctx, { remoteUrl, workDir });
  };

  const withCliPackage: TestSetup<TestContext & { remoteUrl: string; workDir: string; packageZipPath: string }> = async (t) => {
    const c = await withCli(t);
    const packageZipPath = await createPackageZip(c.tempDir, 'cli-test-pkg', '1.0.0');
    return Object.assign(c, { packageZipPath });
  };

  /** Removes a workspace a test makes once the test ends, however it ends. */
  const removeAfter = (t: Parameters<typeof withCli>[0], remoteUrl: string, wsName: string): void =>
    removeWorkspaceAfter(t, remoteUrl, wsName, getCredentialsEnv);

  describe('cli', { concurrency: false }, () => {
    describe('repo commands', { concurrency: false }, () => {
      it('repo status via remote URL', async (t) => {
        const { remoteUrl, workDir } = await withCli(t);
        const result = await runE3Command(['repo', 'status', remoteUrl], workDir, { env: getCredentialsEnv() });

        assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
        assert.match(result.stdout, /Repository:/);
        assert.match(result.stdout, /Objects:/);
        assert.match(result.stdout, /Packages:/);
        assert.match(result.stdout, /Workspaces:/);
      });

      it('repo gc via remote URL', async (t) => {
        const { remoteUrl, workDir } = await withCli(t);
        const result = await runE3Command(['repo', 'gc', remoteUrl], workDir, { env: getCredentialsEnv() });

        assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
        assert.match(result.stdout, /Running garbage collection/);
        assert.match(result.stdout, /Garbage collection complete/);
      });

      it('repo gc --dry-run via remote URL', async (t) => {
        const { remoteUrl, workDir } = await withCli(t);
        const result = await runE3Command(['repo', 'gc', remoteUrl, '--dry-run'], workDir, { env: getCredentialsEnv() });

        assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
        assert.match(result.stdout, /Dry run/);
      });

      it('repo list via server URL', async (t) => {
        const ctx = await withCli(t);
        // repo list takes server URL, not repo URL
        const result = await runE3Command(['repo', 'list', ctx.config.baseUrl], ctx.workDir, { env: getCredentialsEnv() });

        assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
        assert.match(result.stdout, /Repositories:/);
        // Our test repo should be in the list
        assert.match(result.stdout, new RegExp(ctx.repoName));
      });
    });

    describe('workspace commands', { concurrency: false }, () => {
      it('workspace list via remote URL', async (t) => {
        const { remoteUrl, workDir } = await withCli(t);
        const result = await runE3Command(['workspace', 'list', remoteUrl], workDir, { env: getCredentialsEnv() });

        assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
        // Initially empty or has workspaces from other tests
        assert.ok(result.stdout.length > 0);
      });

      it('workspace create via remote URL', async (t) => {
        const { remoteUrl, workDir } = await withCli(t);
        const wsName = `cli-test-ws-${Date.now()}`;
        removeAfter(t, remoteUrl, wsName);
        const result = await runE3Command(['workspace', 'create', remoteUrl, wsName], workDir, { env: getCredentialsEnv() });

        assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
        assert.match(result.stdout, new RegExp(`Created workspace: ${wsName}`));
      });

      it('workspace remove via remote URL', async (t) => {
        const { remoteUrl, workDir } = await withCli(t);
        const wsName = `cli-remove-ws-${Date.now()}`;
        // Gone already when the remove under test works
        removeAfter(t, remoteUrl, wsName);

        // Create first
        await runE3Command(['workspace', 'create', remoteUrl, wsName], workDir, { env: getCredentialsEnv() });

        // Remove
        const result = await runE3Command(['workspace', 'remove', remoteUrl, wsName], workDir, { env: getCredentialsEnv() });

        assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
        assert.match(result.stdout, new RegExp(`Removed workspace: ${wsName}`));
      });
    });

    describe('package commands', { concurrency: false }, () => {
      it('package list via remote URL', async (t) => {
        const { remoteUrl, workDir } = await withCliPackage(t);
        const result = await runE3Command(['package', 'list', remoteUrl], workDir, { env: getCredentialsEnv() });

        assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
        // Either "No packages" or list of packages
        assert.ok(result.stdout.length > 0);
      });

      it('package import via remote URL', async (t) => {
        const { remoteUrl, workDir, packageZipPath } = await withCliPackage(t);
        const result = await runE3Command(['package', 'import', remoteUrl, packageZipPath], workDir, { env: getCredentialsEnv() });

        assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
        assert.match(result.stdout, /Imported cli-test-pkg@1.0.0/);
      });

      it('package remove via remote URL', async (t) => {
        const { remoteUrl, workDir, packageZipPath } = await withCliPackage(t);
        // Import first
        await runE3Command(['package', 'import', remoteUrl, packageZipPath], workDir, { env: getCredentialsEnv() });

        // Remove
        const result = await runE3Command(['package', 'remove', remoteUrl, 'cli-test-pkg@1.0.0'], workDir, { env: getCredentialsEnv() });

        assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
        assert.match(result.stdout, /Removed cli-test-pkg@1.0.0/);
      });
    });

    describe('full workflow via CLI', { concurrency: false }, () => {
      it('imports package, creates workspace, deploys, and lists recursively', async (t) => {
        const ctx = await withCli(t);
        const { remoteUrl, workDir } = ctx;
        const packageZipPath = await createPackageZip(ctx.tempDir, 'workflow-pkg', '1.0.0');
        const wsName = `workflow-ws-${Date.now()}`;
        const env = getCredentialsEnv();
        removeAfter(t, remoteUrl, wsName);

        // Import package
        let result = await runE3Command(['package', 'import', remoteUrl, packageZipPath], workDir, { env });
        assert.strictEqual(result.exitCode, 0, `Import failed: ${result.stderr}`);

        // Create workspace
        result = await runE3Command(['workspace', 'create', remoteUrl, wsName], workDir, { env });
        assert.strictEqual(result.exitCode, 0, `Create workspace failed: ${result.stderr}`);

        // Deploy
        result = await runE3Command(['workspace', 'deploy', remoteUrl, wsName, 'workflow-pkg@1.0.0'], workDir, { env });
        assert.strictEqual(result.exitCode, 0, `Deploy failed: ${result.stderr}`);
        assert.match(result.stdout, new RegExp(`Deployed workflow-pkg@1.0.0 to workspace: ${wsName}`));

        // List with details
        result = await runE3Command(['dataset', 'list', remoteUrl, wsName, '-l'], workDir, { env });
        assert.strictEqual(result.exitCode, 0, `List -l failed: ${result.stderr}`);
        assert.match(result.stdout, /value/, 'Should list input dataset');
        // Datasets should show status columns (set/unset)
        assert.match(result.stdout, /unset|set/, 'Datasets should show status');

        // List paths only
        result = await runE3Command(['dataset', 'list', remoteUrl, wsName], workDir, { env });
        assert.strictEqual(result.exitCode, 0, `List failed: ${result.stderr}`);
        assert.match(result.stdout, /\bvalue\b/, 'Should list input paths');
      });

      it('executes dataflow via CLI and shows logs', async (t) => {
        const ctx = await withCli(t);
        const { remoteUrl, workDir } = ctx;
        const packageZipPath = await createPackageZip(ctx.tempDir, 'exec-cli-pkg', '1.0.0');
        const wsName = `exec-cli-ws-${Date.now()}`;
        const env = getCredentialsEnv();
        removeAfter(t, remoteUrl, wsName);

        // Setup
        await runE3Command(['package', 'import', remoteUrl, packageZipPath], workDir, { env });
        await runE3Command(['workspace', 'create', remoteUrl, wsName], workDir, { env });
        await runE3Command(['workspace', 'deploy', remoteUrl, wsName, 'exec-cli-pkg@1.0.0'], workDir, { env });

        // Execute: the run's events as its polls serve them, then its summary
        const startResult = await runE3Command(['dataflow', 'run', remoteUrl, wsName], workDir, { env });
        assert.strictEqual(startResult.exitCode, 0, `Start failed: ${startResult.stderr}`);
        assert.match(startResult.stdout, /\[START\] compute[\s\S]*\[(DONE|CACHED)\] compute[\s\S]*Summary:/);

        // Show logs
        const logsResult = await runE3Command(['task', 'logs', remoteUrl, `${wsName}.compute`], workDir, { env });
        assert.strictEqual(logsResult.exitCode, 0, `Logs failed: ${logsResult.stderr}`);
        assert.match(logsResult.stdout, /Task:/);

        // The task's latest run, a page of one of its history
        const listResult = await runE3Command(['task', 'list', remoteUrl, wsName], workDir, { env });
        assert.strictEqual(listResult.exitCode, 0, `List failed: ${listResult.stderr}`);
        assert.match(listResult.stdout, /^ {2}compute {2}\[success\]$/m);
      });
    });

    describe('deploy command', { concurrency: false }, () => {
      it('says what a deploy would do with --plan, fails a plan the deploy would refuse, and says what it did', async (t) => {
        const ctx = await withCli(t);
        const { remoteUrl, workDir } = ctx;
        const env = getCredentialsEnv();
        const wsName = `deploy-cli-ws-${Date.now()}`;
        removeAfter(t, remoteUrl, wsName);
        for (const version of ['1.0.0', '2.0.0'] as const) {
          const zipPath = await createMigrationPackageZip(ctx.tempDir, 'deploy-cli-pkg', version);
          await runE3Command(['package', 'import', remoteUrl, zipPath], workDir, { env });
        }
        await runE3Command(['workspace', 'create', remoteUrl, wsName], workDir, { env });
        await runE3Command(['workspace', 'deploy', remoteUrl, wsName, 'deploy-cli-pkg@1.0.0'], workDir, { env });

        const plan = await runE3Command(['workspace', 'deploy', remoteUrl, wsName, 'deploy-cli-pkg@2.0.0', '--plan'], workDir, { env });
        assert.strictEqual(plan.exitCode, 0, `plan failed: ${plan.stderr}`);
        assert.match(plan.stdout, /migrate record records\/tasks: add_owner/);
        assert.match(plan.stdout, /A plan: nothing was written\./);

        const refused = await runE3Command(
          ['workspace', 'deploy', remoteUrl, wsName, 'deploy-cli-pkg@2.0.0', '--plan', '--schema=fail'], workDir, { env });
        assert.notStrictEqual(refused.exitCode, 0);
        assert.match(refused.stdout, /refuse record records\/tasks: it has migrations 'add_owner' to run/);
        assert.match(refused.stderr, /the deploy would be refused: a record, above/);

        const deployed = await runE3Command(['workspace', 'deploy', remoteUrl, wsName, 'deploy-cli-pkg@2.0.0'], workDir, { env });
        assert.strictEqual(deployed.exitCode, 0, `deploy failed: ${deployed.stderr}`);
        assert.match(deployed.stdout, /migrate record records\/tasks: add_owner/);
        assert.match(deployed.stdout, new RegExp(`Deployed deploy-cli-pkg@2.0.0 to workspace: ${wsName}`));
      });
    });

    describe('call command', { concurrency: false }, () => {
      const withFunctionPackage = async (t: Parameters<typeof withCli>[0]) => {
        const ctx = await withCli(t);
        const zipPath = await createFunctionPackageZip(ctx.tempDir, 'call-cli-pkg', '1.0.0');
        const env = getCredentialsEnv();
        await runE3Command(['package', 'import', ctx.remoteUrl, zipPath], ctx.workDir, { env });
        return Object.assign(ctx, { env });
      };

      it('calls a function with literal args and prints the result', async (t) => {
        const { remoteUrl, workDir, env } = await withFunctionPackage(t);
        const result = await runE3Command(['call', remoteUrl, 'call-cli-pkg.add', '2', '3'], workDir, { env });

        assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
        assert.match(result.stdout, /\b5\b/);
      });

      it('writes the result to a file with -o', async (t) => {
        const ctx = await withFunctionPackage(t);
        const outPath = join(ctx.workDir, 'result.beast2');
        const result = await runE3Command(
          ['call', ctx.remoteUrl, 'call-cli-pkg.add', '20', '22', '-o', outPath],
          ctx.workDir,
          { env: ctx.env }
        );

        assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
        const decoded = decodeBeast2For(IntegerType)(readFileSync(outPath));
        assert.strictEqual(decoded, 42n);
      });

      it('sets a non-zero exit code on arity mismatch', async (t) => {
        const { remoteUrl, workDir, env } = await withFunctionPackage(t);
        const result = await runE3Command(['call', remoteUrl, 'call-cli-pkg.add', '2'], workDir, { env });

        assert.notStrictEqual(result.exitCode, 0);
        assert.match(result.stderr, /argument/i);
      });

      it('passes a dataset of the workspace, written @<keypath>, with -w', async (t) => {
        const { remoteUrl, workDir, env } = await withFunctionPackage(t);
        const wsName = `call-cli-ws-${Date.now()}`;
        removeAfter(t, remoteUrl, wsName);
        for (const command of [['workspace', 'create', remoteUrl, wsName], ['workspace', 'deploy', remoteUrl, wsName, 'call-cli-pkg@1.0.0']]) {
          const setup = await runE3Command(command, workDir, { env });
          assert.strictEqual(setup.exitCode, 0, `${command[0]} ${command[1]} failed: ${setup.stderr}`);
        }

        // `value` holds 10
        const result = await runE3Command(['call', remoteUrl, '-w', wsName, 'add', '@.inputs.value', '5'], workDir, { env });
        assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
        assert.match(result.stdout, /\b15\b/);
      });

      it('calls a function with inputs through a workspace with its arguments alone, and is refused without -w, naming its inputs', async (t) => {
        const { remoteUrl, workDir, env } = await withFunctionPackage(t);
        const wsName = `call-cli-inputs-ws-${Date.now()}`;
        removeAfter(t, remoteUrl, wsName);
        for (const command of [['workspace', 'create', remoteUrl, wsName], ['workspace', 'deploy', remoteUrl, wsName, 'call-cli-pkg@1.0.0']]) {
          const setup = await runE3Command(command, workDir, { env });
          assert.strictEqual(setup.exitCode, 0, `${command[0]} ${command[1]} failed: ${setup.stderr}`);
        }

        // `quote` reads `value` (10) and `prices` (b 2) itself; the caller passes the sku
        const result = await runE3Command(['call', remoteUrl, '-w', wsName, 'quote', '"b"'], workDir, { env });
        assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
        assert.match(result.stdout, /\b12\b/);

        const counted = await runE3Command(['call', remoteUrl, '-w', wsName, 'quote', '10', '"b"'], workDir, { env });
        assert.notStrictEqual(counted.exitCode, 0);
        assert.match(counted.stderr, /Function 'quote' expects 1 argument\(s\), got 2/);

        const refused = await runE3Command(['call', remoteUrl, 'call-cli-pkg.quote', '"b"'], workDir, { env });
        assert.notStrictEqual(refused.exitCode, 0);
        assert.match(refused.stderr, /Function 'quote' reads \.inputs\.value, \.inputs\.prices from the workspace it is called through: pass -w <ws>/);
      });

      describe('drafts, written --draft', { concurrency: false }, () => {
        /** A workspace of the drafts fixture: `jobs` holds j1 on P1 for 2 hours,
         *  j2 on P2 for 3 and j3 on P1 for 4, and `tally` holds 0. */
        const withDrafts = async (t: Parameters<typeof withCli>[0], wsName: string) => {
          const ctx = await withCli(t);
          const { remoteUrl, workDir } = ctx;
          const env = getCredentialsEnv();
          removeAfter(t, remoteUrl, wsName);
          const zipPath = await createDraftsPackageZip(ctx.tempDir, 'call-drafts-pkg', '1.0.0');
          for (const command of [
            ['package', 'import', remoteUrl, zipPath], ['workspace', 'create', remoteUrl, wsName], ['workspace', 'deploy', remoteUrl, wsName, 'call-drafts-pkg@1.0.0'],
          ]) {
            const setup = await runE3Command(command, workDir, { env });
            assert.strictEqual(setup.exitCode, 0, `${command[0]} ${command[1]} failed: ${setup.stderr}`);
          }
          const call = (...words: string[]) => runE3Command(['call', remoteUrl, '-w', wsName, ...words], workDir, { env });
          /** A patch of the jobs, in a file a draft's argument names. */
          const patchFile = (name: string, ops: Array<[string, DraftJobOp]>): string => {
            const path = join(workDir, name);
            writeFileSync(path, encodeBeast2For(PatchType(DraftJobsType))(variant('patch', new SortedMap<string, DraftJobOp>(ops, compareFor(StringType)))));
            return path;
          };
          return { call, patchFile };
        };

        it('lays unsaved edits over the records a function reads, in the order written, and saves nothing', async (t) => {
          const { call, patchFile } = await withDrafts(t, `call-drafts-ws-${Date.now()}`);

          const saved = await call('jobs_on', '"P1"');
          assert.strictEqual(saved.exitCode, 0, `Failed: ${saved.stderr}`);
          assert.match(saved.stdout, /\b2\b/);
          const drafted = await call('jobs_on', '"P1"', '--draft', 'jobs.move', '"j2"', '"P1"');
          assert.strictEqual(drafted.exitCode, 0, `Failed: ${drafted.stderr}`);
          assert.match(drafted.stdout, /\b3\b/, 'the function reads j2 on P1');

          // Two records, a patch from a file, and a word that starts with a dash
          const gone = patchFile('gone.beast2', [['j1', variant('delete', { press: 'P1', hours: 2n })]]);
          const summed = await call('hours', '--draft', 'tally.add', '5', '--draft', 'jobs.patch', gone, '--draft', 'tally.add', '--draft=-1');
          assert.strictEqual(summed.exitCode, 0, `Failed: ${summed.stderr}`);
          assert.match(summed.stdout, /\b11\b/, 'j2\'s 3 hours and j3\'s 4, and a tally of 5 less 1');

          const after = await call('hours');
          assert.strictEqual(after.exitCode, 0, `Failed: ${after.stderr}`);
          assert.match(after.stdout, /\b9\b/, 'each record reads as it was saved');
        });

        it('reports the draft that ended a call, and refuses one the function or the workspace does not take', async (t) => {
          const wsName = `call-drafts-ends-ws-${Date.now()}`;
          const { call, patchFile } = await withDrafts(t, wsName);

          const failed = await call('jobs_on', '"P1"', '--draft', 'jobs.move', '"j2"', '"P1"', '--draft', 'jobs.refuse', '"not today"');
          assert.notStrictEqual(failed.exitCode, 0);
          assert.match(failed.stderr, /refused: not today/, 'the mutation\'s own stderr crosses the API');
          assert.match(failed.stderr, /Draft jobs\.refuse \(2 of 2\) failed with exit code: 1; the function did not run/);
          assert.strictEqual(failed.stdout.trim(), '');

          // A delete of a row that is not what the patch says it is
          const stale = patchFile('stale.beast2', [['j1', variant('delete', { press: 'P9', hours: 2n })]]);
          const unfit = await call('jobs_on', '"P1"', '--draft', 'jobs.patch', stale);
          assert.notStrictEqual(unfit.exitCode, 0);
          assert.match(unfit.stderr, /Draft jobs\.patch \(1 of 1\) conflicted: .*j1.* — the edit no longer matches the record; re-read it and call again/);

          const unlisted = await call('job_count', '--draft', 'jobs.move', '"j2"', '"P1"');
          assert.notStrictEqual(unlisted.exitCode, 0);
          assert.match(unlisted.stderr, /draft jobs\.move \(1 of 1\): the function lists no record a call may draft/);

          const ghost = await call('jobs_on', '"P1"', '--draft', 'ghost.add', '1');
          assert.notStrictEqual(ghost.exitCode, 0);
          assert.match(ghost.stderr, new RegExp(`Draft 1 \\(ghost\\.add\\): record 'ghost' not found in workspace '${wsName}'`));
        });
      });

      it('calls a function from its IR file as one of a workspace\'s calls, a reader a platform-free one alone, and is refused one without -w', async (t) => {
        const ctx = await withFunctionPackage(t);
        const { remoteUrl, workDir, env } = ctx;
        const wsName = `call-cli-ir-ws-${Date.now()}`;
        removeAfter(t, remoteUrl, wsName);
        for (const command of [['workspace', 'create', remoteUrl, wsName], ['workspace', 'deploy', remoteUrl, wsName, 'call-cli-pkg@1.0.0']]) {
          const setup = await runE3Command(command, workDir, { env });
          assert.strictEqual(setup.exitCode, 0, `${command[0]} ${command[1]} failed: ${setup.stderr}`);
        }
        // The program the package declares as `add`, in its IR file
        const ir = join(workDir, 'add.beast2');
        writeFileSync(ir, encodeEastIR(East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b)).toIR()));

        // `value` holds 10
        const result = await runE3Command(['call', remoteUrl, '-w', wsName, '--ir', ir, '@.inputs.value', '5'], workDir, { env });
        assert.strictEqual(result.exitCode, 0, `Failed: ${result.stderr}`);
        assert.match(result.stdout, /\b15\b/);

        const unscoped = await runE3Command(['call', remoteUrl, '--ir', ir, '2', '3'], workDir, { env });
        assert.notStrictEqual(unscoped.exitCode, 0);
        assert.match(unscoped.stderr, /A call of an IR file through a server is one of a workspace's calls: pass -w <ws>/);

        // A reader runs the call given no platform package, and is refused it
        // loading its runtime's standard package, in the server's words
        const reader = { ...env, ...writeCliCredentials(join(workDir, 'reader-credentials.json'), ctx.config.baseUrl, await ctx.config.getReaderToken(ctx.repoName)) };
        const free = await runE3Command(['call', remoteUrl, '-w', wsName, '--ir', ir, '--platform', 'none', '@.inputs.value', '5'], workDir, { env: reader });
        assert.strictEqual(free.exitCode, 0, `Failed: ${free.stderr}`);
        assert.match(free.stdout, /\b15\b/);
        const denied = await runE3Command(['call', remoteUrl, '-w', wsName, '--ir', ir, '@.inputs.value', '5'], workDir, { env: reader });
        assert.notStrictEqual(denied.exitCode, 0);
        assert.match(denied.stderr, /Permission denied: .*one-shot/);
      });
    });

    describe('mutate command', { concurrency: false }, () => {
      it('names the key of a write the record no longer matches, and says to resubmit rather than retry', async (t) => {
        const ctx = await withCli(t);
        const { remoteUrl, workDir } = ctx;
        const env = getCredentialsEnv();
        const zipPath = await createKeyedRecordPackageZip(ctx.tempDir, 'mutate-cli-pkg', '1.0.0');
        const wsName = `mutate-cli-ws-${Date.now()}`;
        removeAfter(t, remoteUrl, wsName);
        await runE3Command(['package', 'import', remoteUrl, zipPath], workDir, { env });
        await runE3Command(['workspace', 'create', remoteUrl, wsName], workDir, { env });
        await runE3Command(['workspace', 'deploy', remoteUrl, wsName, 'mutate-cli-pkg@1.0.0'], workDir, { env });
        const seeded = await runE3Command(['mutate', remoteUrl, 'plans.seed', '20', '-w', wsName], workDir, { env });
        assert.strictEqual(seeded.exitCode, 0, `seed failed: ${seeded.stderr}`);

        // A delete of a row that is no longer what the patch says it is.
        const stale = join(workDir, 'stale.beast2');
        writeFileSync(stale, encodeBeast2For(PatchType(PlansType))(variant('patch', new SortedMap<string, PlanOp>([
          ['p-11', variant('delete', { status: 'ok', due: 11n, title: 'SOMETHING ELSE' })],
        ], compareFor(StringType)))));
        const result = await runE3Command(['mutate', remoteUrl, 'plans.patch', stale, '-w', wsName], workDir, { env });

        assert.notStrictEqual(result.exitCode, 0);
        assert.match(result.stderr, /p-11/, 'the key that disagreed crosses the API to the caller');
        assert.match(result.stderr, /re-read it and resubmit/);
        assert.doesNotMatch(result.stderr, /try again/, 'the same write would disagree again');
      });
    });

    describe('load command', { concurrency: false }, () => {
      it('R21 — uploads a delivery\'s file as an object, follows its load to its end, and answers the same delivery named by its hash again', async (t) => {
        const ctx = await withCli(t);
        const { remoteUrl, workDir } = ctx;
        const env = getCredentialsEnv();
        const wsName = `load-cli-ws-${Date.now()}`;
        removeAfter(t, remoteUrl, wsName);
        const zipPath = await createCompositeRecordPackageZip(ctx.tempDir, 'load-cli-pkg', '2.0.0');
        for (const command of [
          ['package', 'import', remoteUrl, zipPath], ['workspace', 'create', remoteUrl, wsName], ['workspace', 'deploy', remoteUrl, wsName, 'load-cli-pkg@2.0.0'],
        ]) {
          const setup = await runE3Command(command, workDir, { env });
          assert.strictEqual(setup.exitCode, 0, `${command[0]} ${command[1]} failed: ${setup.stderr}`);
        }

        // The ERP's order book, as a file of it holds it
        const delivery = encodeBeast2For(ErpOrdersType)(new Map([['SO-1001', { customer: 'Acme', qty: 5n }], ['SO-1002', { customer: 'Cedar', qty: 7n }]]));
        const file = join(workDir, 'erp.beast2');
        writeFileSync(file, delivery);
        const loaded = await runE3Command(['load', remoteUrl, 'orders.erp', file, '-w', wsName, '--as-of', '2026-11-02T03:00:00'], workDir, { env });
        assert.strictEqual(loaded.exitCode, 0, `load failed: ${loaded.stderr}`);
        const commit = /^Loaded orders\.erp at ([0-9a-f]{12}), as of 2026-11-02T03:00:00\.000: 2 set, 0 deleted, 0 unchanged$/m.exec(loaded.stdout)?.[1];
        assert.ok(commit !== undefined, `the load's line: ${loaded.stdout}`);

        // The upload stored the file as the object it is: its hash names the same delivery
        const again = await runE3Command(['load', remoteUrl, 'orders.erp', `#${computeHash(delivery)}`, '-w', wsName], workDir, { env });
        assert.strictEqual(again.exitCode, 0, `load by hash failed: ${again.stderr}`);
        assert.match(again.stdout, new RegExp(`^orders\\.erp already holds this delivery, loaded at ${commit}$`, 'm'));
      });
    });
  });
}
