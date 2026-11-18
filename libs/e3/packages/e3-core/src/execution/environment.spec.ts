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
  TASK_OBJECT_KIND, TaskObjectType, decodeTaskObject,
  FunctionObjectType, decodeFunctionObject,
  EnvironmentSpecType, environmentSpecObjectHashes,
  type EnvironmentSpec, type TaskObject, type FunctionObject,
} from '@elaraai/e3-types';
import { StructType, StringType, ArrayType, BlobType, OptionType, EastTypeType, toEastTypeValue, IntegerType } from '@elaraai/east';
import { TreePathType, RunnerType } from '@elaraai/e3-types';
import { LocalStorage } from '../storage/local/index.js';
import { repoInit } from '../storage/local/repository.js';
import { uvOnPath } from '../test-helpers.js';
import {
  decodeEnvironmentFile, environmentFitsTier, installShell, materializeEnvironment, materializeEnvironmentFor, nodeLockFilename,
} from './environment.js';
import { encodeFile, memberWorkspace, pythonProject, storedSdist, type CapturedSdist } from './environment.test-utils.js';

// An environment installed for another platform, or over a tier: environment-target.spec.ts

describe('the files an environment names', () => {
  it('decodes a file as its bytes, and refuses one an older SDK stored raw, in the materializer\'s words', () => {
    const bytes = Buffer.from('#!/bin/sh\necho hi\n');
    assert.deepStrictEqual(Buffer.from(decodeEnvironmentFile(encodeFile(bytes), 'a'.repeat(64))), bytes);
    for (const raw of [bytes, encodeBeast2For(StringType)('not a file')]) {
      assert.throws(() => decodeEnvironmentFile(raw, 'b'.repeat(64)), {
        message: `the environment file ${'b'.repeat(64)} was exported by an older e3 SDK — re-export its package with the current one`,
      });
    }
  });

  it('tells a node lockfile\'s format from its bytes', () => {
    assert.strictEqual(nodeLockFilename(Buffer.from('  {"lockfileVersion": 3}')), 'package-lock.json');
    assert.strictEqual(nodeLockFilename(Buffer.from("lockfileVersion: '9.0'\n")), 'pnpm-lock.yaml');
  });

  it('runs npm and pnpm through a shell on Windows, where they are .cmd files, uv as the executable it is, whose command line cmd.exe would cap, and a uv the path holds as a batch file alone through the shell that alone runs one', () => {
    const shims = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-shims-'));
    const executables = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-executables-'));
    try {
      fs.writeFileSync(path.join(shims, 'uv.cmd'), '');
      fs.writeFileSync(path.join(executables, 'uv.exe'), '');
      assert.deepStrictEqual(['npm', 'pnpm', 'uv'].map((command) => installShell(command, 'win32', executables)), [true, true, false]);
      assert.strictEqual(installShell('uv', 'win32', shims), true, 'a batch file alone, which cmd.exe alone runs');
      assert.strictEqual(installShell('uv', 'win32', `${shims};${executables}`), false, 'an executable anywhere on the path, which Windows finds with no shell');
      assert.strictEqual(installShell('uv', 'win32', ''), false, 'none: run as an executable, whose failure says it is not found');
      assert.deepStrictEqual(['npm', 'pnpm', 'uv'].map((command) => installShell(command, 'linux', shims)), [false, false, false]);
    } finally {
      fs.rmSync(shims, { recursive: true, force: true });
      fs.rmSync(executables, { recursive: true, force: true });
    }
  });
});

