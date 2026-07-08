/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { encodeBeast2For, variant, some, none } from '@elaraai/east';
import {
  TaskObjectType, decodeTaskObject,
  FunctionObjectType, decodeFunctionObject,
  EnvironmentSpecType, environmentSpecObjectHashes,
  type TaskObject, type FunctionObject,
} from '@elaraai/e3-types';
import { StructType, StringType, ArrayType, BlobType, OptionType, EastTypeType, toEastTypeValue, IntegerType } from '@elaraai/east';
import { TreePathType, RunnerType } from '@elaraai/e3-types';
import { LocalBackend } from '../storage/local/index.js';
import { repoInit } from '../storage/local/repository.js';
import { materializeEnvironment } from './environment.js';

describe('task/function object dual decoders', () => {
  it('decodes pre-environment task bytes with environment defaulted to none', () => {
    const PreEnvironmentTaskObjectType = StructType({
      commandIr: StringType,
      inputs: ArrayType(TreePathType),
      output: TreePathType,
      kind: OptionType(StringType),
      metadata: OptionType(BlobType),
      runner: RunnerType,
    });
    const legacyBytes = encodeBeast2For(PreEnvironmentTaskObjectType)({
      commandIr: 'a'.repeat(64),
      inputs: [[variant('field', 'x')]],
      output: [variant('field', 'y')],
      kind: none,
      metadata: none,
      runner: variant('custom', { command: [] }),
    });

    const task = decodeTaskObject(legacyBytes);
    assert.strictEqual(task.commandIr, 'a'.repeat(64));
    assert.strictEqual(task.environment.type, 'none');
  });

  it('round-trips a current task with an environment hash', () => {
    const taskObj: TaskObject = {
      commandIr: 'a'.repeat(64),
      inputs: [],
      output: [variant('field', 'y')],
      kind: none,
      metadata: none,
      runner: variant('custom', { command: [] }),
      environment: some('b'.repeat(64)),
    };
    const decoded = decodeTaskObject(encodeBeast2For(TaskObjectType)(taskObj));
    assert.strictEqual(decoded.environment.type, 'some');
    assert.strictEqual(decoded.environment.type === 'some' && decoded.environment.value, 'b'.repeat(64));
  });

  it('decodes pre-environment function bytes with environment defaulted to none', () => {
    const PreEnvironmentFunctionObjectType = StructType({
      bodyIr: StringType,
      inputTypes: ArrayType(EastTypeType),
      outputType: EastTypeType,
      runner: RunnerType,
    });
    const legacyBytes = encodeBeast2For(PreEnvironmentFunctionObjectType)({
      bodyIr: 'c'.repeat(64),
      inputTypes: [toEastTypeValue(IntegerType)],
      outputType: toEastTypeValue(IntegerType),
      runner: variant('east_node', { platforms: [] }),
    });

    const fn = decodeFunctionObject(legacyBytes);
    assert.strictEqual(fn.bodyIr, 'c'.repeat(64));
    assert.strictEqual(fn.environment.type, 'none');
  });

  it('round-trips a current function with an environment hash', () => {
    const fnObj: FunctionObject = {
      bodyIr: 'c'.repeat(64),
      inputTypes: [],
      outputType: toEastTypeValue(IntegerType),
      runner: variant('east_node', { platforms: [] }),
      environment: some('d'.repeat(64)),
    };
    const decoded = decodeFunctionObject(encodeBeast2For(FunctionObjectType)(fnObj));
    assert.strictEqual(decoded.environment.type === 'some' && decoded.environment.value, 'd'.repeat(64));
  });

  it('folds the environment into the task object bytes (cache identity)', () => {
    const base: TaskObject = {
      commandIr: 'a'.repeat(64),
      inputs: [],
      output: [variant('field', 'y')],
      kind: none,
      metadata: none,
      runner: variant('custom', { command: [] }),
      environment: none,
    };
    const encoder = encodeBeast2For(TaskObjectType);
    const withEnv = { ...base, environment: some('b'.repeat(64)) as TaskObject['environment'] };
    assert.notDeepStrictEqual(encoder(base), encoder(withEnv));
  });
});

describe('environmentSpecObjectHashes', () => {
  it('lists python blobs', () => {
    assert.deepStrictEqual(
      environmentSpecObjectHashes(variant('python', { pyproject: 'p', lock: 'l', sdists: [{ filename: 'a-1.0.tar.gz', hash: 's1' }, { filename: 'b-1.0.tar.gz', hash: 's2' }] })),
      ['p', 'l', 's1', 's2'],
    );
  });
  it('lists node blobs', () => {
    assert.deepStrictEqual(
      environmentSpecObjectHashes(variant('node', { packageJson: 'p', lock: 'l', tarballs: ['t'] })),
      ['p', 'l', 't'],
    );
  });
  it('lists nothing for image', () => {
    assert.deepStrictEqual(
      environmentSpecObjectHashes(variant('image', { digest: `repo@sha256:${'0'.repeat(64)}` })),
      [],
    );
  });
});

