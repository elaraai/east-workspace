/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A local runner's intake: which runner takes a delivery in, what it stores,
 * and what happens when a runner refuses the delivery, cannot run the unit, or
 * is not there.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ArrayType, IntegerType, StringType, StructType, encodeBeast2PagedFor, toEastTypeValue } from '@elaraai/east';
import { DatasetSegments } from '../dataset-open.js';
import { DeliveryRefusedError } from '../errors.js';
import { datasetWrite } from '../trees.js';
import { createTempDir, createTestRepo, encodeInSegmentsOf, removeTempDir, removeTestRepo } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { INTAKE_CANDIDATES, runIntake, type IntakeCandidate } from './intake.js';

const TableType = ArrayType(StructType({ id: IntegerType, name: StringType }));
const rows = (n: number): { id: bigint; name: string }[] => Array.from({ length: n }, (_, i) => ({ id: BigInt(i), name: `row-${i}` }));

describe('a local intake', () => {
  let repo: string;
  let dir: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    dir = createTempDir();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(dir);
  });

  /** A delivery on disk. */
  const deliver = (name: string, bytes: Uint8Array): string => {
    const file = join(dir, name);
    writeFileSync(file, bytes);
    return file;
  };

  it('takes a delivery in on the first runner it finds, as the manifest the Writer writes', async () => {
    const file = deliver('table.beast2', encodeBeast2PagedFor(TableType)(rows(3_000)));
    const taken = await runIntake(storage, repo, { source: { file }, type: toEastTypeValue(TableType) }, {}, new Map());
    assert.ok(['east-c', 'east-node'].includes(taken.runner), `taken in by ${taken.runner}`);
    assert.equal(taken.hash, await datasetWrite(storage, repo, rows(3_000), TableType));
    assert.ok(taken.peakBytes !== undefined && taken.peakBytes > 0, 'the runner reports its peak');
  });

  it('takes a run of segments in, and a delivery the store holds whole', async () => {
    const bytes = encodeInSegmentsOf(TableType, 8)(rows(40));
    const piece = await runIntake(storage, repo, { source: { file: deliver('table.beast2', bytes) }, type: toEastTypeValue(TableType), segments: { from: 1, to: 3 } }, {}, new Map());
    assert.equal(piece.hash, await datasetWrite(storage, repo, rows(40).slice(8, 24), TableType), 'segments 1 and 2: rows 8 to 23');

    const object = await storage.objects.write(repo, bytes);
    const whole = await runIntake(storage, repo, { source: { object }, type: toEastTypeValue(TableType) }, {}, new Map());
    assert.equal(whole.hash, await datasetWrite(storage, repo, rows(40), TableType));
    assert.equal((await DatasetSegments.open(storage, repo, whole.hash)).elementCount, 40);
  });

  it("refuses what the runner refuses, in the runner's words, and tries no other", async () => {
    const file = deliver('junk.beast2', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const unusable = new Map<string, string>();
    let refusedBy = '';
    await assert.rejects(
      runIntake(storage, repo, { source: { file }, type: toEastTypeValue(TableType) }, {}, unusable),
      (err: unknown) => {
        assert.ok(err instanceof DeliveryRefusedError, String(err));
        assert.equal(err.refusal, 'intake: the delivery is not a beast2 blob of version 4 or 5');
        assert.equal(err.message, `${err.runner} refused the delivery: ${err.refusal}`);
        refusedBy = err.runner;
        return true;
      },
    );
    assert.equal(unusable.has(refusedBy), false, 'a refusal is the delivery\'s, not the runner\'s');
  });

  it('falls back to the next runner when one cannot run the unit at all, saying why, and does not try it again',
    { skip: process.platform === 'win32' ? 'the stand-in east-c is a shell script' : false }, async () => {
      // An east-c from before the intake unit: it knows no `exec`.
      const ran = join(dir, 'stale-east-c.ran');
      const stale = join(dir, 'stale-east-c');
      writeFileSync(stale, `#!/bin/sh\necho ran >> '${ran}'\necho "Unknown command: exec" >&2\nexit 2\n`);
      chmodSync(stale, 0o755);
      const candidates: IntakeCandidate[] = [{ runner: INTAKE_CANDIDATES[0]!.runner, command: stale }, INTAKE_CANDIDATES[1]!];
      const unusable = new Map<string, string>();
      const spec = { source: { file: deliver('table.beast2', encodeBeast2PagedFor(TableType)(rows(100))) }, type: toEastTypeValue(TableType) };

      const first = await runIntake(storage, repo, spec, {}, unusable, candidates);
      assert.equal(first.runner, 'east-node');
      assert.equal(first.fallback, `${stale} exited 2 without recording a result for the intake unit (Unknown command: exec)`);
      assert.equal(first.hash, await datasetWrite(storage, repo, rows(100), TableType));

      const second = await runIntake(storage, repo, spec, {}, unusable, candidates);
      assert.equal(second.runner, 'east-node');
      assert.equal(second.fallback, first.fallback, 'each intake says why');
      assert.equal(readFileSync(ran, 'utf8'), 'ran\n', 'the runner that could not run the unit is not tried again');
    });

  it('says what to add when it finds no runner', async () => {
    const candidates: IntakeCandidate[] = [
      { runner: INTAKE_CANDIDATES[0]!.runner, command: 'e3-test-no-such-east-c' },
      { runner: INTAKE_CANDIDATES[1]!.runner, command: 'e3-test-no-such-east-node' },
    ];
    const file = deliver('table.beast2', encodeBeast2PagedFor(TableType)(rows(10)));
    await assert.rejects(
      runIntake(storage, repo, { source: { file }, type: toEastTypeValue(TableType) }, {}, new Map(), candidates),
      /^Error: e3 found no runner to take the delivery in: add @elaraai\/east-node-cli \(or east-c\) to the project$/,
    );
  });
});
