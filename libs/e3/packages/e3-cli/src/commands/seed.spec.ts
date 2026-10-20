/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 seed` adapter: against a local repo it resolves a record declared with
 * no initial value, takes the file in, commits it as the record's `$init` and
 * reports it; a record that holds a state, a file of another type, an unknown
 * record or a missing --workspace exits non-zero, writing nothing.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { East, IntegerType, StringType, encodeBeast2For, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { LocalStorage, recordHistory, packageImport, workspaceCreate, workspaceDeploy, workspaceGetDataset } from '@elaraai/e3-core';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from '@elaraai/e3-core/test';
import { seedCommand } from './seed.js';

const encodeInt = encodeBeast2For(IntegerType);
const counterPath = [variant('field', 'records'), variant('field', 'counter')];

/** Run `fn` with process.exit stubbed to throw (so exitError surfaces as a
 *  rejection instead of killing the test runner) and console.error silenced. */
async function withExitStub(fn: () => Promise<void>): Promise<void> {
  const origExit = process.exit;
  const origErr = console.error;
  process.exit = ((code?: number) => { throw new Error(`exit ${code ?? 0}`); }) as never;
  console.error = () => {};
  try {
    await fn();
  } finally {
    process.exit = origExit;
    console.error = origErr;
  }
}

/** Run `fn` with console.log captured. */
async function captured(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = origLog;
  }
  return lines.join('\n');
}

describe('seedCommand', () => {
  let repo: string;
  let tempDir: string;
  let storage: LocalStorage;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));

    // A record declared with no initial value: unassigned until seeded
    const counter = e3.record('counter', IntegerType);
    const increment = e3.mutation.reduce(
      'increment', counter,
      East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by)),
    );
    const pkg = e3.package('counters', '1.0.0', counter, increment);
    const zip = join(tempDir, 'counters.zip');
    await e3.export(pkg, zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'main');
    await workspaceDeploy(storage, repo, 'main', 'counters', '1.0.0');
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  it("commits a local record's first state from a beast2 file, as its $init, and refuses a second", async () => {
    assert.deepEqual(await recordHistory(storage, repo, 'main', 'counter'), [], 'unassigned after the deploy');
    const file = join(tempDir, 'five.beast2');
    writeFileSync(file, encodeInt(5n));

    const output = await captured(() => seedCommand(repo, 'counter', file, { workspace: 'main' }));

    assert.match(output, /Seeded 'counter' from .*five\.beast2/);
    const history = await recordHistory(storage, repo, 'main', 'counter');
    assert.equal(history.length, 1);
    assert.equal(history[0]!.commit.mutation, '$init');
    assert.match(history[0]!.commit.actor, /^cli:/);
    assert.equal(await workspaceGetDataset(storage, repo, 'main', counterPath), 5n);

    // A record that holds a state takes no second first state
    await assert.rejects(withExitStub(() => seedCommand(repo, 'counter', file, { workspace: 'main' })));
    assert.equal((await recordHistory(storage, repo, 'main', 'counter')).length, 1);
  });

  it('refuses a file of another type, writing nothing', async () => {
    const file = join(tempDir, 'text.beast2');
    writeFileSync(file, encodeBeast2For(StringType)('five'));
    await assert.rejects(withExitStub(() => seedCommand(repo, 'counter', file, { workspace: 'main' })));
    assert.deepEqual(await recordHistory(storage, repo, 'main', 'counter'), []);
  });

  it('exits non-zero for an unknown record, and when --workspace is omitted', async () => {
    const file = join(tempDir, 'five.beast2');
    writeFileSync(file, encodeInt(5n));
    await assert.rejects(withExitStub(() => seedCommand(repo, 'ghost', file, { workspace: 'main' })));
    await assert.rejects(withExitStub(() => seedCommand(repo, 'counter', file, {})));
    assert.deepEqual(await recordHistory(storage, repo, 'main', 'counter'), []);
  });
});
