/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Scratch directories of local executions (issue #770): where they are
 * created, how they are named, and which ones a sweep removes.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { executionScratchDir, scratchRoot, sweepScratchDirs } from './scratch.js';
import { getPidStartTime } from './processHelpers.js';
import { deadPid } from '../test-helpers.js';

describe('scratch directories', () => {
  let root: string;
  let previous: string | undefined;
  /** A repository path, which E3_SCRATCH_DIR overrides wherever it is set. */
  let repo: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'e3-scratch-root-'));
    repo = path.join(root, 'repo');
    previous = process.env.E3_SCRATCH_DIR;
    process.env.E3_SCRATCH_DIR = root;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.E3_SCRATCH_DIR;
    else process.env.E3_SCRATCH_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });

  it('are inside the repository, on the object store\'s filesystem, unless E3_SCRATCH_DIR is set', async () => {
    delete process.env.E3_SCRATCH_DIR;
    assert.equal(scratchRoot(repo), path.join(repo, 'tmp', 'scratch'));
    const dir = await executionScratchDir(repo, 'a'.repeat(64), 'b'.repeat(64), '01900000-0000-7000-8000-000000000001');
    assert.equal(path.dirname(dir), path.join(repo, 'tmp', 'scratch'));
  });

  it('names an execution\'s directory under E3_SCRATCH_DIR after the execution attempt and this process', async () => {
    assert.equal(scratchRoot(repo), root);
    const dir = await executionScratchDir(repo, 'a'.repeat(64), 'b'.repeat(64), '01900000-0000-7000-8000-000000000001');
    assert.equal(path.dirname(dir), root);
    const pidStartTime = await getPidStartTime(process.pid);
    assert.equal(path.basename(dir), `e3-exec-aaaaaaaa-bbbbbbbb-${process.pid}-${pidStartTime}-01900000000070008000000000000001`);
  });

  it('gives two attempts at one execution a directory each', async () => {
    // Two mutations of a record over the same state with the same arguments
    // are one execution, and they run at once: in one directory, each would
    // stage its inputs over the other's and remove the directory under it.
    const first = await executionScratchDir(repo, 'a'.repeat(64), 'b'.repeat(64), '01900000-0000-7000-8000-000000000001');
    const second = await executionScratchDir(repo, 'a'.repeat(64), 'b'.repeat(64), '01900000-0000-7000-8000-000000000002');
    assert.notEqual(first, second);
  });

  it('removes the directories of exited owners and keeps the rest', async () => {
    const hour = 60 * 60 * 1000;
    const now = Date.now();
    const dead = deadPid();
    const live = path.basename(await executionScratchDir(repo, 'a'.repeat(64), 'b'.repeat(64), '01900000-0000-7000-8000-000000000001'));
    const names = {
      live,
      exitedOwner: `e3-exec-aaaaaaaa-bbbbbbbb-${dead}-12345-01900000000070008000000000000002`,
      exitedOwnerTimeForm: `e3-exec-aaaaaaaa-bbbbbbbb-${dead}-12345-${now}`,
      reusedPid: `e3-exec-aaaaaaaa-bbbbbbbb-${process.pid}-12345-${now}`,
      oldFormExitedOld: `e3-exec-cccccccc-dddddddd-${dead}-${now - hour}`,
      oldFormExitedYoung: `e3-exec-eeeeeeee-ffffffff-${dead}-${now}`,
      oldFormLive: `e3-exec-11111111-22222222-${process.pid}-${now - hour}`,
      unrelated: `e3-call-${dead}-${now - hour}-abcd`,
    };
    for (const name of Object.values(names)) mkdirSync(path.join(root, name));

    const removed = await sweepScratchDirs(repo, { minAge: 60_000 });

    // Every platform but Windows reports a process's start time. Where none
    // is reported, a pid's existence decides, so there the reused pid — this
    // process, now running — still counts as the owner.
    const startTimes = process.platform !== 'win32';
    assert.equal((await getPidStartTime(process.pid)) !== 0, startTimes, 'this platform reports start times');
    assert.equal(removed, startTimes ? 4 : 3);
    assert.deepEqual(
      readdirSync(root).sort(),
      [names.live, names.oldFormExitedYoung, names.oldFormLive, names.unrelated, ...(startTimes ? [] : [names.reusedPid])].sort(),
    );
    assert.equal(existsSync(path.join(root, names.reusedPid)), !startTimes,
      startTimes ? 'a pid now running with another start time is not the owner' : 'with no start time, a live pid is the owner');
  });

  it('keeps a live owner\'s directory when its recorded start time is unknown', async () => {
    // The writer records 0 where its own platform could not answer (a `ps`
    // that failed, a /proc it could not open). Comparing that against a start
    // time the sweeper CAN resolve says "gone" about an owner that is very
    // much alive — and the sweep would take its staged inputs and its output
    // out from under it. With either side unknown, existence decides.
    const live = path.join(root, `e3-exec-aaaaaaaa-bbbbbbbb-${process.pid}-0-${Date.now()}`);
    mkdirSync(live);
    const dead = path.join(root, `e3-exec-cccccccc-dddddddd-${deadPid()}-0-${Date.now()}`);
    mkdirSync(dead);

    await sweepScratchDirs(repo, { minAge: 0 });

    assert.ok(existsSync(live), 'the live owner\'s directory stays');
    assert.ok(!existsSync(dead), 'the exited owner\'s directory goes');
  });

  it('removes nothing when there is no scratch root', async () => {
    process.env.E3_SCRATCH_DIR = path.join(root, 'absent');
    assert.equal(await sweepScratchDirs(repo, { minAge: 0 }), 0);
  });
});
