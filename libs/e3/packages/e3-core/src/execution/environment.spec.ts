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
import { fileURLToPath } from 'node:url';
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
import { composeEnvironmentOverTier } from '../environment-layer-unpack.js';
import { packEnvironmentLayers } from '../storage/local/environment-layers.js';
import { readTierManifest, recordedSiteFiles } from '../tier-manifest.js';
import {
  decodeEnvironmentFile, environmentFitsTier, EnvironmentTargetRefused, hostEnvironmentPlatform, materializeEnvironment, materializeEnvironmentFor,
  nodeLockFilename,
} from './environment.js';

/** The script a runtime image writes its tier manifest with: the spec runs
 *  from `dist/src/execution`. */
const TIER_MANIFEST_SCRIPT = new URL('../../../../../../../docker/images/tier-manifest.py', import.meta.url);

/** An environment's file, as export stores it: a beast2 Blob of its bytes. */
const encodeFile = encodeBeast2For(BlobType);

/** A captured file of an environment: its original name and its object's hash. */
interface CapturedSdist { filename: string; hash: string }

/**
 * A uv workspace of two members, locked, with its root's manifest and lock and
 * each member's sdist stored as an environment's files (#1654).
 *
 * @remarks
 * Its root lists `six`, which `trainer` alone uses, and `tomli`, which stands
 * for a stock platform package a workspace lists on its root alone;
 * `features` depends on `idna`, and `trainer` on `six` and on `features`.
 *
 * @param dir - Where the workspace is made: an empty directory
 * @param write - Stores a file's bytes, answering its object's hash
 * @returns The hashes of the root's manifest and lock, and the two sdists
 */
