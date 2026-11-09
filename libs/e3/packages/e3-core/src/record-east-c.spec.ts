/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A record's programs on east-c (east-workspace#1573).
 *
 * A record's mutations and indexes declared with no runner run on east-c,
 * naming no platform: their programs call none, so every runtime runs them
 * alike, and east-c starts in milliseconds. Where the east-c a local runner
 * finds cannot run — none is found, or its launcher has no native binary to
 * start — the runner runs them on east-node, as it runs an intake, and the
 * program's log says so on the run that found it. A task's program runs where
 * its author said, east-c or none.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DictType, East, IntegerType, PatchType, SortedMap, StringType, StructType, compareFor, diffFor, encodeBeast2For, equalFor, variant,
  type ValueTypeOf,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import { RunnerType, decodeMutationObject, decodeRecordIndexObject, type RunnerValue } from '@elaraai/e3-types';
import { recordMutate, resolveRecord } from './records.js';
import { packageImport } from './package-files.js';
import { packageRead } from './packages.js';
import { datasetWrite } from './trees.js';
import { workspaceCreate } from './workspaces.js';
import { workspaceDeploy } from './workspace-files.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir, withLogStore } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import type { LogStore, StorageBackend } from './index.js';

const Row = StructType({ owner: StringType, score: IntegerType });
const RowsType = DictType(StringType, Row);
type Rows = ValueTypeOf<typeof RowsType>;
const keyOrder = compareFor(StringType);

/** East-c naming no platform, reading its inputs lazily: what a record's
 *  programs run on when they name no runner. */
const EAST_C: RunnerValue = variant('east_c', { platforms: [], decode: variant('lazy', null) });
const sameRunner = equalFor(RunnerType);

/** What the log says of a run whose east-c could not run. */
const FELL_BACK = 'without recording a result for the unit, so it runs on east-node';

/** A record with an index and a patch door, neither naming a runner: a patch
 *  runs the program that maintains the index. */
