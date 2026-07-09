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
import { captureEnvironment } from './environment-capture.js';

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
});