async function memberWorkspace(dir: string, write: (bytes: Uint8Array) => Promise<string>):
Promise<{ pyproject: string; lock: string; features: CapturedSdist; trainer: CapturedSdist }> {
  fs.writeFileSync(path.join(dir, 'pyproject.toml'),
    '[project]\nname = "ws-root"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n' +
    'dependencies = ["six", "tomli", "features", "trainer"]\n\n' +
    '[tool.uv.workspace]\nmembers = ["packages/*"]\n\n' +
    '[tool.uv.sources]\nfeatures = { workspace = true }\ntrainer = { workspace = true }\n');
  const member = (name: string, dependencies: string[]): void => {
    const at = path.join(dir, 'packages', name);
    fs.mkdirSync(path.join(at, 'src', name), { recursive: true });
    fs.writeFileSync(path.join(at, 'pyproject.toml'),
      `[project]\nname = "${name}"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n` +
      `dependencies = [${dependencies.map((d) => `"${d}"`).join(', ')}]\n` +
      (dependencies.includes('features') ? '\n[tool.uv.sources]\nfeatures = { workspace = true }\n' : '') +
      '\n[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n');
    fs.writeFileSync(path.join(at, 'src', name, '__init__.py'), `MARKER = "${name}"\n`);
  };
  member('features', ['idna']);
  member('trainer', ['six', 'features']);
  execFileSync('uv', ['lock'], { cwd: dir, stdio: 'ignore' });
  const sdistOf = async (name: string): Promise<CapturedSdist> => {
    const out = path.join(dir, 'dist', name);
    execFileSync('uv', ['build', '--sdist', '--out-dir', out], { cwd: path.join(dir, 'packages', name), stdio: 'ignore' });
    const filename = fs.readdirSync(out).find((f) => f.endsWith('.tar.gz'))!;
    return { filename, hash: await write(fs.readFileSync(path.join(out, filename))) };
  };
  return {
    pyproject: await write(fs.readFileSync(path.join(dir, 'pyproject.toml'))),
    lock: await write(fs.readFileSync(path.join(dir, 'uv.lock'))),
    features: await sdistOf('features'),
    trainer: await sdistOf('trainer'),
  };
}

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
  const hasUv = (() => {
    try { execFileSync('uv', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
  })();

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

  it('materializes a workspace member\'s python env with the member\'s dependencies alone: nothing its workspace\'s root or another member depends on, and the distributions it requires as the lock pins them (#1654)',
    { skip: hasUv ? false : 'uv not on PATH' }, async () => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-py-ws-'));
      try {
        const { pyproject, lock, features, trainer } = await memberWorkspace(ws, (bytes) => storage.objects.write(repo, encodeFile(bytes)));
        /** The modules of the five that an environment built from the spec imports. */
        const imports = async (spec: EnvironmentSpec): Promise<string[]> => {
          const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(spec));
          const [bin] = await materializeEnvironment(storage, repo, envHash);
          const found = execFileSync(path.join(bin!, process.platform === 'win32' ? 'python.exe' : 'python'), ['-c',
            'import importlib.util as u; print(" ".join(n for n in ["features", "idna", "six", "tomli", "trainer"] if u.find_spec(n)))'], { encoding: 'utf-8' });
          return found.trim().split(' ');
        };

        assert.deepStrictEqual(await imports(variant('workspace_python', { pyproject, lock, subjects: ['features'], sdists: [features], requires: ['tomli'] })),
          ['features', 'idna', 'tomli'], 'its own dependency, what it requires, and itself: not the root\'s six, nor trainer');
        assert.deepStrictEqual(await imports(variant('workspace_python', { pyproject, lock, subjects: ['trainer'], sdists: [features, trainer], requires: [] })),
          ['features', 'idna', 'six', 'trainer'], 'a member that depends on another carries it and its dependencies, and not what the root alone lists');
        // The whole lock, as a project that is its own root installs it
        assert.deepStrictEqual(await imports(variant('python', { pyproject, lock, sdists: [features, trainer] })),
          ['features', 'idna', 'six', 'tomli', 'trainer']);

        // Names a spec carries are wire data, given to an install as arguments: refused before anything is installed
        for (const [named, refusal] of [
          [{ subjects: ['--all-packages'], requires: [] }, /the member '--all-packages' is not a package's name/],
          [{ subjects: ['features'], requires: ['tomli --index-url=http://example.invalid'] }, /the required distribution 'tomli --index-url=http:\/\/example\.invalid' is not a package's name/],
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

describe('materializeEnvironmentFor: an environment installed for a platform that is not this machine\'s', () => {
  let tmpDir: string;
  let repo: string;
  const storage = new LocalStorage();
  const posix = process.platform !== 'win32';
  const hasUv = (() => {
    try { execFileSync('uv', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
  })();
  /** This machine's platform, and one that is not: what each test installs for. */
  const host = hostEnvironmentPlatform();
  const foreign = process.platform === 'darwin' ? 'x86_64-manylinux_2_28' : 'aarch64-apple-darwin';

  /** An npm and a pnpm that say what they were run with; the pnpm is one from
   *  before it took a platform's flags. Shell scripts: POSIX alone. */
  let standIns: { env: Record<string, string> };
  let standInLog: string;
  /** What the stand-ins were run with since last asked, a line a run. */
  const standInRuns = (): string[] => {
    if (!fs.existsSync(standInLog)) return [];
    const lines = fs.readFileSync(standInLog, 'utf8').trimEnd().split('\n').map((line) => line.replace(/ \S+\/\.tarballs\//, ' <build>/.tarballs/'));
    fs.rmSync(standInLog);
    return lines;
  };

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-env-target-spec-'));
    repo = path.join(tmpDir, 'repo');
    await repoInit(repo);
    const bin = path.join(tmpDir, 'stand-ins');
    fs.mkdirSync(bin);
    standInLog = path.join(tmpDir, 'stand-ins.log');
    fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nprintf \'npm %s\\n\' "$*" >> "$E3_TEST_LOG"\nmkdir -p node_modules\n');
    fs.writeFileSync(path.join(bin, 'pnpm'), '#!/bin/sh\nprintf \'pnpm %s\\n\' "$*" >> "$E3_TEST_LOG"\n' +
      'case "$*" in *--os=*) echo " ERROR  Unknown options: \'os\', \'cpu\'" >&2; exit 1;; esac\nmkdir -p node_modules\n');
    for (const tool of ['npm', 'pnpm']) fs.chmodSync(path.join(bin, tool), 0o755);
    standIns = { env: { PATH: `${bin}:/usr/bin:/bin`, E3_TEST_LOG: standInLog } };
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** A directory of the test's own, not there yet. */
  let dirs = 0;
  const scratch = (): string => path.join(tmpDir, `tree-${dirs++}`);

  const write = (bytes: Uint8Array): Promise<string> => storage.objects.write(repo, encodeFile(bytes));

  /** A gzipped tar as `npm pack` writes one: its files under `package/`. */
  async function packed(files: Record<string, string>): Promise<Buffer> {
    const zlib = await import('node:zlib');
    const { pack: tarPack } = await import('tar-stream');
    const p = tarPack();
    for (const [name, content] of Object.entries(files)) p.entry({ name: `package/${name}` }, content);
    p.finalize();
    const chunks: Buffer[] = [];
    for await (const c of p) chunks.push(c as Buffer);
    return zlib.gzipSync(Buffer.concat(chunks));
  }

  /** A node environment with no dependencies, and its project's packages. */
  async function nodeEnvironment(tarballs: Buffer[], lock?: Buffer): Promise<string> {
    return storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(variant('node', {
      packageJson: await write(Buffer.from(JSON.stringify({ name: 'e3-env-fixture', version: '1.0.0', private: true }))),
      lock: await write(lock ?? Buffer.from(JSON.stringify({
        name: 'e3-env-fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
        packages: { '': { name: 'e3-env-fixture', version: '1.0.0' } },
      }))),
      tarballs: await Promise.all(tarballs.map(write)),
    })));
  }

  /** Asserts `work` is refused for `reason`, and leaves no directory at `dir`. */
  async function refused(work: Promise<unknown>, reason: string, dir: string): Promise<void> {
    await assert.rejects(work, (err: unknown) => {
      assert.ok(err instanceof EnvironmentTargetRefused, `refused, not failed: ${String(err)}`);
      assert.strictEqual(err.reason, reason);
      return true;
    });
    assert.ok(!fs.existsSync(dir), 'nothing is left where it was to be installed');
  }

  it('names this machine\'s own platform as an environment is installed for one', () => {
    if (process.platform === 'win32') assert.strictEqual(host, null);
    else if (process.platform === 'darwin') assert.match(host ?? '', /^(x86_64|aarch64)-apple-darwin$/);
    else assert.match(host ?? '', /^(x86_64|aarch64)-manylinux_2_(17|28)$/);
  });

  it('refuses an image and a tools environment by their kind, on every machine', async () => {
    const image = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(
      variant('image', { digest: `example.com/img@sha256:${'0'.repeat(64)}` })));
    const tools = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(
      variant('tools', { files: [{ path: 'bin/a-tool', hash: await write(Buffer.from('#!/bin/sh\n')) }] })));
    for (const [envHash, reason] of [[image, 'image'], [tools, 'tools']] as const) {
      const dir = scratch();
      await refused(materializeEnvironmentFor(storage, repo, envHash, { platform: foreign }, dir), reason, dir);
    }
  });

  it('refuses every environment on Windows, whose built environments have another layout',
    { skip: posix ? 'Windows alone' : false }, async () => {
      const dir = scratch();
      await refused(materializeEnvironmentFor(storage, repo, await nodeEnvironment([]), { platform: foreign }, dir), 'windows-host', dir);
    });

  it('fails for a platform no environment is installed for, and for a directory that is not empty, which it leaves alone',
    { skip: posix ? false : 'Windows is refused before either' }, async () => {
      const envHash = await nodeEnvironment([]);
      const dir = scratch();
      await assert.rejects(materializeEnvironmentFor(storage, repo, envHash, { platform: 'sparc-sun-solaris' }, dir),
        /no environment is installed for the platform 'sparc-sun-solaris'/);
      assert.ok(!fs.existsSync(dir));

      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'kept'), 'x');
      await assert.rejects(materializeEnvironmentFor(storage, repo, envHash, { platform: foreign }, dir), /is not empty/);
      assert.deepStrictEqual(fs.readdirSync(dir), ['kept']);
    });

  it('installs a node environment for the platform: its flags on every install, the project\'s own files named, no script run and no scratch left',
    { skip: posix ? false : 'Windows is refused' }, async () => {
      const own = await packed({
        'package.json': JSON.stringify({
          name: 'e3-env-own', version: '1.0.0', main: 'index.js',
          scripts: { postinstall: 'node -e "require(\'node:fs\').writeFileSync(\'postinstall-ran\', \'\')"' },
        }),
        'index.js': 'module.exports.marker = "e3-env-own-ok";\n',
      });
      const dir = scratch();
      const built = await materializeEnvironmentFor(storage, repo, await nodeEnvironment([own]), { platform: foreign }, dir);

      assert.strictEqual(built.dir, dir);
      assert.strictEqual(built.interpreter, null, 'a node environment carries no interpreter');
      assert.deepStrictEqual(built.project.filter((file) => file.startsWith('node_modules/e3-env-own/')),
        ['node_modules/e3-env-own/index.js', 'node_modules/e3-env-own/package.json']);
      assert.ok(!built.project.includes('package.json') && !built.project.includes('package-lock.json'),
        'what its lock names is not the project\'s own');
      assert.deepStrictEqual([...built.project], [...built.project].sort(), 'sorted');
      assert.ok(!fs.existsSync(path.join(dir, '.tarballs')), 'the packed packages are not kept');
      assert.ok(!fs.existsSync(path.join(dir, 'node_modules', 'e3-env-own', 'postinstall-ran')), 'no lifecycle script ran');
      // Plain JavaScript runs anywhere: the tree is whole.
      const out = execFileSync(process.execPath, ['-e', 'console.log(require("e3-env-own").marker)'], { encoding: 'utf-8', cwd: dir });
      assert.match(out, /e3-env-own-ok/);
    });

  it('asks npm for the platform\'s packages on each install, and pnpm only where this machine is not of the platform',
    { skip: posix ? false : 'the stand-ins are shell scripts' }, async () => {
      const own = await packed({ 'package.json': JSON.stringify({ name: 'e3-env-own', version: '1.0.0' }) });

      await materializeEnvironmentFor(storage, repo, await nodeEnvironment([own]), { platform: 'x86_64-manylinux_2_28' }, scratch(), standIns);
      assert.deepStrictEqual(standInRuns(), [
        'npm ci --no-audit --no-fund --ignore-scripts --os=linux --cpu=x64 --libc=glibc',
        'npm install --no-save --no-audit --no-fund --ignore-scripts --os=linux --cpu=x64 --libc=glibc <build>/.tarballs/pack-0.tgz',
      ]);
      await materializeEnvironmentFor(storage, repo, await nodeEnvironment([]), { platform: 'aarch64-apple-darwin' }, scratch(), standIns);
      assert.deepStrictEqual(standInRuns(), ['npm ci --no-audit --no-fund --ignore-scripts --os=darwin --cpu=arm64']);

      // A pnpm lock: this machine's platform needs no flag, and another's is
      // refused where pnpm takes none.
      const pnpmLock = Buffer.from("lockfileVersion: '9.0'\n");
      await materializeEnvironmentFor(storage, repo, await nodeEnvironment([], pnpmLock), { platform: host! }, scratch(), standIns);
      assert.deepStrictEqual(standInRuns(), ['pnpm install --frozen-lockfile --ignore-scripts']);
      const dir = scratch();
      await refused(materializeEnvironmentFor(storage, repo, await nodeEnvironment([], pnpmLock), { platform: foreign }, dir, standIns), 'pnpm', dir);
      const flags = foreign === 'aarch64-apple-darwin' ? '--os=darwin --cpu=arm64' : '--os=linux --cpu=x64 --libc=glibc';
      assert.deepStrictEqual(standInRuns(), [`pnpm install --frozen-lockfile --ignore-scripts ${flags}`], 'asked once, for the platform');
    });

  it('refuses a project package that holds a native addon, by its name, before anything is installed',
    { skip: posix ? false : 'the stand-ins are shell scripts' }, async () => {
      const native = await packed({
        'package.json': JSON.stringify({ name: '@acme/fast', version: '1.0.0', main: 'index.js' }),
        'index.js': 'module.exports = require("./build/Release/fast.node");\n',
        'build/Release/fast.node': 'ELF',
      });
      const dir = scratch();
      await refused(materializeEnvironmentFor(storage, repo, await nodeEnvironment([native]), { platform: foreign }, dir, standIns),
        'native-package:@acme/fast', dir);
      assert.deepStrictEqual(standInRuns(), [], 'no install ran');
    });

  it('installs an npm workspace for the platform, naming its members\' own files, and refuses a member with a native addon by its name',
    { skip: posix ? false : 'Windows is refused' }, async () => {
      // A workspace of two members, one needing the other, locked by npm.
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-nws-target-'));
      try {
        const members = {
          'packages/common': { manifest: { name: '@acme/common', version: '1.0.0', main: 'index.js' }, code: 'module.exports.base = () => 41;\n' },
          'packages/pricing': {
            manifest: { name: '@acme/pricing', version: '1.0.0', main: 'index.js', dependencies: { '@acme/common': '1.0.0' } },
            code: 'module.exports.price = () => require("@acme/common").base() + 1;\n',
          },
        };
        fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'sol-root', version: '1.0.0', private: true, workspaces: ['packages/*'] }));
        for (const [rel, member] of Object.entries(members)) {
          fs.mkdirSync(path.join(ws, rel), { recursive: true });
          fs.writeFileSync(path.join(ws, rel, 'package.json'), JSON.stringify(member.manifest));
          fs.writeFileSync(path.join(ws, rel, 'index.js'), member.code);
        }
        execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ws, stdio: 'ignore' });
        const environment = async (extra: Record<string, string>): Promise<string> =>
          storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(variant('workspace_node', {
            packageJson: await write(fs.readFileSync(path.join(ws, 'package.json'))),
            lock: await write(fs.readFileSync(path.join(ws, 'package-lock.json'))),
            config: none, subject: 'packages/pricing',
            members: await Promise.all(Object.entries(members).map(async ([rel, member]) => ({
              path: rel, name: member.manifest.name,
              tarball: await write(await packed({
                'package.json': JSON.stringify(member.manifest), 'index.js': member.code,
                ...(rel === 'packages/pricing' ? extra : {}),
              })),
            }))),
          })));

        const dir = scratch();
        const built = await materializeEnvironmentFor(storage, repo, await environment({}), { platform: foreign }, dir);
        assert.strictEqual(built.interpreter, null);
        assert.deepStrictEqual([...built.project], [
          'packages/common/index.js', 'packages/common/package.json', 'packages/pricing/index.js', 'packages/pricing/package.json',
        ]);
        const out = execFileSync(process.execPath, ['-e', 'console.log(require("@acme/pricing").price())'], { encoding: 'utf-8', cwd: dir });
        assert.match(out, /42/);

        const refusedDir = scratch();
        await refused(materializeEnvironmentFor(storage, repo, await environment({ 'prebuilt/addon.node': 'ELF' }), { platform: foreign }, refusedDir),
          'native-package:@acme/pricing', refusedDir);
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });

  describe('a python environment', { skip: !posix ? 'Windows is refused' : hasUv ? false : 'uv not on PATH' }, () => {
    /** A flat index of this test's: a dependency with a wheel for each
     *  platform, each wheel naming its own, and one with an sdist alone. */
    let index: string;
    /** The project's own package, pure, as an sdist; and one whose wheel is
     *  this machine's alone, though it compiles nothing. */
    let pureSdist: string;
    let nativeSdist: string;
    let work: string;

    const uv = (args: string[], cwd: string): void => { execFileSync('uv', args, { cwd, stdio: 'ignore' }); };

    /** Builds the sdist of a package of one module. */
    function sdistOf(name: string, extra = '', hook?: string): string {
      const project = path.join(work, `src-${name}`);
      fs.mkdirSync(path.join(project, 'src', name), { recursive: true });
      fs.writeFileSync(path.join(project, 'pyproject.toml'),
        `[project]\nname = "${name}"\nversion = "1.0"\n\n[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n${extra}`);
      fs.writeFileSync(path.join(project, 'src', name, '__init__.py'), `MARKER = "${name}-ok"\n`);
      if (hook !== undefined) fs.writeFileSync(path.join(project, 'hatch_build.py'), hook);
      const dist = path.join(work, `dist-${name}`);
      uv(['build', '--sdist', '--out-dir', dist], project);
      return path.join(dist, fs.readdirSync(dist).find((file) => file.endsWith('.tar.gz'))!);
    }

    /** Locks a project that needs `dependency` from the index, and captures
     *  it with the project's own packages. */
    async function environment(dependency: string, sdists: string[]): Promise<string> {
      const project = fs.mkdtempSync(path.join(work, 'project-'));
      fs.writeFileSync(path.join(project, 'pyproject.toml'),
        '[project]\nname = "e3-target-fixture"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n' +
        `dependencies = ["${dependency}==1.0"]\n\n` +
        `[tool.uv.sources]\n${dependency} = { index = "local" }\n\n` +
        `[[tool.uv.index]]\nname = "local"\nurl = "${index}"\nformat = "flat"\nexplicit = true\n`);
      uv(['lock'], project);
      return storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(variant('python', {
        pyproject: await write(fs.readFileSync(path.join(project, 'pyproject.toml'))),
        lock: await write(fs.readFileSync(path.join(project, 'uv.lock'))),
        sdists: await Promise.all(sdists.map(async (file) => ({ filename: path.basename(file), hash: await write(fs.readFileSync(file)) }))),
      })));
    }

    before(() => {
      work = fs.mkdtempSync(path.join(tmpDir, 'python-'));
      index = path.join(work, 'index');
      fs.mkdirSync(index);
      // A wheel is a zip: one per platform, whose module names the platform
      // it was made for, so what was installed says which was chosen.
      const script = path.join(work, 'wheel.py');
      fs.writeFileSync(script, [
        'import base64, hashlib, sys, zipfile',
        'out, name, version, tag = sys.argv[1:5]',
        'dist = f"{name}-{version}.dist-info"',
        'files = {',
        '    f"{name}/__init__.py": f"PLATFORM = {tag.split(chr(45))[2]!r}\\n".encode(),',
        '    f"{dist}/METADATA": f"Metadata-Version: 2.1\\nName: {name}\\nVersion: {version}\\n".encode(),',
        '    f"{dist}/WHEEL": f"Wheel-Version: 1.0\\nGenerator: e3-test\\nRoot-Is-Purelib: false\\nTag: {tag}\\n".encode(),',
        '}',
        'record = [f"{path},sha256={base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b\'=\').decode()},{len(data)}" for path, data in files.items()]',
        'files[f"{dist}/RECORD"] = ("\\n".join(record + [f"{dist}/RECORD,,"]) + "\\n").encode()',
        'with zipfile.ZipFile(f"{out}/{name}-{version}-{tag}.whl", "w") as archive:',
        '    for path, data in files.items():',
        '        archive.writestr(zipfile.ZipInfo(path, (2020, 1, 1, 0, 0, 0)), data)',
        '',
      ].join('\n'));
      for (const tag of ['manylinux_2_17_x86_64', 'manylinux_2_17_aarch64', 'macosx_11_0_arm64', 'macosx_11_0_x86_64']) {
        uv(['run', '--no-project', 'python', script, index, 'platmark', '1.0', `py3-none-${tag}`], work);
      }
      fs.copyFileSync(sdistOf('sdonly'), path.join(index, 'sdonly-1.0.tar.gz'));
      pureSdist = sdistOf('ownpure');
      nativeSdist = sdistOf('ownnative', '\n[tool.hatch.build.targets.wheel.hooks.custom]\n', [
        'from hatchling.builders.hooks.plugin.interface import BuildHookInterface',
        'class NativeHook(BuildHookInterface):',
        '    def initialize(self, version, build_data):',
        '        build_data["pure_python"] = False',
        '        build_data["infer_tag"] = True',
        '',
      ].join('\n'));
    });

    /** The platform tag a wheel made for `platform` is named with. */
    const tagOf = (platform: string): string => {
      const [arch] = platform.split('-');
      return platform.endsWith('apple-darwin') ? `macosx_11_0_${arch === 'aarch64' ? 'arm64' : 'x86_64'}` : `manylinux_2_17_${arch!}`;
    };

    it('installs a workspace member for a platform with the member\'s dependencies alone, and what it requires (#1654)', async () => {
      const { pyproject, lock, features } = await memberWorkspace(fs.mkdtempSync(path.join(work, 'members-')), write);
      const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(
        variant('workspace_python', { pyproject, lock, subjects: ['features'], sdists: [features], requires: ['tomli'] })));
      const built = await materializeEnvironmentFor(storage, repo, envHash, { platform: host! }, path.join(work, 'member-target'));
      const lib = path.join(built.dir, '.venv', 'lib');
      const installed = fs.readdirSync(path.join(lib, fs.readdirSync(lib)[0]!, 'site-packages'));
      for (const needed of ['features', 'idna', 'tomli']) assert.ok(installed.includes(needed), `${needed} is installed: ${installed.join(', ')}`);
      for (const unused of ['six.py', 'trainer']) assert.ok(!installed.includes(unused), `${unused} is not installed: ${installed.join(', ')}`);
      assert.ok(built.project.length > 0 && built.project.every((file) => /\/site-packages\/features(-0\.1\.0\.dist-info)?\//.test(file)),
        `the project's own files are the member's alone, not what it requires: ${built.project.join(', ')}`);
      assert.strictEqual(built.interpreter, '.python');
    });

    it('builds a workspace member over a tier: what the tier holds the same is left to it, another version of its own ships and wins, and it runs on the tier\'s interpreter (#1655)', async () => {
      const { pyproject, lock, features, trainer } = await memberWorkspace(fs.mkdtempSync(path.join(work, 'tier-members-')), write);
      const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(
        variant('workspace_python', { pyproject, lock, subjects: ['trainer'], sdists: [features, trainer], requires: [] })));
      // The versions the lock pins, by its own words
      const lockText = Buffer.from(decodeEnvironmentFile(await storage.objects.read(repo, lock), lock)).toString('utf8');
      const locked = (name: string): string => new RegExp(`name = "${name}"\\nversion = "([^"]+)"`).exec(lockText)![1]!;

      // A tier: a virtualenv of this machine's, as a runtime image's is one
      // of its system's, holding the idna the lock pins and another six; and
      // a path file of its own, which adds a directory of one module
      const tier = path.join(work, 'tier');
      uv(['venv', tier], work);
      const tierPython = path.join(tier, 'bin', 'python');
      uv(['pip', 'install', '--python', tierPython, `idna==${locked('idna')}`, 'six==1.16.0'], work);
      const manifestFile = path.join(work, 'tier-manifest.json');
      execFileSync(tierPython, [fileURLToPath(TIER_MANIFEST_SCRIPT), manifestFile], { stdio: 'ignore' });
      const manifest = readTierManifest(fs.readFileSync(manifestFile));
      const extra = path.join(work, 'tier-extra');
      fs.mkdirSync(extra);
      fs.writeFileSync(path.join(extra, 'tier_only.py'), 'MARKER = "the tier\'s own path file is read"\n');
      fs.writeFileSync(path.join(manifest.python.site, 'tier-extra.pth'), `${extra}\n`);
      const tierIdna = fs.readFileSync(path.join(manifest.python.site, `idna-${locked('idna')}.dist-info`, 'RECORD'), 'utf8');

      assert.strictEqual(await environmentFitsTier(storage, repo, envHash, manifest), true);
      const dir = scratch();
      const built = await materializeEnvironmentFor(storage, repo, envHash, { platform: host!, over: manifest }, dir);
      assert.deepStrictEqual({ interpreter: built.interpreter, fromTier: built.fromTier }, { interpreter: null, fromTier: 1 });
      assert.ok(!fs.existsSync(path.join(dir, '.python')), 'it carries no interpreter');

      const minor = manifest.python.version.split('.').slice(0, 2).join('.');
      const site = path.join(dir, '.venv', 'lib', `python${minor}`, 'site-packages');
      const installed = fs.readdirSync(site);
      for (const shipped of ['six.py', `six-${locked('six')}.dist-info`, 'features', 'trainer', 'zzz_e3_tier.pth']) {
        assert.ok(installed.includes(shipped), `${shipped} ships: ${installed.join(', ')}`);
      }
      assert.ok(!installed.some((name) => name === 'idna' || name.startsWith('idna-')), `idna is left to the tier: ${installed.join(', ')}`);
      assert.ok(built.project.length > 0 && built.project.every((file) => /\/site-packages\/(features|trainer)(-0\.1\.0\.dist-info)?\//.test(file)),
        `the project's own files are its members': ${built.project.join(', ')}`);

      // The virtualenv names the tier's base interpreter, and holds no link
      // out of the tree: it packs, with no interpreter layer
      const config = fs.readFileSync(path.join(dir, '.venv', 'pyvenv.cfg'), 'utf8');
      assert.match(config, new RegExp(`^home = ${path.dirname(manifest.python.base).replaceAll('.', '\\.')}$`, 'm'));
      assert.match(config, new RegExp(`^version_info = ${manifest.python.version.replaceAll('.', '\\.')}$`, 'm'));
      const bin = path.join(dir, '.venv', 'bin');
      assert.ok(!fs.readdirSync(bin).includes('python'), 'the link to this machine\'s interpreter is gone');
      // A script of what was left to the tier stays, to run on the environment's interpreter
      for (const { file } of recordedSiteFiles(tierIdna.replaceAll('../../../bin/', 'bin/')).filter((row) => row.file.startsWith('bin/'))) {
        assert.ok(fs.existsSync(path.join(dir, '.venv', file)), `${file} stays`);
      }
      const packed = await packEnvironmentLayers(repo, built);
      assert.ok(packed.layers.length >= 2, 'its packages and its project');

      // Composed over the tier, it runs: its own first, then the tier's
      await composeEnvironmentOverTier(dir, manifest.python.base);
      const out = execFileSync(path.join(bin, 'python'), ['-c', [
        'import sys, six, idna, trainer, features, tier_only',
        'from importlib.metadata import version',
        'print(six.__version__, six.__file__)',
        'print(version("idna"), idna.__file__)',
        'print(trainer.MARKER, features.MARKER, sys.prefix)',
        'print(tier_only.MARKER)',
      ].join('\n')], { encoding: 'utf-8', cwd: os.tmpdir() }).trim().split('\n');
      assert.deepStrictEqual(out[0], `${locked('six')} ${path.join(site, 'six.py')}`, 'its own six, not the tier\'s 1.16.0');
      assert.deepStrictEqual(out[1], `${locked('idna')} ${path.join(fs.realpathSync(manifest.python.site), 'idna', '__init__.py')}`, 'the tier\'s idna');
      assert.deepStrictEqual(out[2], `trainer features ${path.join(dir, '.venv')}`);
      assert.deepStrictEqual(out[3], 'the tier\'s own path file is read');
    });

    it('builds over a tier only an environment that fits it: a python environment whose lock takes the tier\'s Python', async () => {
      const { pyproject, lock, features } = await memberWorkspace(fs.mkdtempSync(path.join(work, 'fit-members-')), write);
      const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(
        variant('workspace_python', { pyproject, lock, subjects: ['features'], sdists: [features], requires: [] })));
      const python = { executable: '/opt/venv/bin/python', base: '/usr/bin/python3', site: '/opt/venv/lib/python3.9/site-packages' };
      // The workspace's lock takes Python 3.11 and later
      const old = { version: 1 as const, python: { ...python, version: '3.9.2' }, distributions: [] };
      assert.strictEqual(await environmentFitsTier(storage, repo, envHash, old), false);
      assert.strictEqual(await environmentFitsTier(storage, repo, envHash, { ...old, python: { ...python, version: '3.11.2' } }), true);
      const dir = scratch();
      await assert.rejects(() => materializeEnvironmentFor(storage, repo, envHash, { platform: host!, over: old }, dir),
        /is not built over a tier of Python 3\.9\.2: a python environment whose lock takes that Python is/);
      assert.ok(!fs.existsSync(dir), 'nothing was installed');
      const node = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(variant('node', { packageJson: pyproject, lock, tarballs: [] })));
      assert.strictEqual(await environmentFitsTier(storage, repo, node, { ...old, python: { ...python, version: '3.11.2' } }), false);
    });

    for (const [what, platform] of [['this machine\'s own platform, and runs once moved', host], ['another platform', foreign]] as const) {
      it(`installs for ${what}: the platform's wheels, the project's own files named, an interpreter of its own, and no path of this machine`, async () => {
        const dir = scratch();
        const built = await materializeEnvironmentFor(storage, repo, await environment('platmark', [pureSdist]), { platform: platform! }, dir);

        const lib = path.join(dir, '.venv', 'lib');
        const [python] = fs.readdirSync(lib);
        const site = path.join(lib, python!, 'site-packages');
        assert.strictEqual(fs.readFileSync(path.join(site, 'platmark', '__init__.py'), 'utf8'), `PLATFORM = '${tagOf(platform!)}'\n`,
          'the wheel of the platform it is installed for');

        const rel = `.venv/lib/${python!}/site-packages`;
        assert.ok(built.project.includes(`${rel}/ownpure/__init__.py`), 'the project\'s own package is named');
        assert.ok(built.project.every((file) => file.startsWith(`${rel}/ownpure`)), `only the project's own package is: ${built.project.join(', ')}`);
        for (const left of ['.sdists', '.wheels']) assert.ok(!fs.existsSync(path.join(dir, left)), `${left} is not kept`);

        // The interpreter: the platform's build of the virtualenv's Python,
        // alone in its directory, and reached by a relative link.
        assert.strictEqual(built.interpreter, '.python');
        const [installed, ...others] = fs.readdirSync(path.join(dir, '.python'));
        assert.deepStrictEqual(others, [], 'uv\'s own files beside it are gone');
        const build = platform!.endsWith('apple-darwin') ? 'macos' : 'linux';
        assert.match(installed!, new RegExp(`^cpython-${python!.slice('python'.length).replace('.', '\\.')}\\.\\d+-${build}-${platform!.split('-')[0]!}-`));
        assert.strictEqual(fs.readlinkSync(path.join(dir, '.venv', 'bin', 'python')), `../../.python/${installed!}/bin/${python!}`);
        const config = fs.readFileSync(path.join(dir, '.venv', 'pyvenv.cfg'), 'utf8');
        assert.match(config, new RegExp(`^home = \\.\\./\\.python/${installed!.replaceAll('.', '\\.')}/bin$`, 'm'));
        assert.ok(!config.includes(os.homedir()) && !config.includes(tmpDir), 'its configuration names no path of this machine');

        if (platform !== host) return;
        // Put somewhere else, and reached through a link as a guest reaches
        // it, it runs on the interpreter it carries.
        const moved = path.join(tmpDir, 'moved');
        fs.renameSync(dir, moved);
        const link = path.join(tmpDir, 'linked');
        fs.symlinkSync(moved, link);
        const out = execFileSync(path.join(link, '.venv', 'bin', 'python'),
          ['-c', 'import sys, ownpure, platmark; print(ownpure.MARKER, platmark.PLATFORM, sys.base_prefix)'], { encoding: 'utf-8', cwd: os.tmpdir() });
        const [marker, tag, base] = out.trim().split(' ');
        assert.deepStrictEqual([marker, tag], ['ownpure-ok', tagOf(host!)]);
        assert.strictEqual(fs.realpathSync(base!), fs.realpathSync(path.join(moved, '.python', installed!)), 'on its own interpreter');
      });
    }

    it('refuses a dependency with no wheel for the platform, by its name, where a build for this machine would compile it', async () => {
      const dir = scratch();
      await refused(materializeEnvironmentFor(storage, repo, await environment('sdonly', []), { platform: foreign }, dir), 'no-wheel:sdonly', dir);
    });

    it('refuses a project package whose wheel is this machine\'s alone, by its name, even for this machine\'s own platform', async () => {
      for (const platform of [host!, foreign]) {
        const dir = scratch();
        await refused(materializeEnvironmentFor(storage, repo, await environment('platmark', [pureSdist, nativeSdist]), { platform }, dir),
          'native-package:ownnative', dir);
      }
    });
  });
});