describe('materializeEnvironment', () => {
  let tmpDir: string;
  let repo: string;
  const storage = new LocalBackend();

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-env-spec-'));
    repo = path.join(tmpDir, 'repo');
    await repoInit(repo);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects image environments locally with a clear error', async () => {
    const spec = encodeBeast2For(EnvironmentSpecType)(
      variant('image', { digest: `example.com/img@sha256:${'0'.repeat(64)}` }),
    );
    const envHash = await storage.objects.write(repo, spec);
    await assert.rejects(
      materializeEnvironment(storage, repo, envHash),
      /image environments are not supported by the local runner/,
    );
  });

  it('materializes a node environment cold, then reuses it warm', async () => {
    // A locked node project with no dependencies — `npm ci` completes fast
    // and the materialized dir contributes node_modules/.bin to PATH.
    const packageJson = Buffer.from(JSON.stringify({
      name: 'e3-env-fixture', version: '1.0.0', private: true,
    }));
    const lock = Buffer.from(JSON.stringify({
      name: 'e3-env-fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
      packages: { '': { name: 'e3-env-fixture', version: '1.0.0' } },
    }));
    const pkgHash = await storage.objects.write(repo, packageJson);
    const lockHash = await storage.objects.write(repo, lock);
    const spec = encodeBeast2For(EnvironmentSpecType)(
      variant('node', { packageJson: pkgHash, lock: lockHash, tarballs: [] }),
    );
    const envHash = await storage.objects.write(repo, spec);

    const bins = await materializeEnvironment(storage, repo, envHash);
    assert.strictEqual(bins.length, 1);
    assert.ok(bins[0]!.endsWith(path.join('node_modules', '.bin')));

    const envDir = path.join(repo, 'envs', envHash);
    assert.ok(fs.existsSync(path.join(envDir, 'package.json')), 'materialized dir holds the manifest');

    // Warm path: mark the cache dir and confirm a second call does not rebuild.
    fs.writeFileSync(path.join(envDir, '.warm-marker'), 'x');
    const binsAgain = await materializeEnvironment(storage, repo, envHash);
    assert.deepStrictEqual(binsAgain, bins);
    assert.ok(fs.existsSync(path.join(envDir, '.warm-marker')), 'warm hit must not rebuild the dir');
  });

  it('materializes a tools environment: files on PATH under bin/, executable, then warm', async () => {
    const runnerBytes = Buffer.from('#!/bin/sh\necho hi\n');
    const helperBytes = Buffer.from('DATA');
    const runnerHash = await storage.objects.write(repo, runnerBytes);
    const helperHash = await storage.objects.write(repo, helperBytes);
    const spec = encodeBeast2For(EnvironmentSpecType)(variant('tools', {
      files: [
        { path: 'bin/my-runner', hash: runnerHash },
        { path: 'bin/helper.dat', hash: helperHash },
      ],
    }));
    const envHash = await storage.objects.write(repo, spec);

    const bins = await materializeEnvironment(storage, repo, envHash);
    assert.strictEqual(bins.length, 1);
    const envDir = path.join(repo, 'envs', envHash);
    assert.strictEqual(bins[0], path.join(envDir, 'bin'));

    const runnerPath = path.join(envDir, 'bin', 'my-runner');
    assert.deepStrictEqual(fs.readFileSync(runnerPath), runnerBytes, 'file bytes preserved');
    assert.deepStrictEqual(fs.readFileSync(path.join(envDir, 'bin', 'helper.dat')), helperBytes);
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(runnerPath).mode & 0o111, 0o111, 'captured file is executable');
    }

    // Warm path: a marker survives a second call (no rebuild).
    fs.writeFileSync(path.join(envDir, '.warm-marker'), 'x');
    const binsAgain = await materializeEnvironment(storage, repo, envHash);
    assert.deepStrictEqual(binsAgain, bins);
    assert.ok(fs.existsSync(path.join(envDir, '.warm-marker')), 'warm hit must not rebuild');
  });

  it('rejects a tools spec whose file path escapes the environment dir', async () => {
    for (const badPath of ['../evil', '/etc/passwd', 'a/../../b', '']) {
      const blobHash = await storage.objects.write(repo, Buffer.from('x'));
      const spec = encodeBeast2For(EnvironmentSpecType)(variant('tools', {
        files: [{ path: badPath, hash: blobHash }],
      }));
      const envHash = await storage.objects.write(repo, spec);
      await assert.rejects(
        materializeEnvironment(storage, repo, envHash),
        /tools file path|empty path/,
        `path '${badPath}' must be rejected`,
      );
    }
  });

  it('rejects a workspace_node environment until its materializer ships', async () => {
    const blobHash = await storage.objects.write(repo, Buffer.from('{}'));
    const spec = encodeBeast2For(EnvironmentSpecType)(variant('workspace_node', {
      packageJson: blobHash, lock: blobHash, config: none, subject: 'packages/x',
      members: [{ path: 'packages/x', name: '@acme/x', tarball: blobHash }],
    }));
    const envHash = await storage.objects.write(repo, spec);
    await assert.rejects(
      materializeEnvironment(storage, repo, envHash),
      /workspace_node.*not yet supported by the local runner/,
    );
  });
});
