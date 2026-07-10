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
import { captureEnvironment, captureAutoEnvironment } from './environment-capture.js';

function toolAvailable(cmd: string): boolean {
  try { execFileSync(cmd, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }); return true; } catch { return false; }
}

/** Capture a member's env and return [sorted sdist filenames, spec-bytes sha]. */
function capture(project: string): { sdists: string[]; specHash: string } {
  const specBytes = captureEnvironment(
    { python: { project } }, 'test',
    (buf) => createHash('sha256').update(buf).digest('hex'),
  );
  const spec = decodeBeast2For(EnvironmentSpecType)(specBytes);
  assert.ok(spec.type === 'python');
  return {
    sdists: spec.value.sdists.map((s) => s.filename.replace(/-0\.1\.0\.tar\.gz$/, '')).sort(),
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
    execFileSync('uv', ['lock'], { cwd: ws, stdio: 'ignore', shell: process.platform === 'win32' });
  });

  it('captures exactly the transitive local closure of a member',
    { skip: hasUv ? false : 'uv not on PATH' }, () => {
      assert.deepStrictEqual(capture(path.join(ws, 'packages', 'pricing')).sdists, ['common', 'pricing']);
      assert.deepStrictEqual(capture(path.join(ws, 'packages', 'common')).sdists, ['common']);
      assert.deepStrictEqual(capture(path.join(ws, 'packages', 'other')).sdists, ['other']);
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
        assert.ok(spec.type === 'python');
        return spec.value.sdists.map((s) => s.filename.replace(/-0\.1\.0\.tar\.gz$/, '')).sort();
      };
      assert.deepStrictEqual(auto(['pricing']), ['common', 'pricing'], 'a member ref pulls its transitive closure');
      assert.deepStrictEqual(auto(['other']), ['other'], 'an independent member is captured alone');
      assert.deepStrictEqual(auto(['pricing', 'other']), ['common', 'other', 'pricing'], 'multiple refs union their closures');
      assert.strictEqual(auto(['east-py-std']), null, 'a non-member (registry/first-party) name derives nothing');
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
