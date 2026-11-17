/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 dataset get`: the formats it takes, and `-f beast2`, which writes a
 * value as it is stored — a collection's segments spliced, any other value's
 * stored bytes — decoding nothing. That case runs the built command, since
 * the bytes it writes are its standard output.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DictType, IntegerType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  LocalStorage, LocalTaskRunner, packageImport, readDatasetWhole, workspaceCreate, workspaceDeploy, workspaceGetDatasetHash, workspaceSetDataset,
} from '@elaraai/e3-core';
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo } from '@elaraai/e3-core/test';
import { parseGetFormat } from './get.js';

describe('parseGetFormat', () => {
  it('defaults to east when value is undefined', () => {
    assert.strictEqual(parseGetFormat(undefined), 'east');
  });

  it('accepts east', () => {
    assert.strictEqual(parseGetFormat('east'), 'east');
  });

  it('accepts json', () => {
    assert.strictEqual(parseGetFormat('json'), 'json');
  });

  it('accepts beast2', () => {
    assert.strictEqual(parseGetFormat('beast2'), 'beast2');
  });

  it('throws on unknown format, naming the supported set', () => {
    assert.throws(() => parseGetFormat('xml'), /Unknown format: 'xml'.*east, json, beast2/);
  });

  it('throws on empty string', () => {
    assert.throws(() => parseGetFormat(''), /Unknown format: ''/);
  });
});

const CountsType = DictType(StringType, IntegerType);
/** The built command, beside this spec's directory. */
const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));

describe('e3 dataset get -f beast2', () => {
  let repo: string;
  let dir: string;
  let storage: LocalStorage;
  // A collection of several segments
  const counts = new SortedMap<string, bigint>(
    Array.from({ length: 5_000 }, (_, i): [string, bigint] => [`k${String(i).padStart(5, '0')}`, BigInt(i)]), compareFor(StringType));

  before(async () => {
    repo = createTestRepo();
    dir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    // The collection is delivered as a file, which the deploy takes in
    const delivery = join(dir, 'counts.beast2');
    writeFileSync(delivery, encodeBeast2For(CountsType)(counts));
    const pkg = e3.package('counts', '1.0.0',
      e3.input('counts', CountsType, variant('file', delivery)), e3.input('total', IntegerType, variant('value', 7n)));
    await e3.export(pkg, join(dir, 'counts.zip'));
    await packageImport(storage, repo, join(dir, 'counts.zip'));
    await workspaceCreate(storage, repo, 'main');
    await workspaceDeploy(storage, repo, 'main', 'counts', '1.0.0', { runner: new LocalTaskRunner(repo) });
  });

  after(() => {
    removeTestRepo(repo);
    removeTempDir(dir);
  });

  /** The bytes `e3 dataset get -f beast2` writes for an input of `main`. */
  const written = (input: string): Uint8Array => {
    const run = spawnSync(process.execPath, [CLI, 'dataset', 'get', repo, `main.${input}`, '-f', 'beast2'], { maxBuffer: 64 * 1024 * 1024 });
    assert.equal(run.status, 0, run.stderr.toString());
    return new Uint8Array(run.stdout);
  };
  /** The hash an input of a workspace holds. */
  const held = async (input: string, ws = 'main'): Promise<string> => {
    const { hash } = await workspaceGetDatasetHash(storage, repo, ws, [variant('field', 'inputs'), variant('field', input)]);
    assert.ok(hash !== null);
    return hash;
  };

  it('R71 — writes a collection as it is stored, its segments spliced, and any other value as its stored bytes', async () => {
    const bytes = written('counts');
    assert.deepEqual(bytes, await readDatasetWhole(storage, repo, await held('counts')), 'the collection as it is stored');
    assert.ok(equalFor(CountsType)(decodeBeast2For(CountsType)(bytes), counts), 'and its value');
    assert.deepEqual(written('total'), new Uint8Array(await storage.objects.read(repo, await held('total'))), 'any other value: its stored bytes');
  });

  it('R71 — writes a file that loads into another workspace as the same stored value', async () => {
    const file = join(dir, 'counts-written.beast2');
    writeFileSync(file, written('counts'));
    await workspaceCreate(storage, repo, 'other');
    await workspaceDeploy(storage, repo, 'other', 'counts', '1.0.0', { runner: new LocalTaskRunner(repo) });
    // Another value first, so the file is what puts the collection there
    await workspaceSetDataset(storage, repo, 'other', [variant('field', 'inputs'), variant('field', 'counts')], new Map(), CountsType);
    assert.notEqual(await held('counts', 'other'), await held('counts'));

    const set = spawnSync(process.execPath, [CLI, 'dataset', 'set', repo, 'other.counts', '--from-file', file], { encoding: 'utf-8' });
    assert.equal(set.status, 0, set.stderr);
    assert.equal(await held('counts', 'other'), await held('counts'), 'the same value, stored as the same segments');
  });
});
