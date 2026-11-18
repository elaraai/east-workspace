/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Python (uv) dependency-closure capture (#278) — the granularity contract.
 *
 * Builds a real uv workspace and asserts that capturing a member takes
 * exactly its transitive LOCAL closure, and — the point of the whole epic —
 * that editing a sibling *outside* that closure leaves the member's env
 * spec byte-identical (no cross-invalidation), while editing a shared
 * dependency changes it.
 *
 * uv-gated: self-skips where uv is unavailable, matching the integration
 * e2e. (Sdist builds fetch the hatchling backend; CI has network.)
 */

import { describe, it, before } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { decodeBeast2For } from '@elaraai/east';
import { EnvironmentSpecType } from '@elaraai/e3-types';
import { captureEnvironment, captureAutoEnvironment, canonicalPythonName, pythonLeftOut, pythonRequires, type BuiltSdists, type UvLock, type UvLockPackage } from './environment-capture.js';
import { pythonClosure } from './environment-uv-lock.js';

function toolAvailable(cmd: string): boolean {
  try { execFileSync(cmd, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }); return true; } catch { return false; }
}

/**
 * Writes a python project that hatchling builds, with an empty package of its
 * import name: its manifest names what it depends on.
 *
 * @param dir - The project's directory
 * @param name - Its name
 * @param version - Its version
 * @param deps - What it depends on
 * @param more - More of its manifest, written before its build system
 */
function hatchlingProject(dir: string, name: string, version: string, deps: readonly string[], more = ''): void {
  const module = canonicalPythonName(name).replaceAll('-', '_');
  fs.mkdirSync(path.join(dir, 'src', module), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pyproject.toml'),
    `[project]\nname = "${name}"\nversion = "${version}"\nrequires-python = ">=3.11"\ndependencies = [${deps.map((d) => `"${d}"`).join(', ')}]\n` + more +
    '\n[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n');
  fs.writeFileSync(path.join(dir, 'src', module, '__init__.py'), '');
}

/** Capture a workspace member's env and return its sorted sdist filenames,
 *  the members it is of, and its spec-bytes sha. */
function capture(project: string): { sdists: string[]; subjects: string[]; specHash: string } {
  const specBytes = captureEnvironment(
    { python: { project } }, 'test',
    (buf) => createHash('sha256').update(buf).digest('hex'),
  );
  const spec = decodeBeast2For(EnvironmentSpecType)(specBytes);
  assert.ok(spec.type === 'workspace_python', 'a workspace member names itself');
  return {
    sdists: spec.value.sdists.map((s) => s.filename.replace(/-0\.1\.0\.tar\.gz$/, '')).sort(),
    subjects: spec.value.subjects,
    specHash: createHash('sha256').update(specBytes).digest('hex'),
  };
}