const rows = e3.record('rows', RowsType, {
  initial: new Map(),
  indexes: (index) => ({ rows_by_owner: index.on(['owner']) }),
  mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The rows after the `n`th write: `n` rows, each its owner's. */
function rowsAfter(n: number): Rows {
  const held = new SortedMap<string, ValueTypeOf<typeof Row>>(undefined, keyOrder);
  for (let i = 0; i < n; i++) held.set(`r-${i}`, { owner: `o-${i % 3}`, score: BigInt(i) });
  return held;
}

/** A log store that keeps every append's text, beside writing it. */
function keeping(inner: LogStore, kept: string[]): LogStore {
  return {
    append: async (...args) => {
      kept.push(args[5]);
      return inner.append(...args);
    },
    read: (...args) => inner.read(...args),
    flush: (...args) => inner.flush(...args),
    remove: (...args) => inner.remove(...args),
  };
}

describe('a record\'s programs on east-c', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** Deploys the record to workspace `ws` through `on`, its index built on `runner`. */
  async function deploy(on: StorageBackend, runner: LocalTaskRunner, ws: string): Promise<void> {
    const zip = join(tempDir, 'rows.zip');
    await e3.export(e3.package('rows', '1.0.0', rows), zip);
    await packageImport(on, repo, zip);
    await workspaceCreate(on, repo, ws);
    await workspaceDeploy(on, repo, ws, 'rows', '1.0.0', { runner });
  }

  /** Writes the rows after the `n`th write through the patch door, from those after the one before. */
  async function write(on: StorageBackend, runner: LocalTaskRunner, ws: string, n: number): Promise<void> {
    const patch = diffFor(RowsType)(rowsAfter(n - 1), rowsAfter(n));
    const outcome = await recordMutate(on, runner, repo, ws, 'rows', 'patch',
      [encodeBeast2For(PatchType(RowsType))(patch)], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed', JSON.stringify(outcome));
  }

  /**
   * A project whose runners e3 finds before any other — its runners are
   * searched for from its directory, where it puts them first — and runs
   * `body` in it: east-node, and an east-c launcher that finds no native
   * binary to start, as one whose platform's package was not installed does,
   * so no east-c runs whatever this machine has installed.
   */
  async function inProjectWithoutEastC(body: () => Promise<void>): Promise<void> {
    const project = join(tempDir, 'project');
    const bin = join(project, 'node_modules', '.bin');
    mkdirSync(bin, { recursive: true });
    const eastNode = join(dirname(fileURLToPath(import.meta.resolve('@elaraai/east-node-cli'))), '..', 'bin', 'east-node.mjs');
    writeFileSync(join(bin, 'east-node'), `#!/bin/sh\nexec node ${JSON.stringify(eastNode)} "$@"\n`, { mode: 0o755 });
    writeFileSync(join(bin, 'east-c'), '#!/bin/sh\necho "east-c: the native binary for this platform is not installed" >&2\nexit 1\n', { mode: 0o755 });
    const cwd = process.cwd();
    process.chdir(project);
    try {
      await body();
    } finally {
      process.chdir(cwd);
    }
  }

  it('declares its mutations and its indexes on east-c, naming no platform, when they name no runner', async () => {
    await deploy(storage, new LocalTaskRunner(repo), 'main');
    const resolved = await resolveRecord(storage, repo, 'main', 'rows');
    assert.ok(resolved !== null);
    const mutation = decodeMutationObject(await storage.objects.read(repo, resolved.mutations.get('patch')!));
    const index = decodeRecordIndexObject(await storage.objects.read(repo, resolved.indexes.get('rows_by_owner')!));
    assert.ok(sameRunner(mutation.runner, EAST_C), 'the mutation runs on east-c, naming no platform');
    assert.ok(sameRunner(index.runner, EAST_C), 'and so does the index');
  });

  it('runs them on east-node where its east-c cannot run, its log saying why once', {
    skip: process.platform === 'win32' ? 'the runners here are POSIX shell scripts' : false,
  }, async () => {
    const kept: string[] = [];
    const logged = withLogStore(storage, keeping(storage.logs, kept));
    await inProjectWithoutEastC(async () => {
      // Every run goes through the store whose logs are kept: the first whose
      // east-c could not run — the deploy's index build, or the first write —
      // says so, and none after it.
      const runner = new LocalTaskRunner(repo);
      await deploy(logged, runner, 'main');
      await write(logged, runner, 'main', 4);
      await write(logged, runner, 'main', 7);
    });
    const said = kept.filter((text) => text.includes(FELL_BACK));
    assert.strictEqual(said.length, 1, `the runs whose east-c could not run said so once: ${JSON.stringify(said)}`);
    assert.match(said[0]!, /^e3: east-c exited 1 without recording a result for the unit/);
  });

  it('runs a task\'s program on the east-c its author named, with no east-node in its place', {
    skip: process.platform === 'win32' ? 'the runners here are POSIX shell scripts' : false,
  }, async () => {
    const n = e3.input('n', IntegerType);
    const next = e3.task('next', [n], East.function([IntegerType], IntegerType, ($, n) => n.add(1n)), { runner: { runtime: 'east-c' } });
    const zip = join(tempDir, 'next.zip');
    await e3.export(e3.package('next', '1.0.0', next), zip);
    await packageImport(storage, repo, zip);
    const taskHash = (await packageRead(storage, repo, 'next', '1.0.0')).tasks.get('next')!;
    const input = await datasetWrite(storage, repo, 1n, IntegerType);
    await inProjectWithoutEastC(async () => {
      const runner = new LocalTaskRunner(repo);
      const result = await runner.execute(storage, taskHash, [input]);
      assert.strictEqual(result.state, 'failed', JSON.stringify(result));
      // Let run anywhere, as a record's program is, it runs on east-node
      const anywhere = await runner.execute(storage, taskHash, [input], { anyRuntime: true });
      assert.strictEqual(anywhere.state, 'success', JSON.stringify(anywhere));
      assert.strictEqual(anywhere.outputHash, await datasetWrite(storage, repo, 2n, IntegerType), 'what east-c would have written');
    });
  });
});
