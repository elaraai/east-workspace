/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 history --delta` over an Apply (#988): an editable collection's batch,
 * committed to a keyed record through its patch door, is ONE commit, and
 * `--delta` counts what it inserted, updated and deleted. A second writer's
 * Apply drafted on the same state is refused, and commits nothing.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import {
  DictType, IntegerType, PatchType, SortedMap, StringType, StructType, compareFor, diffFor, encodeBeast2For, variant,
  type PatchTypeOf, type ValueTypeOf,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import { LocalStorage, recordHistory, recordMutate, packageImport, workspaceCreate, workspaceDeploy, workspaceGetDataset } from '@elaraai/e3-core';
import type { TaskRunner } from '@elaraai/e3-core';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from '@elaraai/e3-core/test';
import { historyCommand } from './history.js';

const JobType = StructType({ task: StringType, qty: IntegerType });
const JobsType = DictType(StringType, JobType);
type Job = ValueTypeOf<typeof JobType>;
/** What one touched key of a jobs patch carries — derived from the patch type. */
type JobOp = Extract<ValueTypeOf<PatchTypeOf<typeof JobsType>>, { type: 'patch' }>['value'] extends Map<string, infer Op>
  ? Op : never;

const keys = compareFor(StringType);
const encodePatch = encodeBeast2For(PatchType(JobsType));
/** A job's entry patch, as the Apply sends its update. */
const diffJob = diffFor(JobType);
const CUT: Job = { task: 'Cut', qty: 2n };
const WELD: Job = { task: 'Weld', qty: 1n };
const jobsPath = [variant('field', 'records'), variant('field', 'jobs')];

/** The patch door of a record with no index runs no program, so nothing may start one. */
const noProgram = { execute: async () => { throw new Error('the patch door ran a program'); } } as unknown as TaskRunner;

describe('historyCommand', () => {
  let repo: string;
  let tempDir: string;
  let storage: LocalStorage;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));

    const jobs = e3.record('jobs', JobsType, new SortedMap([['a', CUT], ['b', WELD]], keys));
    const pkg = e3.package('jobs', '1.0.0', jobs, e3.mutation.patch(jobs));
    const zip = join(tempDir, 'jobs.zip');
    await e3.export(pkg, zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'main');
    await workspaceDeploy(storage, repo, 'main', 'jobs', '1.0.0');
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** What `e3 history` prints. */
  async function printed(options: { limit?: string; delta?: boolean }): Promise<string> {
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    try {
      await historyCommand(repo, 'jobs', { workspace: 'main', ...options });
    } finally {
      console.log = origLog;
    }
    return lines.join('\n');
  }

  it('an Apply is one commit, and --delta counts what it inserted, updated and deleted', async () => {
    const apply = variant('patch', new SortedMap<string, JobOp>([
      ['a', variant('update', diffJob(CUT, { task: 'Cut', qty: 3n })) as JobOp],
      ['b', variant('delete', WELD)],
      ['c', variant('insert', { task: 'Paint', qty: 4n })],
    ], keys));
    const result = await recordMutate(storage, noProgram, repo, 'main', 'jobs', 'patch', [encodePatch(apply)], { actor: 'planner' });
    assert.equal(result.kind, 'committed');

    const history = await recordHistory(storage, repo, 'main', 'jobs');
    assert.equal(history.length, 2, 'the deploy\'s commit, and the Apply\'s one');
    assert.equal(history[0]!.commit.mutation, 'patch');
    assert.equal(history[0]!.commit.actor, 'planner');

    const out = await printed({ limit: '1', delta: true });
    assert.match(out, /^[0-9a-f]{12} {2}patch\s+planner\s+\d{4}-\d{2}-\d{2}T/);
    assert.match(out, /primary\s+\+1 {2}~1 {2}-1/);
  });

  it('a second writer\'s Apply drafted on the same state is refused, and commits nothing', async () => {
    const first = await recordMutate(storage, noProgram, repo, 'main', 'jobs', 'patch',
      [encodePatch(variant('patch', new SortedMap<string, JobOp>([['a', variant('update', diffJob(CUT, { task: 'Cut', qty: 3n })) as JobOp]], keys)))], { actor: 'first' });
    assert.equal(first.kind, 'committed');

    const second = await recordMutate(storage, noProgram, repo, 'main', 'jobs', 'patch',
      [encodePatch(variant('patch', new SortedMap<string, JobOp>([['a', variant('update', diffJob(CUT, { task: 'Cut', qty: 5n })) as JobOp]], keys)))], { actor: 'second' });
    assert.equal(second.kind, 'conflict');

    const history = await recordHistory(storage, repo, 'main', 'jobs');
    assert.deepEqual(history.map(e => e.commit.actor).slice(0, 1), ['first'], 'the refused write made no commit');
    const jobs = await workspaceGetDataset(storage, repo, 'main', jobsPath) as Map<string, Job>;
    assert.deepEqual(jobs.get('a'), { task: 'Cut', qty: 3n }, 'the first write stands');
  });
});
