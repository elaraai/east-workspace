/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record through a deploy (test-only): what the specs that carry a record
 * from the type an earlier release stored it as share — `studio-migration.spec.ts`
 * and `query-migration.spec.ts`.
 *
 * Each test has a local repository of its own, its workspace on the release a
 * workspace was on; a package is exported, imported and deployed there on a
 * runner, and the plan the deploy made for each record handed back. e3 runs a
 * record's program on the east-c it finds, else on east-node, which this
 * package holds; whichever it finds is held to this checkout's build
 * (`runners.ts`).
 */

import { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import e3 from '@elaraai/e3';
import type { RecordPlan } from '@elaraai/e3-types';
import {
    LocalStorage, LocalTaskRunner, RecordDeployRefusedError, packageImport, recordHistory, repoInit, workspaceCreate, workspaceDeploy, workspaceGetDataset,
} from '@elaraai/e3-core';
import { assertThisTreesRunner, runnerFile } from './runners.js';

/** A package a spec deploys: what `e3.export` takes. */
type Package = Parameters<typeof e3.export>[0];

/** A dataset's path in a workspace. */
type DatasetPath = Parameters<typeof workspaceGetDataset>[3];

/** The workspace each test deploys to. */
const WORKSPACE = 'main';

/** A suite's repositories, and what a test does with the one it has. */
export interface RecordDeploy {
    /** The storage the repositories are in. */
    readonly storage: LocalStorage;
    /** The repository of the test running. */
    readonly repo: () => string;
    /** The workspace a test deploys to. */
    readonly workspace: string;
    /** Exports, imports and deploys a package to the workspace, on the runner; the plan the deploy made for each record. */
    readonly deploy: (pkg: Package) => Promise<RecordPlan[]>;
    /** The names of a record's commits, newest first. */
    readonly history: (record: string) => Promise<string[]>;
    /** A dataset's value in the workspace. */
    readonly read: (path: DatasetPath) => Promise<unknown>;
}

/**
 * Sets a suite up to deploy to a local repository a test: called in the
 * suite's body, it registers the hooks that find the runners, make each test
 * its repository with its workspace on `first`, and clear them away.
 *
 * @param name - What the suite is, in its folders' names: `e3-ui-<name>`
 * @param first - The release a workspace was on, deployed as each test begins
 * @returns The suite's repositories, and what a test does with its own
 */
export function recordDeploy(name: string, first: () => Package): RecordDeploy {
    const storage = new LocalStorage();
    // Where the suite's repositories are made: where e3 looks a runner up from, beside the working directory.
    const repoAt = join(tmpdir(), `e3-ui-${name}`, 'repo');
    let scratch: string | undefined;
    let repo = '';
    let runner: LocalTaskRunner | undefined;
    let made = 0;

    const deploy = async (pkg: Package): Promise<RecordPlan[]> => {
        if (scratch === undefined || runner === undefined) throw new Error('recordDeploy: a package is deployed inside a test');
        const zip = join(scratch, `${pkg.name}-${pkg.version}-${made}.zip`);
        await e3.export(pkg, zip);
        await packageImport(storage, repo, zip);
        const plans: RecordPlan[] = [];
        await workspaceDeploy(storage, repo, WORKSPACE, pkg.name, pkg.version, { runner, onRecordPlan: (plan) => plans.push(plan) });
        return plans;
    };

    before(() => {
        // A record's program runs on the east-c e3 finds, else on east-node: each one it finds is this checkout's.
        const node = runnerFile('east-node', repoAt);
        if (node === null) assert.fail('e3 finds no east-node, which this package\'s node_modules/.bin holds: run the spec from the package');
        assertThisTreesRunner('east-node', node, repoAt);
        const c = runnerFile('east-c', repoAt);
        if (c !== null) assertThisTreesRunner('east-c', c, repoAt);
        scratch = mkdtempSync(join(tmpdir(), `e3-ui-${name}-`));
    });

    after(() => {
        if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
    });

    beforeEach(async () => {
        if (scratch === undefined) throw new Error('recordDeploy: the suite\'s folder was not made');
        repo = join(scratch, `repo-${made++}`);
        mkdirSync(repo);
        repoInit(repo);
        runner = new LocalTaskRunner(repo);
        await workspaceCreate(storage, repo, WORKSPACE);
        await deploy(first());
    });

    return {
        storage,
        repo: () => repo,
        workspace: WORKSPACE,
        deploy,
        history: async (record) => (await recordHistory(storage, repo, WORKSPACE, record)).map((entry) => entry.commit.mutation),
        read: (path) => workspaceGetDataset(storage, repo, WORKSPACE, path),
    };
}

/**
 * A record at a new type, deployed without its migration step: the deploy is
 * refused, naming what changed and what to declare, and the workspace keeps
 * what it held.
 *
 * @param suite - The suite's repositories
 * @param pkg - The release, its record at the new type and its step left out
 * @param record - The record's name, as the package declares it
 */
export async function assertRefusedWithoutStep(suite: RecordDeploy, pkg: Package, record: string): Promise<void> {
    const held = await suite.history(record);
    await assert.rejects(suite.deploy(pkg), (err: unknown) => {
        assert.ok(err instanceof RecordDeployRefusedError);
        assert.ok(err.message.includes(`record 'records/${record}' changed type with no migration`), err.message);
        assert.match(err.message, /Declare a migration for it/);
        return true;
    });
    assert.deepEqual(await suite.history(record), held, 'nothing was written');
}
