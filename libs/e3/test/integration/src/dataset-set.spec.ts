/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 dataset set` at the boundary, through the CLI against a real repository.
 *
 * - The declared type is checked at the door, from the file's header, before
 *   anything is read whole or written (#766).
 * - A `.beast2` delivery is adopted by hash — by `--from-file`, and by a
 *   `variant('file', path)` source at deploy — and reports the geometry its
 *   index carries (#765).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import e3 from '@elaraai/e3';
import {
  ArrayType,
  EastTypeType,
  FloatType,
  IntegerType,
  StringType,
  StructType,
  encodeBeast2PagedFor,
  printFor,
  readBeast2Extents,
  toEastTypeValue,
  variant,
} from '@elaraai/east';
import { createTestDir, removeTestDir, runE3Command } from './helpers.js';

const Row = StructType({ id: IntegerType, name: StringType, score: FloatType });
/** The same table after its schema drifted: `score` is gone. */
const DriftedRow = StructType({ id: IntegerType, name: StringType });

const ROW_COUNT = 2000;

/** Every file under the repository's object store. */
function countObjects(repoDir: string): number {
  let count = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else count++;
    }
  };
  walk(join(repoDir, 'objects'));
  return count;
}

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('e3 dataset set', () => {
  let testDir: string;
  let repoDir: string;
  /** The table as delivered, carrying the declared type, in several segments. */
  let goodPath: string;
  /** The same rows under the drifted type. */
  let driftedPath: string;
  /** Only the drifted file's header — decoding it whole fails, reading its type does not. */
  let driftedHeaderPath: string;
  let segmentCount: number;

  beforeEach(() => {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    repoDir = join(testDir, 'repo');

    const rows = Array.from({ length: ROW_COUNT }, (_, i) => ({ id: BigInt(i), name: `row-${i}`, score: i / 7 }));
    const good = encodeBeast2PagedFor(ArrayType(Row), { targetSegmentBytes: 4096 })(rows);
    goodPath = join(testDir, 'TABLE.beast2');
    writeFileSync(goodPath, good);
    segmentCount = readBeast2Extents(good).offsets.length;
    assert.ok(segmentCount > 1, 'the delivery spans several segments');

    const drifted = encodeBeast2PagedFor(ArrayType(DriftedRow), { targetSegmentBytes: 4096 })(
      rows.map(({ id, name }) => ({ id, name }))
    );
    driftedPath = join(testDir, 'TABLE-drifted.beast2');
    writeFileSync(driftedPath, drifted);
    driftedHeaderPath = join(testDir, 'TABLE-drifted-header.beast2');
    writeFileSync(driftedHeaderPath, drifted.subarray(0, readBeast2Extents(drifted).offsets[0]));
  });

  afterEach(() => {
    removeTestDir(testDir);
  });

  /** A workspace `ws` whose package declares `table: Array<Row>`, unset. */
  async function deployTable(): Promise<void> {
    const table = e3.input('table', ArrayType(Row));
    const zip = join(testDir, 'table.zip');
    await e3.export(e3.package('table-set', '1.0.0', table), zip);
    for (const args of [
      ['repo', 'create', repoDir],
      ['package', 'import', repoDir, zip],
      ['workspace', 'create', repoDir, 'ws'],
      ['workspace', 'deploy', repoDir, 'ws', 'table-set@1.0.0'],
    ]) {
      const result = await runE3Command(args, testDir);
      assert.strictEqual(result.exitCode, 0, `${args.slice(0, 2).join(' ')} failed: ${result.stderr}`);
    }
  }

  describe('a file argument is checked against the declared type', () => {
    it('refuses a drifted file, naming the dataset and the first difference, before writing', async () => {
      await deployTable();
      const before = countObjects(repoDir);

      const result = await runE3Command(['dataset', 'set', repoDir, 'ws.table', driftedPath], testDir);

      assert.notStrictEqual(result.exitCode, 0, 'a drifted file is refused');
      assert.match(result.stderr, /dataset '\.inputs\.table' declares \.Array/);
      assert.match(result.stderr, /first difference at .*score/);
      assert.strictEqual(countObjects(repoDir), before, 'nothing is written');
    });

    it('decides from the header alone — a file that is only a drifted header is refused the same way', async () => {
      await deployTable();

      const result = await runE3Command(['dataset', 'set', repoDir, 'ws.table', driftedHeaderPath], testDir);

      // A whole-file decode of this file would fail on its missing segments;
      // the type mismatch is reported instead, so the header was all that was read.
      assert.notStrictEqual(result.exitCode, 0);
      assert.match(result.stderr, /dataset '\.inputs\.table' declares \.Array/);
      assert.match(result.stderr, /first difference at .*score/);
    });

    it('accepts the same table carrying the declared type', async () => {
      await deployTable();

      const result = await runE3Command(['dataset', 'set', repoDir, 'ws.table', goodPath], testDir);
      assert.strictEqual(result.exitCode, 0, `set failed: ${result.stderr}`);

      const status = await runE3Command(['dataset', 'status', repoDir, 'ws.table'], testDir);
      assert.strictEqual(status.exitCode, 0, `status failed: ${status.stderr}`);
      assert.match(status.stdout, /Status: set/);
      assert.match(status.stdout, new RegExp(`Rows: +${ROW_COUNT}\\b`));
    });

    it('checks --type on a .beast2 file instead of letting it override the header', async () => {
      await deployTable();
      const before = countObjects(repoDir);
      const typeSpec = printFor(EastTypeType)(toEastTypeValue(ArrayType(DriftedRow)));

      const result = await runE3Command(
        ['dataset', 'set', repoDir, 'ws.table', goodPath, '--type', typeSpec],
        testDir
      );

      assert.notStrictEqual(result.exitCode, 0, 'an overriding --type is refused');
      assert.match(result.stderr, /--type declares \.Array/);
      assert.strictEqual(countObjects(repoDir), before, 'nothing is written');
    });
  });

  describe('--from-file adopts a delivery by hash', () => {
    it('points the dataset at the file by hash, reports its geometry, and leaves the file untouched', async () => {
      await deployTable();
      const hash = sha256Of(goodPath);
      const delivered = statSync(goodPath);

      const result = await runE3Command(['dataset', 'set', repoDir, 'ws.table', '--from-file', goodPath], testDir);
      assert.strictEqual(result.exitCode, 0, `set --from-file failed: ${result.stderr}`);
      assert.match(result.stdout, new RegExp(`Hash: +${hash}`));
      assert.match(result.stdout, new RegExp(`Segments: ${segmentCount}\\b`));
      assert.match(result.stdout, new RegExp(`Rows: +${ROW_COUNT}\\b`));

      // The object IS the delivery's bytes, under the delivery's hash.
      const object = join(repoDir, 'objects', hash.slice(0, 2), `${hash.slice(2)}.beast2`);
      assert.ok(Buffer.from(readFileSync(object)).equals(readFileSync(goodPath)), 'the object holds the delivery');
      const after = statSync(goodPath);
      assert.strictEqual(after.mtimeMs, delivered.mtimeMs, 'the delivery is not modified');
      assert.strictEqual(after.mode, delivered.mode, "the delivery's mode is unchanged");

      const status = await runE3Command(['dataset', 'status', repoDir, 'ws.table'], testDir);
      assert.strictEqual(status.exitCode, 0, `status failed: ${status.stderr}`);
      assert.match(status.stdout, new RegExp(`Hash: +${hash}`));
      assert.match(status.stdout, new RegExp(`Segments: ${segmentCount}\\b`));
      assert.match(status.stdout, new RegExp(`Rows: +${ROW_COUNT}\\b`));
    });

    it('refuses a drifted delivery with the same message, writing nothing', async () => {
      await deployTable();
      const before = countObjects(repoDir);

      const result = await runE3Command(['dataset', 'set', repoDir, 'ws.table', '--from-file', driftedPath], testDir);

      assert.notStrictEqual(result.exitCode, 0, 'a drifted delivery is refused');
      assert.match(result.stderr, /^Error: dataset '\.inputs\.table' declares \.Array/m);
      assert.match(result.stderr, /first difference at .*score/);
      assert.strictEqual(countObjects(repoDir), before, 'nothing is written');
    });
  });

  describe('a file source', () => {
    it('is adopted at deploy, so the input is set with the file hash and geometry', async () => {
      const table = e3.input('table', ArrayType(Row), variant('file', goodPath));
      const zip = join(testDir, 'sourced.zip');
      await e3.export(e3.package('sourced', '1.0.0', table), zip);
      for (const args of [
        ['repo', 'create', repoDir],
        ['package', 'import', repoDir, zip],
        ['workspace', 'create', repoDir, 'ws'],
        ['workspace', 'deploy', repoDir, 'ws', 'sourced@1.0.0'],
      ]) {
        const result = await runE3Command(args, testDir);
        assert.strictEqual(result.exitCode, 0, `${args.slice(0, 2).join(' ')} failed: ${result.stderr}`);
      }

      const status = await runE3Command(['dataset', 'status', repoDir, 'ws.table'], testDir);
      assert.strictEqual(status.exitCode, 0, `status failed: ${status.stderr}`);
      assert.match(status.stdout, /Status: set/);
      assert.match(status.stdout, new RegExp(`Hash: +${sha256Of(goodPath)}`));
      assert.match(status.stdout, new RegExp(`Segments: ${segmentCount}\\b`));
      assert.match(status.stdout, new RegExp(`Rows: +${ROW_COUNT}\\b`));
    });
  });
});