describe('python closure capture (#278)', () => {
  const hasUv = toolAvailable('uv');
  let ws: string;

  before(() => {
    if (!hasUv) return;
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-cap-ws-'));
    // A uv workspace: common (leaf) ← pricing; `other` is an unrelated
    // sibling NOT in pricing's closure. All hatchling → deterministic sdists.
    fs.writeFileSync(path.join(ws, 'pyproject.toml'),
      '[project]\nname = "root"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n\n' +
      '[tool.uv.workspace]\nmembers = ["packages/*"]\n\n' +
      '[tool.uv.sources]\ncommon = { workspace = true }\n');
    const mkMember = (name: string, deps: string[], src = 'sources = {}') => {
      const dir = path.join(ws, 'packages', name);
      fs.mkdirSync(path.join(dir, 'src', name), { recursive: true });
      fs.writeFileSync(path.join(dir, 'pyproject.toml'),
        `[project]\nname = "${name}"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n` +
        (deps.length ? `dependencies = [${deps.map((d) => `"${d}"`).join(', ')}]\n` : '') +
        (deps.includes('common') ? '\n[tool.uv.sources]\ncommon = { workspace = true }\n' : '') +
        '\n[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n');
      fs.writeFileSync(path.join(dir, 'src', name, '__init__.py'), `VALUE = "${name}-v1"\n`);
      void src;
    };
    mkMember('common', []);
    mkMember('pricing', ['common']);
    mkMember('other', []);
    // Underscore-named member (#391): platform packages are import targets, so
    // real projects name them `sim_engine`; uv.lock stores the PEP 503
    // canonical `sim-engine`.
    mkMember('sim_engine', ['common']);
    execFileSync('uv', ['lock'], { cwd: ws, stdio: 'ignore', shell: process.platform === 'win32' });
  });

  it('captures exactly the transitive local closure of a member',
    { skip: hasUv ? false : 'uv not on PATH' }, () => {
      assert.deepStrictEqual(capture(path.join(ws, 'packages', 'pricing')).sdists, ['common', 'pricing']);
      assert.deepStrictEqual(capture(path.join(ws, 'packages', 'common')).sdists, ['common']);
      assert.deepStrictEqual(capture(path.join(ws, 'packages', 'other')).sdists, ['other']);
    });

  it('names the member a workspace environment is of, so only its dependencies are installed, and leaves a project that is its own root a python spec (#1654)',
    { skip: hasUv ? false : 'uv not on PATH' }, () => {
      assert.deepStrictEqual(capture(path.join(ws, 'packages', 'pricing')).subjects, ['pricing'], 'the member, not the local packages it depends on');
      const alone = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-cap-alone-'));
      try {
        fs.mkdirSync(path.join(alone, 'src', 'alone'), { recursive: true });
        fs.writeFileSync(path.join(alone, 'pyproject.toml'),
          '[project]\nname = "alone"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n\n[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n');
        fs.writeFileSync(path.join(alone, 'src', 'alone', '__init__.py'), 'VALUE = 1\n');
        execFileSync('uv', ['lock'], { cwd: alone, stdio: 'ignore', shell: process.platform === 'win32' });
        const spec = decodeBeast2For(EnvironmentSpecType)(captureEnvironment({ python: { project: alone } }, 'test',
          (buf) => createHash('sha256').update(buf).digest('hex'), undefined, ['east-py-std']));
        assert.ok(spec.type === 'python', 'its lock is all its own');
        assert.deepStrictEqual(spec.value.sdists.map((s) => s.filename), ['alone-0.1.0.tar.gz']);
      } finally { fs.rmSync(alone, { recursive: true, force: true }); }
    });

  it('requires the runtime and the stock platform distributions a runner names, as the lock holds them from a registry', () => {
    const registry = { registry: 'https://pypi.org/simple' };
    const lock = { version: 1, package: [
      { name: 'elaraai-east-py', source: registry },
      { name: 'elaraai-east-py-cli', source: registry },
      { name: 'elaraai-east-py-std', source: registry },
      { name: 'elaraai-east-py-datascience', source: registry },
      // Held as a local package: it rides as an sdist, when a member depends on it
      { name: 'elaraai-east-py-io', source: { editable: 'vendor/io' } },
      { name: 'six', source: registry },
    ] };
    assert.deepStrictEqual(pythonRequires('/ws', lock, ['east-py-std'], 'test'),
      ['elaraai-east-py', 'elaraai-east-py-cli', 'elaraai-east-py-std'], 'not the datascience package its runner does not name');
    assert.deepStrictEqual(pythonRequires('/ws', lock, ['east-py-datascience', 'east-py-io', 'east-py-std', 'six'], 'test'),
      ['elaraai-east-py', 'elaraai-east-py-cli', 'elaraai-east-py-datascience', 'elaraai-east-py-std'], 'a stock package alone, and none held locally');
    assert.deepStrictEqual(pythonRequires('/ws', lock, [], 'test'), ['elaraai-east-py', 'elaraai-east-py-cli'], 'the runtime, whatever the runner names');
    assert.deepStrictEqual(pythonRequires('/ws', { version: 1, package: [{ name: 'six', source: registry }] }, ['east-py-std'], 'test'), [],
      'a lock that holds none of them requires none: they come from where the task runs');

    // With the extras the workspace declares each with, on its root or a
    // member: a member that names the platform runs with what the workspace
    // asked of it
    const declared: UvLock = { version: 1, package: [
      ...lock.package,
      { name: 'ws-root', source: { virtual: '.' }, dependencies: [
        { name: 'elaraai-east-py-datascience', extra: ['lightning'] }, { name: 'Elaraai_East_Py.Std' }, { name: 'six', extra: ['unused'] }] },
      { name: 'trainer', source: { editable: 'packages/trainer' }, dependencies: [{ name: 'elaraai-east-py-datascience', extra: ['torch', 'lightning'] }] },
      // A registry package's own extras are its own: no declaration of the workspace's
      { name: 'some-plugin', source: registry, dependencies: [{ name: 'elaraai-east-py-std', extra: ['theirs'] }] },
    ] };
    assert.deepStrictEqual(pythonRequires('/ws', declared, ['east-py-datascience', 'east-py-std'], 'test'),
      ['elaraai-east-py', 'elaraai-east-py-cli', 'elaraai-east-py-datascience[lightning,torch]', 'elaraai-east-py-std']);
    assert.deepStrictEqual(pythonRequires('/ws', declared, ['east-py-std'], 'test'), ['elaraai-east-py', 'elaraai-east-py-cli', 'elaraai-east-py-std'],
      'only of what the runner names');

    // One the lock holds as a local archive is refused, as a member's own is:
    // an install would otherwise take a registry's copy of it
    const archived: UvLock = { version: 1, package: [{ name: 'elaraai-east-py', source: { path: 'wheels/elaraai_east_py-1.0.0-py3-none-any.whl' } },
      { name: 'elaraai-east-py-cli', source: registry }] };
    assert.throws(() => pythonRequires('/ws', archived, [], 'score'),
      /Environment for 'score': local archive dependency 'elaraai-east-py' is not supported/);
    assert.strictEqual(canonicalPythonName('Elaraai_East.Py--Std'), 'elaraai-east-py-std');
  });

  it('leaves out of the sync of the required distributions every package the lock installs from elsewhere that none of them needs, with its extras', () => {
    const lock = [
      'version = 1',
      'requires-python = ">=3.11"',
      '',
      '[[package]]', 'name = "ws-root"', 'version = "0.1.0"', 'source = { virtual = "." }',
      'dependencies = [{ name = "needed-a" }, { name = "with-extras", extra = ["x"] }, { name = "own-only" }]',
      '',
      '[[package]]', 'name = "member"', 'version = "0.1.0"', 'source = { editable = "packages/member" }',
      'dependencies = [{ name = "own-only" }, { name = "from-git" }]',
      '',
      '[[package]]', 'name = "helper"', 'version = "0.1.0"', 'source = { editable = "packages/helper" }',
      'dependencies = [{ name = "helper-dep" }]',
      '',
      // A registry package that depends on a local one, and on one locked at two versions
      '[[package]]', 'name = "needed-a"', 'version = "1.0"', 'source = { registry = "https://pypi.org/simple" }',
      'dependencies = [{ name = "forked" }, { name = "helper" }]',
      '',
      '[[package]]', 'name = "forked"', 'version = "1.0"', 'source = { registry = "https://pypi.org/simple" }', 'resolution-markers = ["python_full_version < \'3.12\'"]',
      '[[package]]', 'name = "forked"', 'version = "2.0"', 'source = { registry = "https://pypi.org/simple" }', 'resolution-markers = ["python_full_version >= \'3.12\'"]',
      '',
      '[[package]]', 'name = "helper-dep"', 'version = "1.0"', 'source = { registry = "https://pypi.org/simple" }',
      '',
      // One extra asked for, one not, and one that asks for its own others
      '[[package]]', 'name = "with-extras"', 'version = "1.0"', 'source = { registry = "https://download.example/simple" }',
      '[package.optional-dependencies]',
      'x = [{ name = "extra-x" }]',
      'y = [{ name = "extra-y" }]',
      'all = [{ name = "with-extras", extra = ["x", "y"] }]',
      '',
      '[[package]]', 'name = "extra-x"', 'version = "1.0"', 'source = { registry = "https://pypi.org/simple" }',
      '[[package]]', 'name = "extra-y"', 'version = "1.0"', 'source = { registry = "https://pypi.org/simple" }',
      '[[package]]', 'name = "own-only"', 'version = "1.0"', 'source = { registry = "https://pypi.org/simple" }',
      '[[package]]', 'name = "from-git"', 'version = "1.0"', 'source = { git = "https://example.invalid/repo?rev=abc#abc" }',
      '[[package]]', 'name = "archive"', 'version = "1.0"', 'source = { path = "wheels/archive-1.0-py3-none-any.whl" }',
      '',
    ].join('\n');
    assert.deepStrictEqual(pythonLeftOut(lock, ['needed-a', 'with-extras[x]']), ['extra-y', 'from-git', 'own-only'],
      'what a local package a required one depends on needs is needed too, both versions of a forked one, and no local package is listed');
    assert.deepStrictEqual(pythonLeftOut(lock, ['Needed_A', 'with-extras[all]']), ['from-git', 'own-only'], 'an extra that asks for others of its own');
    assert.deepStrictEqual(pythonLeftOut(lock, []), ['extra-x', 'extra-y', 'forked', 'from-git', 'helper-dep', 'needed-a', 'own-only', 'with-extras']);
    assert.throws(() => pythonLeftOut(lock, ['needed-a[x']), /'needed-a\[x' is not a package's name/);
    assert.throws(() => pythonLeftOut('version = 2\n', []), /unsupported uv\.lock version 2/);
  });

  it('walks a registry package as an install takes it: its dependencies and the extras asked of it, so a local archive only an extra nothing asks for names is no refusal', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-cap-walk-'));
    try {
      for (const name of ['member', 'helper']) fs.mkdirSync(path.join(root, 'packages', name), { recursive: true });
      const registry = { registry: 'https://pypi.org/simple' };
      /** A workspace whose member depends on a registry package as it is given, with that package's extras naming a local archive and a local package. */
      const lockOf = (dependency: { name: string; extra?: string[] }, own: UvLockPackage['optional-dependencies'] = {}): UvLock => ({ version: 1, package: [
        { name: 'member', source: { editable: 'packages/member' }, dependencies: [dependency], 'optional-dependencies': own },
        { name: 'regpkg', source: registry, dependencies: [{ name: 'six' }],
          'optional-dependencies': { torch: [{ name: 'torch' }], helpers: [{ name: 'helper' }] } },
        { name: 'six', source: registry },
        { name: 'torch', source: { path: 'wheels/torch-2.9.0-cp311-cp311-linux_x86_64.whl' } },
        { name: 'helper', source: { editable: 'packages/helper' } },
      ] });
      const names = (closure: Array<{ name: string }>) => closure.map(({ name }) => name);

      // The extras nothing asks for are not walked: neither the archive nor the local package they name
      assert.deepStrictEqual(names(pythonClosure(lockOf({ name: 'regpkg' }), root, ['member'], 'score')), ['member']);
      // Asked for by the member, the archive is one an install takes: refused
      assert.throws(() => pythonClosure(lockOf({ name: 'regpkg', extra: ['torch'] }), root, ['member'], 'score'),
        /Environment for 'score': local archive dependency 'torch' is not supported/);
      // Asked for by a required distribution, the local package rides as an sdist
      assert.deepStrictEqual(names(pythonClosure(lockOf({ name: 'regpkg' }), root, ['member'], 'score', [{ name: 'regpkg', extras: ['helpers'] }])), ['helper', 'member']);
      // A workspace's own package is walked through every group it names, as before
      assert.throws(() => pythonClosure(lockOf({ name: 'six' }, { gpu: [{ name: 'torch' }] }), root, ['member'], 'score'), /local archive dependency 'torch'/);
      assert.deepStrictEqual(names(pythonClosure(lockOf({ name: 'six' }, { extra: [{ name: 'helper' }] }), root, ['member'], 'score')), ['helper', 'member']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('carries the sdist of each local package a registry package depends on: one a required distribution does, and one a member reaches through it',
    { skip: hasUv ? false : 'uv not on PATH' }, () => {
      // A registry of this machine's, which only the workspace's sources name: the runtime's
      // command, and another package, each depending on a name the workspace holds as a member
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-cap-reg-'));
      try {
        const flat = path.join(dir, 'flat');
        const wheel = (name: string, version: string, deps: string[]): void => {
          const project = path.join(dir, 'src', name);
          hatchlingProject(project, name, version, deps);
          execFileSync('uv', ['build', '--wheel', '--out-dir', flat, project], { stdio: 'ignore', shell: process.platform === 'win32' });
        };
        wheel('elaraai-east-py-cli', '9.9.9', ['clihelper']);
        wheel('regpkg', '1.0.0', ['helper']);
        const root = path.join(dir, 'ws');
        const member = (name: string, deps: string[]): void => hatchlingProject(path.join(root, 'packages', name), name, '0.1.0', deps,
          deps.includes('regpkg') ? '\n[tool.uv.sources]\nregpkg = { index = "local" }\n' : '');
        member('helper', []);
        member('clihelper', []);
        member('pricing', []);
        member('viareg', ['regpkg']);
        fs.writeFileSync(path.join(root, 'pyproject.toml'),
          '[project]\nname = "root"\nversion = "0.1.0"\nrequires-python = ">=3.11"\ndependencies = ["elaraai-east-py-cli"]\n\n' +
          '[tool.uv.workspace]\nmembers = ["packages/*"]\n\n' +
          `[[tool.uv.index]]\nname = "local"\nurl = ${JSON.stringify(flat)}\nformat = "flat"\nexplicit = true\n\n` +
          '[tool.uv.sources]\nelaraai-east-py-cli = { index = "local" }\nregpkg = { index = "local" }\n');
        execFileSync('uv', ['lock'], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' });
        const pricing = decodeBeast2For(EnvironmentSpecType)(captureEnvironment({ python: { project: path.join(root, 'packages', 'pricing') } }, 'test',
          (buf) => createHash('sha256').update(buf).digest('hex')));
        assert.ok(pricing.type === 'workspace_python');
        assert.deepStrictEqual(pricing.value.requires, ['elaraai-east-py-cli']);
        assert.deepStrictEqual(pricing.value.sdists.map((s) => s.filename).sort(), ['clihelper-0.1.0.tar.gz', 'pricing-0.1.0.tar.gz'],
          'the member a required distribution depends on rides: no install takes it from a registry');
        assert.deepStrictEqual(capture(path.join(root, 'packages', 'viareg')).sdists, ['clihelper', 'helper', 'viareg'], 'nor one a member reaches through a registry package');
        // The sync of the required distributions installs no other registry package
        assert.deepStrictEqual(pythonLeftOut(fs.readFileSync(path.join(root, 'uv.lock'), 'utf-8'), pricing.value.requires), ['regpkg']);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

  it('builds each local package once in an export: the environments of one declaration whose runners name other stock platforms, and one derived from a runner, share its sdists, and those that require the same are one spec, byte for byte',
    { skip: hasUv ? false : 'uv not on PATH' }, () => {
      const built: BuiltSdists = new Map();
      const builds: string[] = [];
      const hash = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');
      const pricing = path.join(ws, 'packages', 'pricing');
      const withStd = captureEnvironment({ python: { project: pricing } }, 'a', hash, (event) => builds.push(event.member), ['east-py-std'], built);
      const withScience = captureEnvironment({ python: { project: pricing } }, 'b', hash, (event) => builds.push(event.member),
        ['east-py-datascience', 'east-py-std'], built);
      const derived = captureAutoEnvironment('east-py', ['pricing'], ws, 'c', hash, (event) => builds.push(event.member), [], built);
      assert.deepStrictEqual(builds, ['common', 'pricing'], 'each member is built once, by the first capture that needs it');
      // This workspace's lock holds no stock distribution: each requires the same, nothing
      assert.deepStrictEqual(Buffer.from(withScience), Buffer.from(withStd));
      assert.ok(derived !== null);
      assert.deepStrictEqual(Buffer.from(derived), Buffer.from(withStd));
    });

  it('does NOT cross-invalidate: editing an unrelated sibling leaves the spec byte-identical',
    { skip: hasUv ? false : 'uv not on PATH' }, () => {
      const before = capture(path.join(ws, 'packages', 'pricing')).specHash;
      const otherSrc = path.join(ws, 'packages', 'other', 'src', 'other', '__init__.py');
      const orig = fs.readFileSync(otherSrc, 'utf-8');
      try {
        fs.writeFileSync(otherSrc, orig + '\nEDIT = 1\n');
        assert.strictEqual(capture(path.join(ws, 'packages', 'pricing')).specHash, before,
          "editing 'other' must not change pricing's env spec");
      } finally { fs.writeFileSync(otherSrc, orig); }
    });

  it('DOES propagate a shared-dependency edit: editing common changes pricing',
    { skip: hasUv ? false : 'uv not on PATH' }, () => {
      const before = capture(path.join(ws, 'packages', 'pricing')).specHash;
      const commonSrc = path.join(ws, 'packages', 'common', 'src', 'common', '__init__.py');
      const orig = fs.readFileSync(commonSrc, 'utf-8');
      try {
        fs.writeFileSync(commonSrc, orig + '\nEDIT = 1\n');
        assert.notStrictEqual(capture(path.join(ws, 'packages', 'pricing')).specHash, before,
          "editing 'common' must change pricing's env spec");
      } finally { fs.writeFileSync(commonSrc, orig); }
    });

  it('errors clearly when the project is not in any lockfile',
    { skip: hasUv ? false : 'uv not on PATH' }, () => {
      const orphan = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-orphan-'));
      fs.writeFileSync(path.join(orphan, 'pyproject.toml'), '[project]\nname = "orphan"\nversion = "0.1.0"\n');
      try {
        assert.throws(() => capture(orphan), /no uv\.lock/);
      } finally { fs.rmSync(orphan, { recursive: true, force: true }); }
    });

  it('auto-derives from platform refs: resolves { custom } → member, unions closures, skips registry names',
    { skip: hasUv ? false : 'uv not on PATH' }, () => {
      const auto = (customs: string[]): string[] | null => {
        const bytes = captureAutoEnvironment('east-py', customs, ws, 'test', (b) => createHash('sha256').update(b).digest('hex'));
        if (bytes === null) return null;
        const spec = decodeBeast2For(EnvironmentSpecType)(bytes);
        assert.ok(spec.type === 'workspace_python');
        return spec.value.sdists.map((s) => s.filename.replace(/-0\.1\.0\.tar\.gz$/, '')).sort();
      };
      assert.deepStrictEqual(auto(['pricing']), ['common', 'pricing'], 'a member ref pulls its transitive closure');
      assert.deepStrictEqual(auto(['other']), ['other'], 'an independent member is captured alone');
      assert.deepStrictEqual(auto(['pricing', 'other']), ['common', 'other', 'pricing'], 'multiple refs union their closures');
      assert.strictEqual(auto(['east-py-std']), null, 'a non-member (registry/first-party) name derives nothing');
      // The members it is of are its subjects, sorted, and a stock platform package this lock does not hold is not required
      const both = decodeBeast2For(EnvironmentSpecType)(captureAutoEnvironment('east-py', ['pricing', 'other'], ws, 'test',
        (b) => createHash('sha256').update(b).digest('hex'), undefined, ['east-py-std'])!);
      assert.ok(both.type === 'workspace_python');
      assert.deepStrictEqual(both.value.subjects, ['other', 'pricing']);
      assert.deepStrictEqual(both.value.requires, []);
    });

  it('resolves an import-style { custom } ref to its PEP 503 lock entry (#391)',
    { skip: hasUv ? false : 'uv not on PATH' }, () => {
      const auto = (customs: string[]): string[] | null => {
        const bytes = captureAutoEnvironment('east-py', customs, ws, 'test', (b) => createHash('sha256').update(b).digest('hex'));
        if (bytes === null) return null;
        const spec = decodeBeast2For(EnvironmentSpecType)(bytes);
        assert.ok(spec.type === 'workspace_python');
        return spec.value.sdists.map((s) => s.filename.replace(/-0\.1\.0\.tar\.gz$/, '')).sort();
      };
      // The task declares the import name; the lock stores `sim-engine`. A
      // strict match derived NO environment here — the bug's silent half.
      assert.deepStrictEqual(auto(['sim_engine']), ['common', 'sim_engine'],
        'an underscore-named member must derive its closure, not silently nothing');
      assert.deepStrictEqual(auto(['sim-engine']), ['common', 'sim_engine'],
        'the canonical spelling resolves to the same member');
      assert.deepStrictEqual(auto(['sim_engine', 'sim-engine']), ['common', 'sim_engine'],
        'both spellings of one member dedupe to one subject');
    });

  it('a member source edit changes the DERIVED env spec — the task-hash contract (#391)',
    { skip: hasUv ? false : 'uv not on PATH' }, () => {
      const autoHash = (): string => {
        const bytes = captureAutoEnvironment('east-py', ['sim_engine'], ws, 'test', (b) => createHash('sha256').update(b).digest('hex'));
        assert.ok(bytes !== null, 'sim_engine must derive an environment');
        return createHash('sha256').update(bytes).digest('hex');
      };
      const before = autoHash();
      const src = path.join(ws, 'packages', 'sim_engine', 'src', 'sim_engine', '__init__.py');
      const orig = fs.readFileSync(src, 'utf-8');
      try {
        fs.writeFileSync(src, orig + '\nEDIT = 1\n');
        assert.notStrictEqual(autoHash(), before,
          "editing sim_engine's source must change its derived env spec (else the dataflow serves a stale cache)");
      } finally { fs.writeFileSync(src, orig); }
      assert.strictEqual(autoHash(), before, 'reverting the edit restores the identical spec');
    });
});

describe('node npm-workspace closure capture (#280)', () => {
  let ws: string;
  const npmShell = process.platform === 'win32';

  const captureNode = (project: string) => {
    const bytes = captureEnvironment({ node: { project } }, 'test', (b) => createHash('sha256').update(b).digest('hex'));
    const spec = decodeBeast2For(EnvironmentSpecType)(bytes);
    assert.ok(spec.type === 'workspace_node');
    return { members: spec.value.members.map((m) => m.name).sort(), specHash: createHash('sha256').update(bytes).digest('hex') };
  };

  before(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-cap-nws-'));
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0', private: true, workspaces: ['packages/*'] }));
    const mk = (name: string, deps?: Record<string, string>, code = 'module.exports.v=1;') => {
      const dir = path.join(ws, 'packages', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `@acme/${name}`, version: '1.0.0', main: 'index.js', ...(deps ? { dependencies: deps } : {}) }));
      fs.writeFileSync(path.join(dir, 'index.js'), code);
    };
    mk('common');
    mk('pricing', { '@acme/common': '1.0.0' });
    mk('other');
    execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ws, stdio: 'ignore', shell: npmShell });
  });

  it('captures exactly the transitive local closure of a member', () => {
    assert.deepStrictEqual(captureNode(path.join(ws, 'packages', 'pricing')).members, ['@acme/common', '@acme/pricing']);
    assert.deepStrictEqual(captureNode(path.join(ws, 'packages', 'other')).members, ['@acme/other']);
  });

  it('does NOT cross-invalidate: editing an unrelated sibling leaves the spec byte-identical', () => {
    const before = captureNode(path.join(ws, 'packages', 'pricing')).specHash;
    const otherSrc = path.join(ws, 'packages', 'other', 'index.js');
    const orig = fs.readFileSync(otherSrc, 'utf-8');
    try {
      fs.writeFileSync(otherSrc, orig + '\n// edit\n');
      assert.strictEqual(captureNode(path.join(ws, 'packages', 'pricing')).specHash, before);
    } finally { fs.writeFileSync(otherSrc, orig); }
  });

  it('rejects a stale lock (N4): a member manifest dep not in the lock (npm ci would install it unpinned)', () => {
    const pj = path.join(ws, 'packages', 'pricing', 'package.json');
    const orig = fs.readFileSync(pj, 'utf-8');
    try {
      const obj = JSON.parse(orig);
      obj.dependencies = { ...obj.dependencies, 'left-pad': '1.3.0' }; // added WITHOUT re-locking
      fs.writeFileSync(pj, JSON.stringify(obj));
      assert.throws(() => captureNode(path.join(ws, 'packages', 'pricing')), /differ from the lockfile/);
    } finally { fs.writeFileSync(pj, orig); }
  });

  it('errors when the environment is declared on the workspace root (N3)', () => {
    assert.throws(
      () => captureEnvironment({ node: { project: ws } }, 'test', (b) => createHash('sha256').update(b).digest('hex')),
      /workspace member, not the workspace root/,
    );
  });

  it('auto-derives from a { custom } member ref; multiple local members need an explicit env', () => {
    const auto = (customs: string[]): string[] | null => {
      const bytes = captureAutoEnvironment('east-node', customs, ws, 'test', (b) => createHash('sha256').update(b).digest('hex'));
      if (bytes === null) return null;
      const spec = decodeBeast2For(EnvironmentSpecType)(bytes);
      assert.ok(spec.type === 'workspace_node');
      return spec.value.members.map((m) => m.name).sort();
    };
    assert.deepStrictEqual(auto(['@acme/pricing']), ['@acme/common', '@acme/pricing'], 'a member ref pulls its transitive closure');
    assert.deepStrictEqual(auto(['@acme/other']), ['@acme/other'], 'an independent member is captured alone');
    assert.strictEqual(auto(['@elaraai/east-node-std']), null, 'a non-member name derives nothing');
    assert.throws(() => auto(['@acme/pricing', '@acme/other']), /explicit `environment`/, 'multiple members need an explicit env for now');
  });
});

describe('tools capture (#279)', () => {
  let dir: string;
  const cap = (files: string[]) => {
    const blobs = new Map<string, Buffer>();
    const bytes = captureEnvironment({ tools: { files: files as [string, ...string[]] } }, 'test',
      (b) => { const h = createHash('sha256').update(b).digest('hex'); blobs.set(h, b); return h; });
    const spec = decodeBeast2For(EnvironmentSpecType)(bytes);
    assert.ok(spec.type === 'tools');
    return { paths: spec.value.files.map((f) => f.path), specHash: createHash('sha256').update(bytes).digest('hex'), blobs };
  };

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-tools-cap-'));
    fs.writeFileSync(path.join(dir, 'runner'), 'BINARY-BYTES');
    fs.writeFileSync(path.join(dir, 'helper.dat'), 'DATA');
  });

  it('captures named files under bin/, sorted, decl-order-independent', () => {
    const a = cap([path.join(dir, 'runner'), path.join(dir, 'helper.dat')]);
    const b = cap([path.join(dir, 'helper.dat'), path.join(dir, 'runner')]);
    assert.deepStrictEqual(a.paths, ['bin/helper.dat', 'bin/runner']);
    assert.strictEqual(a.specHash, b.specHash, 'declaration order must not affect the env hash');
  });

  it('changes the env hash when a captured file changes (GAP-6)', () => {
    const before = cap([path.join(dir, 'runner')]).specHash;
    const orig = fs.readFileSync(path.join(dir, 'runner'));
    try {
      fs.writeFileSync(path.join(dir, 'runner'), 'REBUILT-BYTES');
      assert.notStrictEqual(cap([path.join(dir, 'runner')]).specHash, before);
    } finally { fs.writeFileSync(path.join(dir, 'runner'), orig); }
  });

  it('rejects an empty file list (T1), a directory (T2), and colliding basenames (T3)', () => {
    assert.throws(() => cap([]), /at least one file/);
    assert.throws(() => cap([dir + '/']), /looks like a directory/);
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sub', 'runner'), 'x');
    assert.throws(() => cap([path.join(dir, 'runner'), path.join(dir, 'sub', 'runner')]), /collide on basename/);
  });

  it('errors when a named file does not exist (T4)', () => {
    assert.throws(() => cap([path.join(dir, 'nonexistent')]), /not found/);
  });
});
