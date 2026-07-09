/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
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

  // Python materialization shells out to uv (unlike the node path's npm);
  // self-skip where uv is unavailable, matching the integration e2e.
  const hasUv = (() => {
    try { execFileSync('uv', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
  })();

  it('materializes a single-project python env: sdist installs, uv pip check passes, imports work',
    { skip: hasUv ? false : 'uv not on PATH' }, async () => {
      // Build a minimal locked uv project (no third-party deps → no registry
      // fetch beyond the build backend) and capture its files exactly as
      // e3.export would, then materialize through the new unified buildPython
      // (uv sync --all-packages --no-install-workspace --no-install-local +
      //  uv pip install --no-deps + uv pip check).
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-py-proj-'));
      try {
        fs.mkdirSync(path.join(projectDir, 'src', 'e3_pyenv_fixture'), { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'pyproject.toml'),
          '[project]\nname = "e3-pyenv-fixture"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n\n' +
          '[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n');
        fs.writeFileSync(path.join(projectDir, 'src', 'e3_pyenv_fixture', '__init__.py'),
          'MARKER = "e3-pyenv-ok"\n');
        execFileSync('uv', ['lock'], { cwd: projectDir, stdio: 'ignore' });
        const distDir = path.join(projectDir, 'dist');
        execFileSync('uv', ['build', '--sdist', '--out-dir', distDir], { cwd: projectDir, stdio: 'ignore' });
        const sdistFile = fs.readdirSync(distDir).find((f) => f.endsWith('.tar.gz'))!;

        const pyprojectHash = await storage.objects.write(repo, fs.readFileSync(path.join(projectDir, 'pyproject.toml')));
        const lockHash = await storage.objects.write(repo, fs.readFileSync(path.join(projectDir, 'uv.lock')));
        const sdistHash = await storage.objects.write(repo, fs.readFileSync(path.join(distDir, sdistFile)));
        const spec = encodeBeast2For(EnvironmentSpecType)(variant('python', {
          pyproject: pyprojectHash, lock: lockHash,
          sdists: [{ filename: sdistFile, hash: sdistHash }],
        }));
        const envHash = await storage.objects.write(repo, spec);

        const bins = await materializeEnvironment(storage, repo, envHash);
        assert.strictEqual(bins.length, 1);
        const envDir = path.join(repo, 'envs', envHash);
        const py = path.join(envDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
        // The captured project code imports from the materialized venv alone.
        const out = execFileSync(py, ['-c', 'import e3_pyenv_fixture as m; print(m.MARKER)'], { encoding: 'utf-8' });
        assert.match(out, /e3-pyenv-ok/);
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

  it('materializes an npm workspace_node env: closure members linked, non-closure member pruned', async () => {
    // Build a real npm workspace (common + pricing→common + forecasting),
    // capture only the pricing CLOSURE (pricing, common), and materialize.
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-nws-'));
    try {
      const mk = (rel: string, obj: unknown, code?: string) => {
        fs.mkdirSync(path.join(ws, rel), { recursive: true });
        fs.writeFileSync(path.join(ws, rel, 'package.json'), JSON.stringify(obj));
        if (code) fs.writeFileSync(path.join(ws, rel, 'index.js'), code);
      };
      fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({
        name: 'sol-root', version: '1.0.0', private: true, workspaces: ['packages/*'],
      }));
      mk('packages/common', { name: '@acme/common', version: '1.0.0', main: 'index.js' },
        'module.exports.base = () => 41;\n');
      mk('packages/pricing', { name: '@acme/pricing', version: '1.0.0', main: 'index.js', dependencies: { '@acme/common': '1.0.0' } },
        'module.exports.price = () => require("@acme/common").base() + 1;\n');
      mk('packages/forecasting', { name: '@acme/forecasting', version: '1.0.0', main: 'index.js', dependencies: { '@acme/common': '1.0.0' } },
        'module.exports.f = () => 0;\n');
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ws, stdio: 'ignore' });

      const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-nws-pack-'));
      const pack = (rel: string): string => {
        execFileSync('npm', ['pack', '--pack-destination', packDir], { cwd: path.join(ws, rel), stdio: 'ignore' });
        return fs.readdirSync(packDir).map((f) => path.join(packDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]!;
      };
      // Closure of pricing = {common, pricing} (sorted by path); forecasting excluded.
      const commonTar = fs.readFileSync(pack('packages/common'));
      const pricingTar = fs.readFileSync(pack('packages/pricing'));

      const pkgJsonHash = await storage.objects.write(repo, fs.readFileSync(path.join(ws, 'package.json')));
      const lockHash = await storage.objects.write(repo, fs.readFileSync(path.join(ws, 'package-lock.json')));
      const commonHash = await storage.objects.write(repo, commonTar);
      const pricingHash = await storage.objects.write(repo, pricingTar);
      const spec = encodeBeast2For(EnvironmentSpecType)(variant('workspace_node', {
        packageJson: pkgJsonHash, lock: lockHash, config: none, subject: 'packages/pricing',
        members: [
          { path: 'packages/common', name: '@acme/common', tarball: commonHash },
          { path: 'packages/pricing', name: '@acme/pricing', tarball: pricingHash },
        ],
      }));
      const envHash = await storage.objects.write(repo, spec);

      const bins = await materializeEnvironment(storage, repo, envHash);
      const envDir = path.join(repo, 'envs', envHash);
      assert.strictEqual(bins[0], path.join(envDir, 'node_modules', '.bin'));

      // Cross-member require resolves from the materialized workspace alone.
      const out = execFileSync(process.execPath,
        ['-e', 'process.chdir(process.argv[1]); console.log(require("@acme/pricing").price())', envDir],
        { encoding: 'utf-8', cwd: envDir });
      assert.match(out, /42/);
      // The non-closure member must not have been materialized.
      assert.ok(!fs.existsSync(path.join(envDir, 'node_modules', '@acme', 'forecasting')),
        'forecasting (not in closure) must be absent');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('rejects a workspace_node member tarball with a path-traversal entry', async () => {
    // Hand-craft a gzipped tar whose entry escapes via '..' — must be refused.
    const zlib = await import('node:zlib');
    const { pack: tarPack } = await import('tar-stream');
    const p = tarPack();
    p.entry({ name: 'package/../../evil.js' }, 'pwned');
    p.finalize();
    const chunks: Buffer[] = [];
    for await (const c of p) chunks.push(c as Buffer);
    const evilTarball = zlib.gzipSync(Buffer.concat(chunks));

    const rootPkg = await storage.objects.write(repo, Buffer.from(JSON.stringify({ name: 'r', workspaces: ['packages/x'] })));
    const npmLock = await storage.objects.write(repo, Buffer.from(JSON.stringify({ name: 'r', lockfileVersion: 3 })));
    const evilHash = await storage.objects.write(repo, evilTarball);
    const spec = encodeBeast2For(EnvironmentSpecType)(variant('workspace_node', {
      packageJson: rootPkg, lock: npmLock, config: none, subject: 'packages/x',
      members: [{ path: 'packages/x', name: '@acme/x', tarball: evilHash }],
    }));
    const envHash = await storage.objects.write(repo, spec);
    await assert.rejects(materializeEnvironment(storage, repo, envHash), /illegal path|escapes/);
  });
});