describe('task and function object decoders', () => {
  it('refuses pre-environment task bytes, as every task object an older SDK exported, saying to re-export', () => {
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

    assert.throws(() => decodeTaskObject(legacyBytes), /exported by an older e3 SDK — re-export it with the current one/);
  });

  it('round-trips a current task with an environment hash', () => {
    const taskObj: TaskObject = {
      kind: TASK_OBJECT_KIND,
      body: variant('command', { commandIr: 'a'.repeat(64) }),
      runner: variant('custom', { command: [] }),
      inputs: [],
      output: { path: [variant('field', 'y')], kind: variant('value', null) },
      role: variant('data', null),
      environment: some('b'.repeat(64)),
    };
    const decoded = decodeTaskObject(encodeBeast2For(TaskObjectType)(taskObj));
    assert.strictEqual(decoded.environment.type, 'some');
    assert.strictEqual(decoded.environment.type === 'some' && decoded.environment.value, 'b'.repeat(64));
  });

  it('refuses pre-environment function bytes, saying to re-export', () => {
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
      runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }),
    });

    assert.throws(() => decodeFunctionObject(legacyBytes), /exported by an older e3 SDK — re-export it with the current one/);
  });

  it('refuses function bytes from before a function had inputs, saying to re-export', () => {
    const PreInputsFunctionObjectType = StructType({
      bodyIr: StringType,
      inputTypes: ArrayType(EastTypeType),
      outputType: EastTypeType,
      runner: RunnerType,
      environment: OptionType(StringType),
    });
    const earlierBytes = encodeBeast2For(PreInputsFunctionObjectType)({
      bodyIr: 'c'.repeat(64),
      inputTypes: [toEastTypeValue(IntegerType)],
      outputType: toEastTypeValue(IntegerType),
      runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }),
      environment: none,
    });

    assert.throws(() => decodeFunctionObject(earlierBytes), /exported by an older e3 SDK — re-export it with the current one/);
  });

  it('refuses function bytes from before a function listed the records a call may draft, saying to re-export', () => {
    const PreDraftsFunctionObjectType = StructType({
      bodyIr: StringType,
      inputs: ArrayType(TreePathType),
      argTypes: ArrayType(EastTypeType),
      outputType: EastTypeType,
      runner: RunnerType,
      environment: OptionType(StringType),
    });
    // With an input and with none: either reads as no current function object.
    for (const inputs of [[], [[variant('field', 'records'), variant('field', 'jobs')]]]) {
      const earlierBytes = encodeBeast2For(PreDraftsFunctionObjectType)({
        bodyIr: 'c'.repeat(64),
        inputs,
        argTypes: [toEastTypeValue(IntegerType)],
        outputType: toEastTypeValue(IntegerType),
        runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }),
        environment: none,
      });

      assert.throws(() => decodeFunctionObject(earlierBytes), /exported by an older e3 SDK — re-export it with the current one/);
    }
  });

  it('round-trips a current function with an environment hash, and the records it lists in its drafts', () => {
    const fnObj: FunctionObject = {
      bodyIr: 'c'.repeat(64),
      inputs: [{ path: [variant('field', 'records'), variant('field', 'jobs')], index: none }],
      drafts: ['jobs'],
      argTypes: [],
      outputType: toEastTypeValue(IntegerType),
      runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }),
      environment: some('d'.repeat(64)),
    };
    const decoded = decodeFunctionObject(encodeBeast2For(FunctionObjectType)(fnObj));
    assert.strictEqual(decoded.environment.type === 'some' && decoded.environment.value, 'd'.repeat(64));
    assert.deepStrictEqual(decoded.drafts, ['jobs']);
  });

  it('folds the environment into the task object bytes (cache identity)', () => {
    const base: TaskObject = {
      kind: TASK_OBJECT_KIND,
      body: variant('command', { commandIr: 'a'.repeat(64) }),
      runner: variant('custom', { command: [] }),
      inputs: [],
      output: { path: [variant('field', 'y')], kind: variant('value', null) },
      role: variant('data', null),
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
  const storage = new LocalStorage();

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-env-spec-'));
    repo = path.join(tmpDir, 'repo');
    await repoInit(repo);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Runs `work` in `dir`, as a host whose repositories are named rather than
   * placed runs: each repository's path is its name, relative to the working
   * directory.
   */
  async function workingIn<T>(dir: string, work: () => Promise<T>): Promise<T> {
    const was = process.cwd();
    process.chdir(dir);
    try {
      return await work();
    } finally {
      process.chdir(was);
    }
  }

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
    const pkgHash = await storage.objects.write(repo, encodeFile(packageJson));
    const lockHash = await storage.objects.write(repo, encodeFile(lock));
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
    const runnerHash = await storage.objects.write(repo, encodeFile(runnerBytes));
    const helperHash = await storage.objects.write(repo, encodeFile(helperBytes));
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

  it('refuses a file an older SDK exported as its raw bytes, naming the re-export', async () => {
    // A beast2 file holding a String, exported raw, would read as some
    // other file's bytes were only its body decoded.
    for (const raw of [Buffer.from('#!/bin/sh\necho hi\n'), Buffer.from(encodeBeast2For(StringType)('not a file'))]) {
      const fileHash = await storage.objects.write(repo, raw);
      const spec = encodeBeast2For(EnvironmentSpecType)(variant('tools', { files: [{ path: 'bin/old-tool', hash: fileHash }] }));
      const envHash = await storage.objects.write(repo, spec);
      await assert.rejects(
        materializeEnvironment(storage, repo, envHash),
        { message: `the environment file ${fileHash} was exported by an older e3 SDK — re-export its package with the current one` },
      );
      assert.ok(!fs.existsSync(path.join(repo, 'envs', envHash)), 'nothing is materialized');
    }
  });

  it('refuses wherever it is read an object of another type than this release\'s spec, in the one decoder\'s words', async () => {
    // e3-types' decodeEnvironmentSpec, which each reader goes through, refuses
    // a spec of another type by what its type says (environment.spec in e3-types)
    const envHash = await storage.objects.write(repo, encodeBeast2For(StringType)('a spec of another type'));
    const refusal = { message: `the object ${envHash} is not an environment's spec` };
    await assert.rejects(materializeEnvironment(storage, repo, envHash), refusal);
    assert.ok(!fs.existsSync(path.join(repo, 'envs', envHash)), 'nothing is materialized');
    await assert.rejects(materializeEnvironmentFor(storage, repo, envHash, { platform: 'x86_64-manylinux_2_28' }, path.join(tmpDir, 'earlier-spec')), refusal);
    const tier = { version: 1 as const, python: { version: '3.12.3', executable: '/opt/venv/bin/python', base: '/usr/bin/python3', site: '/opt/venv/lib/python3.12/site-packages' },
      namespaces: [], distributions: [] };
    await assert.rejects(environmentFitsTier(storage, repo, envHash, tier), refusal);
  });

  it('rejects a tools spec whose file path escapes the environment dir', async () => {
    for (const badPath of ['../evil', '/etc/passwd', 'a/../../b', '']) {
      const blobHash = await storage.objects.write(repo, encodeFile(Buffer.from('x')));
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
  const hasUv = uvOnPath();

  const write = (bytes: Uint8Array): Promise<string> => storage.objects.write(repo, encodeFile(bytes));

  it('materializes a single-project python env: sdist installs, uv pip check passes, imports work — in a repository named absolutely, and in one named relative to the working directory',
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

        /** Captures the project into the repository at `at`, and builds it there cold. */
        const materializeIn = async (at: string): Promise<void> => {
          const pyprojectHash = await storage.objects.write(at, encodeFile(fs.readFileSync(path.join(projectDir, 'pyproject.toml'))));
          const lockHash = await storage.objects.write(at, encodeFile(fs.readFileSync(path.join(projectDir, 'uv.lock'))));
          const sdistHash = await storage.objects.write(at, encodeFile(fs.readFileSync(path.join(distDir, sdistFile))));
          const spec = encodeBeast2For(EnvironmentSpecType)(variant('python', {
            pyproject: pyprojectHash, lock: lockHash,
            sdists: [{ filename: sdistFile, hash: sdistHash }],
          }));
          const envHash = await storage.objects.write(at, spec);

          const bins = await materializeEnvironment(storage, at, envHash);
          const envDir = path.resolve(at, 'envs', envHash);
          assert.deepStrictEqual(bins, [path.join(envDir, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin')],
            'its PATH entry, absolute');
          const py = path.join(envDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
          // The captured project code imports from the materialized venv alone.
          const out = execFileSync(py, ['-c', 'import e3_pyenv_fixture as m; print(m.MARKER)'], { encoding: 'utf-8' });
          assert.match(out, /e3-pyenv-ok/);
        };
        await materializeIn(repo);
        // A repository named rather than placed, whose path uv is given while
        // it runs in the build directory
        await repoInit(path.join(tmpDir, 'named-python-repo'));
        await workingIn(tmpDir, () => materializeIn('named-python-repo'));
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

  it('materializes a workspace member\'s python env with the member\'s dependencies alone: nothing its workspace\'s root or another member depends on, none of its development group, and the distributions it requires as the lock pins them, with their extras (#1654)',
    { skip: hasUv ? false : 'uv not on PATH' }, async () => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-py-ws-'));
      try {
        const { pyproject, lock, features, trainer } = await memberWorkspace(ws, write);
        /** The modules of the eight that an environment built from the spec imports. */
        const imports = async (spec: EnvironmentSpec): Promise<string[]> => {
          const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(spec));
          const [bin] = await materializeEnvironment(storage, repo, envHash);
          const found = execFileSync(path.join(bin!, process.platform === 'win32' ? 'python.exe' : 'python'), ['-c',
            'import importlib.util as u; print(" ".join(n for n in ["features", "idna", "iniconfig", "linkify_it", "markdown_it", "six", "tomli", "trainer"] if u.find_spec(n)))'],
          { encoding: 'utf-8' });
          return found.trim().split(' ');
        };

        assert.deepStrictEqual(await imports(variant('workspace_python', { pyproject, lock, subjects: ['features'], sdists: [features], requires: ['tomli'] })),
          ['features', 'idna', 'tomli'], 'its own dependency, what it requires, and itself: not the root\'s six, nor trainer, nor its own development group\'s iniconfig');
        // A distribution it requires, with the extra the workspace declares it with, and without
        assert.deepStrictEqual(await imports(variant('workspace_python', { pyproject, lock, subjects: ['features'], sdists: [features], requires: ['markdown-it-py[linkify]'] })),
          ['features', 'idna', 'linkify_it', 'markdown_it'], 'what the extra brings, as the lock pins it');
        assert.deepStrictEqual(await imports(variant('workspace_python', { pyproject, lock, subjects: ['features'], sdists: [features], requires: ['markdown-it-py'] })),
          ['features', 'idna', 'markdown_it'], 'named bare, it comes without');
        assert.deepStrictEqual(await imports(variant('workspace_python', { pyproject, lock, subjects: ['trainer'], sdists: [features, trainer], requires: [] })),
          ['features', 'idna', 'six', 'trainer'], 'a member that depends on another carries it and its dependencies, and not what the root alone lists');
        // The whole lock, as a project that is its own root installs it
        assert.deepStrictEqual(await imports(variant('python', { pyproject, lock, sdists: [features, trainer] })),
          ['features', 'idna', 'iniconfig', 'linkify_it', 'markdown_it', 'six', 'tomli', 'trainer']);

        // Names a spec carries are wire data, given to an install as arguments: refused before anything is installed
        for (const [named, refusal] of [
          [{ subjects: ['--all-packages'], requires: [] }, /the member '--all-packages' is not a package's name/],
          [{ subjects: ['features'], requires: ['tomli --index-url=http://example.invalid'] }, /the required distribution 'tomli --index-url=http:\/\/example\.invalid' is not a package's name/],
          [{ subjects: ['features'], requires: ['tomli[a b]'] }, /the extra of the required distribution 'tomli' 'a b' is not a package's name/],
          [{ subjects: ['features'], requires: ['tomli[a][b]'] }, /the required distribution 'tomli\[a\]\[b\]' is not a package's name/],
          [{ subjects: [], requires: [] }, /a workspace environment names no member/],
        ] as const) {
          const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(
            variant('workspace_python', { pyproject, lock, subjects: [...named.subjects], sdists: [features], requires: [...named.requires] })));
          await assert.rejects(() => materializeEnvironment(storage, repo, envHash), refusal);
          assert.ok(!fs.existsSync(path.resolve(repo, 'envs', envHash)), 'nothing was built');
        }
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });

  it('installs what a member\'s environment requires from where the lock pins it, an explicit index of the workspace\'s, and a local package it depends on from its sdist, never a registry',
    { skip: hasUv ? false : 'uv not on PATH' }, async () => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-py-index-'));
      try {
        // A registry only the workspace's sources name, which no install that
        // resolves again from a registry reads, holding a package that depends
        // on a name the workspace holds as a member
        const index = path.join(ws, 'index');
        pythonProject(path.join(ws, 'regpkg'), 'regpkg', ['helper'], 'regpkg-of-the-index');
        execFileSync('uv', ['build', '--wheel', '--out-dir', index], { cwd: path.join(ws, 'regpkg'), stdio: 'ignore' });
        const root = path.join(ws, 'root');
        pythonProject(path.join(root, 'packages', 'helper'), 'helper', [], 'helper-of-the-workspace');
        pythonProject(path.join(root, 'packages', 'pricing'), 'pricing', [], 'pricing-of-the-workspace');
        fs.writeFileSync(path.join(root, 'pyproject.toml'),
          '[project]\nname = "ws-root"\nversion = "0.1.0"\nrequires-python = ">=3.11"\ndependencies = ["regpkg", "pricing"]\n\n' +
          '[tool.uv.workspace]\nmembers = ["packages/*"]\n\n' +
          `[[tool.uv.index]]\nname = "local"\nurl = ${JSON.stringify(index)}\nformat = "flat"\nexplicit = true\n\n` +
          '[tool.uv.sources]\nregpkg = { index = "local" }\npricing = { workspace = true }\n');
        execFileSync('uv', ['lock'], { cwd: root, stdio: 'ignore' });
        const sdistOf = (name: string): Promise<CapturedSdist> => storedSdist(path.join(root, 'packages', name), path.join(ws, 'dist', name), write);
        // As the capture makes it: the member, and the local package what it requires depends on
        const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(variant('workspace_python', {
          pyproject: await write(fs.readFileSync(path.join(root, 'pyproject.toml'))), lock: await write(fs.readFileSync(path.join(root, 'uv.lock'))),
          subjects: ['pricing'], sdists: [await sdistOf('helper'), await sdistOf('pricing')], requires: ['regpkg'],
        })));
        const [bin] = await materializeEnvironment(storage, repo, envHash);
        const out = execFileSync(path.join(bin!, process.platform === 'win32' ? 'python.exe' : 'python'),
          ['-c', 'import regpkg, helper, pricing; print(regpkg.MARKER, helper.MARKER, pricing.MARKER)'], { encoding: 'utf-8' });
        assert.deepStrictEqual(out.trim().split(' '), ['regpkg-of-the-index', 'helper-of-the-workspace', 'pricing-of-the-workspace']);
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });

  it('materializes a node env with its project\'s tarball, and a tools env, in a repository named relative to the working directory, each on PATH absolutely', async () => {
    // A node project with no dependencies, and its own code as a tarball,
    // which npm installs from the path it is given while it runs in the build
    // directory
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-node-proj-'));
    try {
      // With a lifecycle script, which no install runs: it would leave a mark
      // in the installed package's directory.
      fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
        name: 'e3-env-own', version: '1.0.0', main: 'index.js',
        scripts: { postinstall: 'node -e "require(\'node:fs\').writeFileSync(\'postinstall-ran\', \'\')"' },
      }));
      fs.writeFileSync(path.join(projectDir, 'index.js'), 'module.exports.marker = "e3-env-own-ok";\n');
      // npm is npm.cmd on Windows; a shell resolves it.
      execFileSync('npm', ['pack', '--pack-destination', projectDir], { cwd: projectDir, stdio: 'ignore', shell: process.platform === 'win32' });
      const tarball = fs.readFileSync(path.join(projectDir, 'e3-env-own-1.0.0.tgz'));

      await repoInit(path.join(tmpDir, 'named-repo'));
      await workingIn(tmpDir, async () => {
        const at = 'named-repo';
        const packageJson = Buffer.from(JSON.stringify({ name: 'e3-env-fixture', version: '1.0.0', private: true }));
        const lock = Buffer.from(JSON.stringify({
          name: 'e3-env-fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
          packages: { '': { name: 'e3-env-fixture', version: '1.0.0' } },
        }));
        const spec = encodeBeast2For(EnvironmentSpecType)(variant('node', {
          packageJson: await storage.objects.write(at, encodeFile(packageJson)),
          lock: await storage.objects.write(at, encodeFile(lock)),
          tarballs: [await storage.objects.write(at, encodeFile(tarball))],
        }));
        const envHash = await storage.objects.write(at, spec);

        const envDir = path.resolve(at, 'envs', envHash);
        assert.deepStrictEqual(await materializeEnvironment(storage, at, envHash), [path.join(envDir, 'node_modules', '.bin')]);
        const out = execFileSync(process.execPath, ['-e', 'console.log(require("e3-env-own").marker)'], { encoding: 'utf-8', cwd: envDir });
        assert.match(out, /e3-env-own-ok/);
        assert.ok(!fs.existsSync(path.join(envDir, 'node_modules', 'e3-env-own', 'postinstall-ran')), 'the package\'s postinstall script did not run');

        // A tools env runs no tool, but its PATH entry is the runner's, which
        // resolves a relative one against its own working directory
        const tools = encodeBeast2For(EnvironmentSpecType)(variant('tools', {
          files: [{ path: 'bin/my-runner', hash: await storage.objects.write(at, encodeFile(Buffer.from('#!/bin/sh\necho hi\n'))) }],
        }));
        const toolsHash = await storage.objects.write(at, tools);
        assert.deepStrictEqual(await materializeEnvironment(storage, at, toolsHash), [path.resolve(at, 'envs', toolsHash, 'bin')]);
      });
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
      // npm is npm.cmd on Windows; a shell resolves it (execFileSync alone
      // ENOENTs). buildWorkspaceNode's own npm calls already use shell:win32.
      const npmShell = process.platform === 'win32';
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ws, stdio: 'ignore', shell: npmShell });

      const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-nws-pack-'));
      const pack = (rel: string): string => {
        execFileSync('npm', ['pack', '--pack-destination', packDir], { cwd: path.join(ws, rel), stdio: 'ignore', shell: npmShell });
        return fs.readdirSync(packDir).map((f) => path.join(packDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]!;
      };
      // Closure of pricing = {common, pricing} (sorted by path); forecasting excluded.
      const commonTar = fs.readFileSync(pack('packages/common'));
      const pricingTar = fs.readFileSync(pack('packages/pricing'));

      const pkgJsonHash = await storage.objects.write(repo, encodeFile(fs.readFileSync(path.join(ws, 'package.json'))));
      const lockHash = await storage.objects.write(repo, encodeFile(fs.readFileSync(path.join(ws, 'package-lock.json'))));
      const commonHash = await storage.objects.write(repo, encodeFile(commonTar));
      const pricingHash = await storage.objects.write(repo, encodeFile(pricingTar));
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

    const rootPkg = await storage.objects.write(repo, encodeFile(Buffer.from(JSON.stringify({ name: 'r', workspaces: ['packages/x'] }))));
    const npmLock = await storage.objects.write(repo, encodeFile(Buffer.from(JSON.stringify({ name: 'r', lockfileVersion: 3 }))));
    const evilHash = await storage.objects.write(repo, encodeFile(evilTarball));
    const spec = encodeBeast2For(EnvironmentSpecType)(variant('workspace_node', {
      packageJson: rootPkg, lock: npmLock, config: none, subject: 'packages/x',
      members: [{ path: 'packages/x', name: '@acme/x', tarball: evilHash }],
    }));
    const envHash = await storage.objects.write(repo, spec);
    await assert.rejects(materializeEnvironment(storage, repo, envHash), /illegal path|escapes/);
  });

  it('runs every install from the base environment it is given, as it is, as its user and group, with no lifecycle script, and takes the build back',
    { skip: process.platform === 'win32' ? 'the stand-in npm is a shell script' : false }, async () => {
      // An npm that says what it was run with and from, and as whom, and
      // leaves what an install would: a link whose target is not there, and
      // a tool anyone may write that runs as its owner.
      const bin = path.join(tmpDir, 'stand-in-npm');
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\n' +
        'printf \'%s|%s|%s|%s\\n\' "$*" "${E3_TEST_BASE-unset}" "${E3_TEST_PROCESS_ONLY-unset}" "$(id -u):$(id -g)" >> "$E3_TEST_NPM_LOG"\n' +
        'mkdir -p node_modules/.bin\nln -sf ../no-such-tool node_modules/.bin/a-tool\n' +
        'touch node_modules/.bin/another-tool\nchmod 6777 node_modules/.bin/another-tool\n');
      fs.chmodSync(path.join(bin, 'npm'), 0o755);
      const log = path.join(tmpDir, 'stand-in-npm.log');
      const spec = encodeBeast2For(EnvironmentSpecType)(variant('node', {
        packageJson: await storage.objects.write(repo, encodeFile(Buffer.from(JSON.stringify({ name: 'e3-env-stand-in', version: '1.0.0', private: true })))),
        lock: await storage.objects.write(repo, encodeFile(Buffer.from(JSON.stringify({ name: 'e3-env-stand-in', lockfileVersion: 3 })))),
        tarballs: [await storage.objects.write(repo, encodeFile(Buffer.from('a project\'s own package')))],
      }));
      const envHash = await storage.objects.write(repo, spec);
      // As this process's own user and group, which an unprivileged process
      // may give a directory to and take one back from; another-user.spec
      // builds as another, as root.
      const ids = `${process.getuid!()}:${process.getgid!()}`;

      const previous = process.env.E3_TEST_PROCESS_ONLY;
      process.env.E3_TEST_PROCESS_ONLY = 'the process\'s';
      try {
        await materializeEnvironment(storage, repo, envHash, {
          env: { PATH: `${bin}:/usr/bin:/bin`, E3_TEST_BASE: 'the base\'s', E3_TEST_NPM_LOG: log },
          uid: process.getuid!(),
          gid: process.getgid!(),
        });
      } finally {
        if (previous === undefined) delete process.env.E3_TEST_PROCESS_ONLY;
        else process.env.E3_TEST_PROCESS_ONLY = previous;
      }

      const runs = fs.readFileSync(log, 'utf8').trimEnd().split('\n').map((line) => line.split('|'));
      assert.deepStrictEqual(runs.map(([argv]) => argv!.replace(/ \S+\/\.tarballs\//, ' <build>/.tarballs/')), [
        'ci --no-audit --no-fund --ignore-scripts',
        'install --no-save --no-audit --no-fund --ignore-scripts <build>/.tarballs/pack-0.tgz',
      ]);
      for (const [, base, processOnly, as] of runs) {
        assert.deepStrictEqual([base, processOnly, as], ['the base\'s', 'unset', ids], 'from the base environment alone, as its user and group');
      }
      assert.strictEqual(fs.readlinkSync(path.join(repo, 'envs', envHash, 'node_modules', '.bin', 'a-tool')), '../no-such-tool',
        'taken back, a link and all, whatever it names');
      assert.strictEqual(fs.statSync(path.join(repo, 'envs', envHash, 'node_modules', '.bin', 'another-tool')).mode & 0o7777, 0o755,
        'taken back with a mode by which no one else writes it, nor runs as its owner');
    });

  it('takes an environment built for another group back before it is put in place: every file of it is this process\'s', {
    skip: process.getgroups === undefined ? 'POSIX alone: Windows has no group ids'
      : process.getgroups().every((group) => group === process.getgid!()) ? 'needs a group this process is a member of besides its own' : false,
  }, async () => {
    // A group this process is a member of, which it may give the build to; a
    // tools environment runs no install, which only root may start as it.
    // another-user.spec builds one as another user.
    const group = process.getgroups!().find((member) => member !== process.getgid!())!;
    const spec = encodeBeast2For(EnvironmentSpecType)(variant('tools', {
      files: [
        { path: 'bin/a-tool', hash: await storage.objects.write(repo, encodeFile(Buffer.from('#!/bin/sh\necho a group\'s\n'))) },
        { path: 'share/a-file', hash: await storage.objects.write(repo, encodeFile(Buffer.from('DATA'))) },
      ],
    }));
    const envHash = await storage.objects.write(repo, spec);

    await materializeEnvironment(storage, repo, envHash, { gid: group });

    const others: string[] = [];
    const walk = (at: string): void => {
      if (fs.lstatSync(at).gid !== process.getgid!()) others.push(at);
      if (fs.lstatSync(at).isDirectory()) for (const name of fs.readdirSync(at)) walk(path.join(at, name));
    };
    walk(path.join(repo, 'envs', envHash));
    assert.deepStrictEqual(others, []);
  });
});
