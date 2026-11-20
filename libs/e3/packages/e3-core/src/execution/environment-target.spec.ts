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
import { encodeBeast2For, variant, none } from '@elaraai/east';
import { canonicalPythonName } from '@elaraai/e3';
import { EnvironmentSpecType } from '@elaraai/e3-types';
import { LocalStorage } from '../storage/local/index.js';
import { repoInit } from '../storage/local/repository.js';
import { composeEnvironmentOverTier } from '../environment-layer-unpack.js';
import { tierManifestOf, uvOnPath } from '../test-helpers.js';
import { packEnvironmentLayers } from '../storage/local/environment-layers.js';
import { readTierManifest, recordedSiteFiles } from '../tier-manifest.js';
import { decodeEnvironmentFile, environmentFitsTier, EnvironmentTargetRefused, hostEnvironmentPlatform, materializeEnvironmentFor } from './environment.js';
import { sharedInstall } from './environment-build.js';
import { encodeFile, memberWorkspace, writeWheel } from './environment.test-utils.js';

describe('materializeEnvironmentFor: an environment installed for a platform that is not this machine\'s', () => {
  let tmpDir: string;
  let repo: string;
  const storage = new LocalStorage();
  const posix = process.platform !== 'win32';
  const hasUv = uvOnPath();
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
      // One wheel per platform, whose module names the platform it was made for
      for (const tag of ['manylinux_2_17_x86_64', 'manylinux_2_17_aarch64', 'macosx_11_0_arm64', 'macosx_11_0_x86_64']) {
        writeWheel(index, 'platmark', '1.0', `py3-none-${tag}`);
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

    it('builds a workspace member over a tier: what the tier holds the same is left to it, another version of its own ships and wins, a namespace package is split between the two, and it runs on the tier\'s interpreter (#1655)', async () => {
      const { pyproject, lock, features, trainer } = await memberWorkspace(fs.mkdtempSync(path.join(work, 'tier-members-')), write);
      const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(
        variant('workspace_python', { pyproject, lock, subjects: ['trainer'], sdists: [features, trainer], requires: [] })));
      // The versions the lock pins, by its own words
      const lockText = Buffer.from(decodeEnvironmentFile(await storage.objects.read(repo, lock), lock)).toString('utf8');
      const locked = (name: string): string => new RegExp(`name = "${name}"\\nversion = "([^"]+)"`).exec(lockText)![1]!;

      // A tier: a virtualenv of this machine's, as a runtime image's is one
      // of its system's, holding the idna the lock pins and another six; of
      // the two that share the namespace package `jaraco`, the one the lock
      // pins and another version of the other; a tomli, which the lock pins
      // for the workspace's root and this member never installs; and a path
      // file no distribution installed, which adds a directory of one module
      const tier = path.join(work, 'tier');
      // Made as an image makes its own: by the interpreter itself (`python3 -m venv /opt/venv`)
      const system = execFileSync('uv', ['python', 'find'], { encoding: 'utf-8', cwd: work }).trim();
      execFileSync(system, ['-m', 'venv', '--without-pip', tier], { stdio: 'ignore' });
      const tierPython = path.join(tier, 'bin', 'python');
      uv(['pip', 'install', '--python', tierPython, `idna==${locked('idna')}`, 'six==1.16.0', `tomli==${locked('tomli')}`,
        `jaraco.classes==${locked('jaraco-classes')}`, `more-itertools==${locked('more-itertools')}`, 'jaraco.functools==4.0.0'], work);
      assert.notStrictEqual(locked('jaraco-functools'), '4.0.0', 'the lock pins another than the tier holds');
      const manifest = readTierManifest(Buffer.from(tierManifestOf(tierPython)));
      const held = manifest.python!;
      assert.ok(held.namespaces.includes('jaraco'), `the tier names its namespace packages: ${held.namespaces.join(', ')}`);
      const extra = path.join(work, 'tier-extra');
      fs.mkdirSync(extra);
      fs.writeFileSync(path.join(extra, 'tier_only.py'), 'MARKER = "a path file of no distribution left to the tier is read"\n');
      fs.writeFileSync(path.join(held.site, 'tier-extra.pth'), `${extra}\n`);
      const tierIdna = fs.readFileSync(path.join(held.site, `idna-${locked('idna')}.dist-info`, 'RECORD'), 'utf8');

      assert.strictEqual(await environmentFitsTier(storage, repo, envHash, manifest), true);
      const dir = scratch();
      const built = await materializeEnvironmentFor(storage, repo, envHash, { platform: host!, over: manifest }, dir);
      // Left to the tier: idna, and of the namespace package's two, the one the tier holds, with what both depend on
      assert.deepStrictEqual({ interpreter: built.interpreter, fromTier: built.fromTier }, { interpreter: null, fromTier: 3 });
      assert.ok(!fs.existsSync(path.join(dir, '.python')), 'it carries no interpreter');

      const minor = held.version.split('.').slice(0, 2).join('.');
      const site = path.join(dir, '.venv', 'lib', `python${minor}`, 'site-packages');
      const installed = fs.readdirSync(site);
      for (const shipped of ['six.py', `six-${locked('six')}.dist-info`, 'features', 'trainer', 'zzz_e3_tier.pth', '_e3_tier.py']) {
        assert.ok(installed.includes(shipped), `${shipped} ships: ${installed.join(', ')}`);
      }
      assert.ok(!installed.includes('idna'), `idna's code is left to the tier: ${installed.join(', ')}`);
      // A namespace package's parts are left singly: the tier's build of one stays there, the other ships
      assert.deepStrictEqual(fs.readdirSync(path.join(site, 'jaraco')), ['functools'], 'jaraco.classes is left to the tier, jaraco.functools ships');
      // Each keeps its metadata, which says it is installed to whatever lists
      // what is: by its name as PEP 503 writes it, whatever its wheel spells
      const metadata = new Set(installed.flatMap((entry) => {
        const named = /^(.+)-([^-]+)\.dist-info$/.exec(entry);
        return named === null ? [] : [`${canonicalPythonName(named[1]!)} ${named[2]!}`];
      }));
      for (const name of ['idna', 'jaraco-classes', 'jaraco-functools']) {
        assert.ok(metadata.has(`${name} ${locked(name)}`), `${name} ${locked(name)} keeps its metadata: ${installed.join(', ')}`);
      }
      assert.ok(!installed.includes('more_itertools'), 'what both depend on is the tier\'s');
      assert.ok(built.project.length > 0 && built.project.every((file) => /\/site-packages\/(features|trainer)(-0\.1\.0\.dist-info)?\//.test(file)),
        `the project's own files are its members': ${built.project.join(', ')}`);

      // The virtualenv names the tier's base interpreter, and holds no link
      // out of the tree: it packs, with no interpreter layer
      const config = fs.readFileSync(path.join(dir, '.venv', 'pyvenv.cfg'), 'utf8');
      assert.match(config, new RegExp(`^home = ${path.dirname(held.base).replaceAll('.', '\\.')}$`, 'm'));
      assert.match(config, new RegExp(`^version_info = ${held.version.replaceAll('.', '\\.')}$`, 'm'));
      const bin = path.join(dir, '.venv', 'bin');
      assert.ok(!fs.readdirSync(bin).includes('python'), 'the link to this machine\'s interpreter is gone');
      // A script of what was left to the tier stays, to run on the environment's interpreter
      for (const { file } of recordedSiteFiles(tierIdna.replaceAll('../../../bin/', 'bin/')).filter((row) => row.file.startsWith('bin/'))) {
        assert.ok(fs.existsSync(path.join(dir, '.venv', file)), `${file} stays`);
      }
      const packed = await packEnvironmentLayers(repo, built);
      assert.ok(packed.layers.length >= 2, 'its packages and its project');

      // Composed over the tier, it runs: its own first, then what it left to
      // the tier, and nothing else of the tier's
      await composeEnvironmentOverTier(dir, manifest);
      const out = execFileSync(path.join(bin, 'python'), ['-c', [
        'import sys, six, idna, trainer, features',
        'import jaraco.classes.properties, jaraco.functools',
        'from importlib.metadata import PackageNotFoundError, distributions, version',
        'def imported(name):',
        '    try:',
        '        __import__(name)',
        '    except ModuleNotFoundError:',
        '        return "absent"',
        '    return "imported"',
        'def listed(name):',
        '    try:',
        '        version(name)',
        '    except PackageNotFoundError:',
        '        return "unlisted"',
        '    return "listed"',
        'print(six.__version__, six.__file__)',
        'print(version("idna"), idna.__file__)',
        'print(trainer.MARKER, features.MARKER, sys.prefix)',
        'print(imported("tier_only"), imported("tomli"), listed("tomli"), ' + JSON.stringify(held.site) + ' in sys.path)',
        'print(version("jaraco.classes"), jaraco.classes.properties.__file__)',
        'print(version("jaraco.functools"), jaraco.functools.__file__)',
        // What a scan of the path finds, as pkg_resources's does
        'print(" ".join(sorted(d.metadata["Name"] for d in distributions(path=sys.path) if d.metadata["Name"] in ("idna", "jaraco.classes", "tomli"))))',
      ].join('\n')], { encoding: 'utf-8', cwd: os.tmpdir() }).trim().split('\n');
      // Each path as the file it is, whatever links lead to this machine's temporary directory
      const found = (line: string): [string, string] => {
        const [said, at] = [line.slice(0, line.lastIndexOf(' ')), line.slice(line.lastIndexOf(' ') + 1)];
        return [said, fs.realpathSync(at)];
      };
      assert.deepStrictEqual(found(out[0]!), [locked('six'), fs.realpathSync(path.join(site, 'six.py'))], 'its own six, not the tier\'s 1.16.0');
      assert.deepStrictEqual(found(out[1]!), [locked('idna'), fs.realpathSync(path.join(held.site, 'idna', '__init__.py'))], 'the tier\'s idna');
      assert.deepStrictEqual(found(out[2]!), ['trainer features', fs.realpathSync(path.join(dir, '.venv'))]);
      assert.deepStrictEqual(out[3], 'absent absent unlisted False',
        'the tier\'s site directory is not on the path: what the lock never installed, and a path file of no distribution left to the tier, are neither imported nor listed');
      // One namespace package, read from both: the tier's part, and this environment's own, not the tier's 4.0.0
      assert.deepStrictEqual(found(out[4]!), [locked('jaraco-classes'), fs.realpathSync(path.join(held.site, 'jaraco', 'classes', 'properties.py'))]);
      assert.deepStrictEqual(found(out[5]!), [locked('jaraco-functools'), fs.realpathSync(path.join(site, 'jaraco', 'functools', '__init__.py'))]);
      assert.strictEqual(out[6], 'idna jaraco.classes', 'a scan of the path finds what was left to the tier, and not what the lock never installed');
    });

    it('builds over a tier whose package of the name of a namespace package the environment ships is an ordinary one, and imports the parts it ships, which the tier\'s would hide on its path', async () => {
      const { pyproject, lock, features, trainer } = await memberWorkspace(fs.mkdtempSync(path.join(work, 'hidden-members-')), write);
      const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(
        variant('workspace_python', { pyproject, lock, subjects: ['trainer'], sdists: [features, trainer], requires: [] })));
      // A tier whose `jaraco` has an `__init__` module, and which holds neither of the two the environment installs in it
      const tier = path.join(work, 'hidden-tier');
      const system = execFileSync('uv', ['python', 'find'], { encoding: 'utf-8', cwd: work }).trim();
      execFileSync(system, ['-m', 'venv', '--without-pip', tier], { stdio: 'ignore' });
      const tierPython = path.join(tier, 'bin', 'python');
      const tierSite = readTierManifest(Buffer.from(tierManifestOf(tierPython))).python!.site;
      fs.mkdirSync(path.join(tierSite, 'jaraco'));
      fs.writeFileSync(path.join(tierSite, 'jaraco', '__init__.py'), 'raise ImportError("the tier\'s jaraco")\n');
      const manifest = readTierManifest(Buffer.from(tierManifestOf(tierPython)));
      assert.ok(!manifest.python!.namespaces.includes('jaraco'), manifest.python!.namespaces.join(', '));

      const dir = scratch();
      await materializeEnvironmentFor(storage, repo, envHash, { platform: host!, over: manifest }, dir);
      await composeEnvironmentOverTier(dir, manifest);
      const minor = manifest.python!.version.split('.').slice(0, 2).join('.');
      const site = path.join(dir, '.venv', 'lib', `python${minor}`, 'site-packages');
      const out = execFileSync(path.join(dir, '.venv', 'bin', 'python'), ['-c', 'import jaraco.classes, jaraco.functools; print(jaraco.classes.__file__); print(jaraco.functools.__file__)'],
        { encoding: 'utf-8', cwd: os.tmpdir() }).trim().split('\n').map((at) => fs.realpathSync(at));
      assert.deepStrictEqual(out, ['classes', 'functools'].map((part) => fs.realpathSync(path.join(site, 'jaraco', part, '__init__.py'))));
    });

    it('takes from the site directory the bytecode uv compiled of each module it leaves to the tier, which no record lists', async () => {
      const { pyproject, lock, features, trainer } = await memberWorkspace(fs.mkdtempSync(path.join(work, 'bytecode-members-')), write);
      const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(
        variant('workspace_python', { pyproject, lock, subjects: ['trainer'], sdists: [features, trainer], requires: [] })));
      const lockText = Buffer.from(decodeEnvironmentFile(await storage.objects.read(repo, lock), lock)).toString('utf8');
      const locked = (name: string): string => new RegExp(`name = "${name}"\\nversion = "([^"]+)"`).exec(lockText)![1]!;
      // A tier that holds the idna and jaraco.classes the lock pins
      const tier = path.join(work, 'bytecode-tier');
      const system = execFileSync('uv', ['python', 'find'], { encoding: 'utf-8', cwd: work }).trim();
      execFileSync(system, ['-m', 'venv', '--without-pip', tier], { stdio: 'ignore' });
      const tierPython = path.join(tier, 'bin', 'python');
      uv(['pip', 'install', '--python', tierPython, `idna==${locked('idna')}`, `jaraco.classes==${locked('jaraco-classes')}`,
        `more-itertools==${locked('more-itertools')}`], work);
      const manifest = readTierManifest(Buffer.from(tierManifestOf(tierPython)));

      // Built as a machine that has uv compile what it installs builds it
      const dir = scratch();
      const built = await materializeEnvironmentFor(storage, repo, envHash, { platform: host!, over: manifest }, dir,
        { env: { ...process.env, UV_COMPILE_BYTECODE: '1' } });
      assert.strictEqual(built.fromTier, 3);
      const minor = manifest.python!.version.split('.').slice(0, 2).join('.');
      const site = path.join(dir, '.venv', 'lib', `python${minor}`, 'site-packages');
      for (const left of ['idna', path.join('jaraco', 'classes'), 'more_itertools']) {
        assert.ok(!fs.existsSync(path.join(site, left)), `${left}, left to the tier, keeps no compiled file here`);
      }
      assert.ok(fs.readdirSync(path.join(site, 'jaraco', 'functools', '__pycache__')).some((name) => name.endsWith('.pyc')), 'what ships keeps what uv compiled of it');
    });

    it('builds over a tier only an environment that fits it: a python environment whose lock takes the tier\'s Python', async () => {
      const { pyproject, lock, features } = await memberWorkspace(fs.mkdtempSync(path.join(work, 'fit-members-')), write);
      const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(
        variant('workspace_python', { pyproject, lock, subjects: ['features'], sdists: [features], requires: [] })));
      const python = { executable: '/opt/venv/bin/python', base: '/usr/bin/python3', site: '/opt/venv/lib/python3.9/site-packages', namespaces: [], distributions: [] };
      // The workspace's lock takes Python 3.11 and later
      const old = { python: { ...python, version: '3.9.2' } };
      const fits = { python: { ...python, version: '3.11.2' } };
      assert.strictEqual(await environmentFitsTier(storage, repo, envHash, old), false);
      assert.strictEqual(await environmentFitsTier(storage, repo, envHash, fits), true);
      // A tier whose image holds no Python, a node image's
      const nodeTier = { node: { version: '22.12.0', root: '/usr/local/lib/node_modules', registry: 'https://registry.npmjs.org/', packages: [] } };
      assert.strictEqual(await environmentFitsTier(storage, repo, envHash, nodeTier), false);
      const dir = scratch();
      await assert.rejects(() => materializeEnvironmentFor(storage, repo, envHash, { platform: host!, over: old }, dir),
        /does not fit the tier it is asked to be built over: a python environment whose lock takes the tier's Python does/);
      assert.ok(!fs.existsSync(dir), 'nothing was installed');
      // A node environment fits a tier that holds Node, when npm locked it; pnpm lays its tree out otherwise
      const node = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(variant('node', {
        packageJson: pyproject, lock: await write(Buffer.from('{"lockfileVersion":3,"packages":{}}')), tarballs: [] })));
      assert.strictEqual(await environmentFitsTier(storage, repo, node, fits), false);
      assert.strictEqual(await environmentFitsTier(storage, repo, node, nodeTier), true);
      const pnpm = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(variant('node', {
        packageJson: pyproject, lock: await write(Buffer.from("lockfileVersion: '9.0'\n")), tarballs: [] })));
      assert.strictEqual(await environmentFitsTier(storage, repo, pnpm, nodeTier), false);
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

describe('the install the builds over tiers of one Python share', () => {
  it('is installed once for the builds that run together, each given its own copy, links as written, and kept by none once the last has copied it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-shared-install-'));
    try {
      const dirs = ['a', 'b', 'c'].map((name) => path.join(root, name));
      for (const dir of dirs) fs.mkdirSync(dir);
      let installs = 0;
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const install = async (dir: string): Promise<string[]> => {
        installs++;
        fs.writeFileSync(path.join(dir, 'installed.py'), 'MARKER = 1\n');
        fs.symlinkSync('installed.py', path.join(dir, 'link.py'));
        await held;
        return ['installed.py'];
      };
      // Two builds over two tiers, together: the second finds the first's install under way
      const together = Promise.all([sharedInstall('k', dirs[0]!, {}, install), sharedInstall('k', dirs[1]!, {}, install)]);
      release();
      assert.deepStrictEqual(await together, [['installed.py'], ['installed.py']]);
      assert.strictEqual(installs, 1, 'installed once');
      for (const dir of dirs.slice(0, 2)) {
        assert.strictEqual(fs.readFileSync(path.join(dir, 'installed.py'), 'utf8'), 'MARKER = 1\n');
        assert.strictEqual(fs.readlinkSync(path.join(dir, 'link.py')), 'installed.py', 'a link as it is written');
      }
      fs.writeFileSync(path.join(dirs[0]!, 'installed.py'), 'MARKER = 2\n');
      assert.strictEqual(fs.readFileSync(path.join(dirs[1]!, 'installed.py'), 'utf8'), 'MARKER = 1\n', 'each its own copy');
      assert.deepStrictEqual(fs.readdirSync(root).sort(), ['a', 'b', 'c'], 'no install is kept');

      // A build that starts after is one of its own; one that fails fails every build sharing it, and keeps nothing
      await sharedInstall('k', dirs[2]!, {}, install);
      assert.strictEqual(installs, 2);
      const failing = (): Promise<string[]> => Promise.reject(new Error('the sync failed'));
      const failed = await Promise.allSettled([sharedInstall('f', dirs[0]!, {}, failing), sharedInstall('f', dirs[1]!, {}, failing)]);
      assert.deepStrictEqual(failed.map((end) => end.status === 'rejected' ? (end.reason as Error).message : end.status), ['the sync failed', 'the sync failed']);
      assert.deepStrictEqual(fs.readdirSync(root).sort(), ['a', 'b', 'c'], 'once the last has found it failed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
