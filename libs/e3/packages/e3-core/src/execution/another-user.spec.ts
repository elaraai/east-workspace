/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A local runner whose processes run as another user (#1069): a task's
 * runner, a stock runner's unit asking for its segments, a function call, an
 * intake and an environment's install each run as that user, and write where
 * e3 gave it a directory; and what e3 keeps of what they wrote — the objects
 * an output is stored as, a built environment — is e3's own.
 *
 * Becoming another user needs root, so the package tests skip this spec. CI
 * runs it under sudo (`make test-as-another-user`, which sets
 * `E3_TEST_AS_ROOT=1`), as the user sudo names: the one that ran it, which
 * owns the checkout the runner CLIs are found in.
 */

import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, chownSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { pack as tarPack } from 'tar-stream';
import {
  ArrayType, BlobType, East, IRType, IntegerType, StringType, decodeBeast2For, encodeBeast2For, encodeEastIR, none, toEastTypeValue, variant,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import { EnvironmentSpecType, TASK_OBJECT_KIND, TaskObjectType, type TaskObject } from '@elaraai/e3-types';
import { LocalTaskRunner } from './LocalTaskRunner.js';
import { materializeEnvironment } from './environment.js';
import { runIntake } from './intake.js';
import type { ProcessSettings } from './processExec.js';
import { scratchRoot } from './scratch.js';
import { inputsHash } from '../executions.js';
import { packageImport } from '../package-files.js';
import { packageRead } from '../packages.js';
import { datasetWrite } from '../trees.js';
import { objectWrite } from '../storage/local/LocalObjectStore.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { createTempDir, createTestRepo, encodeInSegmentsOf, removeTempDir, removeTestRepo } from '../test-helpers.js';

const TableType = ArrayType(IntegerType);

/** An environment's file, as export stores it: a beast2 Blob of its bytes. */
const encodeFile = encodeBeast2For(BlobType);

describe('a local runner whose processes run as another user', {
  skip: process.env.E3_TEST_AS_ROOT === '1' ? false : 'becoming another user needs root: `sudo make -C libs/e3 test-as-another-user` runs it, as CI does',
}, () => {
  let uid: number;
  let gid: number;
  let repo: string;
  let dir: string;
  let storage: StorageBackend;
  let settings: ProcessSettings;

  before(() => {
    assert.equal(process.getuid?.(), 0, 'E3_TEST_AS_ROOT=1 runs this spec as root, under sudo');
    assert.ok(process.env.SUDO_UID !== undefined && process.env.SUDO_GID !== undefined, 'sudo names the user that ran it');
    uid = Number(process.env.SUDO_UID);
    gid = Number(process.env.SUDO_GID);
    assert.notEqual(uid, 0, 'the user that ran sudo is not root');
  });

  beforeEach(() => {
    // A temporary directory is its maker's alone: the user passes through the
    // repository to its scratch directory, and runs what is staged in `dir`.
    repo = createTestRepo();
    chmodSync(repo, 0o755);
    dir = createTempDir();
    chmodSync(dir, 0o755);
    const home = join(dir, 'home');
    mkdirSync(home);
    chownSync(home, uid, gid);
    settings = { env: { PATH: process.env.PATH ?? '', HOME: home }, uid, gid };
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(dir);
  });

  /** The paths under `root`, and `root`, that are not e3's own — another
   *  user's, or with a mode by which another may write it or run as its
   *  owner — with whose they are and their mode. */
  function notE3s(root: string): string[] {
    const others: string[] = [];
    const walk = (at: string): void => {
      const stats = lstatSync(at);
      if (stats.uid !== 0 || (!stats.isSymbolicLink() && (stats.mode & 0o6022) !== 0)) {
        others.push(`${at} (${stats.uid}, ${(stats.mode & 0o7777).toString(8)})`);
      }
      if (stats.isDirectory()) for (const name of readdirSync(at)) walk(join(at, name));
    };
    walk(root);
    return others;
  }

  /** `storage`, saying whose each file it adopts is; placing an object a
   *  download when `placement` says so, as a store elsewhere does. */
  function watching(owners: number[], placement?: 'download'): StorageBackend {
    const objects = Object.create(storage.objects, {
      ...(placement !== undefined && { placement: { value: placement } }),
      adoptFile: {
        value: (at: string, file: string, hash?: string): Promise<{ hash: string; size: number }> => {
          owners.push(lstatSync(file).uid);
          return storage.objects.adoptFile(at, file, hash);
        },
      },
    }) as StorageBackend['objects'];
    return {
      upgrades: storage.upgrades,
      objects,
      refs: storage.refs,
      locks: storage.locks,
      logs: storage.logs,
      repos: storage.repos,
      datasets: storage.datasets,
      runStates: (at) => storage.runStates(at),
      validateRepository: (at) => storage.validateRepository(at),
    };
  }

  /** An `npm pack` tarball of a package that is its manifest alone. */
  async function memberTarball(manifest: object): Promise<Buffer> {
    const tar = tarPack();
    tar.entry({ name: 'package/package.json' }, JSON.stringify(manifest));
    tar.finalize();
    const chunks: Buffer[] = [];
    for await (const chunk of tar) chunks.push(chunk as Buffer);
    return gzipSync(Buffer.concat(chunks));
  }

  it('runs a task\'s runner as the user, which writes its output where e3 gave it, and stores the output as e3\'s own file', async () => {
    // A custom command saying whom it runs as, writing an output no object is
    // yet, which anyone may write and which runs as its owner
    const commandFn = East.function([ArrayType(StringType), StringType], ArrayType(StringType), ($, inputs, output) => [
      'node', '-e',
      'const fs = require("node:fs"); process.stdout.write(JSON.stringify([process.getuid(), process.getgid()])); ' +
        'fs.writeFileSync(process.argv[2], "written by " + process.getuid() + " at " + Date.now()); fs.chmodSync(process.argv[2], 0o6777)',
      inputs.get(0n), output,
    ]);
    const task: TaskObject = {
      kind: TASK_OBJECT_KIND,
      body: variant('command', { commandIr: await objectWrite(repo, encodeBeast2For(IRType)(commandFn.toIR().ir)) }),
      runner: variant('custom', { command: [] }),
      inputs: [],
      output: { path: [], kind: variant('value', null) },
      role: variant('data', null),
      environment: none,
    };
    const taskHash = await objectWrite(repo, encodeBeast2For(TaskObjectType)(task));
    const inputHashes = [await storage.objects.write(repo, new Uint8Array([1, 2, 3]))];
    const owners: number[] = [];

    const result = await new LocalTaskRunner(repo, undefined, settings).execute(watching(owners), taskHash, inputHashes);

    assert.equal(result.state, 'success', result.error ?? '');
    const stdout = (await storage.logs.read(repo, taskHash, inputsHash(inputHashes), result.executionId, 'stdout')).data;
    assert.deepEqual(JSON.parse(stdout), [uid, gid], 'the runner ran as the user and group');
    assert.deepEqual(owners, [uid], 'the user wrote the output');
    assert.deepEqual(notE3s(join(repo, 'objects')), [], 'every object is e3\'s own file');
    assert.deepEqual(readdirSync(scratchRoot(repo)), [], 'the scratch directory is gone');
  });

  it('runs a stock runner\'s unit as the user, which asks for its segments where e3 gave it, and stores what it wrote as e3\'s own', async () => {
    const last = e3.task('last', [e3.input('table', TableType)], East.function([TableType], IntegerType, ($, table) => table.get(49_999n)));
    const zip = join(dir, 'last.zip');
    await e3.export(e3.package('last', '1.0.0', last), zip);
    await packageImport(storage, repo, zip);
    const taskHash = (await packageRead(storage, repo, 'last', '1.0.0')).tasks.get('last')!;
    const inputHashes = [await datasetWrite(storage, repo, Array.from({ length: 50_000 }, (_, i) => BigInt(i)), TableType)];
    const owners: number[] = [];

    // A store whose objects are elsewhere: the runner asks for the segment its
    // read lands in by writing beside it, as the user.
    const result = await new LocalTaskRunner(repo, undefined, settings).execute(watching(owners, 'download'), taskHash, inputHashes);

    assert.equal(result.state, 'success', result.error ?? '');
    assert.deepEqual(owners, [uid], 'the user wrote the output');
    assert.deepEqual(notE3s(join(repo, 'objects')), [], 'every object is e3\'s own file');
    assert.equal(result.outputHash, await datasetWrite(storage, repo, 49_999n, IntegerType));
  });

  it('runs a function call as the user: a custom command, and a stock runner asking for the segments of a dataset argument', async () => {
    const runner = new LocalTaskRunner(repo, undefined, settings);
    const custom = await runner.runDetached({
      bodyIr: new Uint8Array([1]),
      args: [encodeBeast2For(StringType)('the value')],
      runner: variant('custom', { command: [process.execPath, '-e',
        'process.stdout.write(JSON.stringify([process.getuid(), process.getgid()])); const a = process.argv; require("node:fs").copyFileSync(a[a.indexOf("-i") + 1], a[a.indexOf("-o") + 1])', '--'] }),
      limits: { timeoutMs: 60_000, maxResultBytes: 1024, maxLogBytes: 1024 },
    });
    assert.equal(custom.kind, 'success', custom.stderr);
    assert.deepEqual(JSON.parse(custom.stdout), [uid, gid], 'the call ran as the user and group');

    const table = await datasetWrite(storage, repo, Array.from({ length: 50_000 }, (_, i) => BigInt(i)), TableType);
    const stock = await runner.runDetached({
      bodyIr: encodeEastIR(East.function([TableType], IntegerType, ($, rows) => rows.get(49_999n)).toIR()),
      args: [{ dataset: table }],
      runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }),
      limits: { timeoutMs: 60_000, maxResultBytes: 1024, maxLogBytes: 64 * 1024 },
    }, { storage: watching([], 'download') });
    assert.ok(stock.kind === 'success', `the call ended ${stock.kind}: ${stock.stderr}`);
    assert.equal(decodeBeast2For(IntegerType)(stock.value), 49_999n);
  });

  it('takes a delivery in as the user, in a scratch directory e3 gave it, and stores what it wrote as e3\'s own', async () => {
    const rows = Array.from({ length: 4_000 }, (_, i) => BigInt(i));
    const object = await storage.objects.write(repo, encodeInSegmentsOf(TableType, 512)(rows));
    const owners: number[] = [];

    const taken = await runIntake(watching(owners), repo, { source: { object }, type: toEastTypeValue(TableType) }, settings, new Map());

    assert.ok(owners.length > 0 && owners.every((owner) => owner === uid), `the user wrote what it took in: ${owners.join(', ')}`);
    assert.deepEqual(notE3s(join(repo, 'objects')), [], 'every object is e3\'s own file');
    assert.equal(taken.hash, await datasetWrite(storage, repo, rows, TableType));
  });

  it('builds an environment as the user, in a build directory and member directories e3 gave it, and takes it back before any runner reads it', async () => {
    // An npm saying whom it ran as, installing as npm does: into the build
    // directory, and a member's own directory; and leaving a tool anyone may
    // write and that runs as its owner.
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'npm'), '#!/bin/sh\nset -e\n' +
      'echo "$(id -u):$(id -g)" > ran-as\n' +
      'mkdir -p packages/common/node_modules node_modules/.bin node_modules/@acme\n' +
      'ln -s ../../packages/common node_modules/@acme/common\n' +
      'touch node_modules/.bin/a-tool\nchmod 6777 node_modules/.bin/a-tool\n');
    chmodSync(join(bin, 'npm'), 0o755);
    const spec = encodeBeast2For(EnvironmentSpecType)(variant('workspace_node', {
      packageJson: await storage.objects.write(repo, encodeFile(Buffer.from(JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] })))),
      lock: await storage.objects.write(repo, encodeFile(Buffer.from(JSON.stringify({ name: 'root', lockfileVersion: 3 })))),
      config: none,
      subject: 'packages/common',
      members: [{
        path: 'packages/common',
        name: '@acme/common',
        tarball: await storage.objects.write(repo, encodeFile(await memberTarball({ name: '@acme/common', version: '1.0.0' }))),
      }],
    }));
    const envHash = await storage.objects.write(repo, spec);

    await materializeEnvironment(storage, repo, envHash, { ...settings, env: { ...settings.env, PATH: `${bin}:/usr/bin:/bin` } });

    const envDir = join(repo, 'envs', envHash);
    assert.equal(readFileSync(join(envDir, 'ran-as'), 'utf8'), `${uid}:${gid}\n`, 'npm ran as the user and group');
    assert.deepEqual(notE3s(envDir), [], 'the built environment is e3\'s own, every file of it');
  });
});
