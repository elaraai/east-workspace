import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lockedVersions } from '../lib/extras-pins.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repoRoot, 'docker/images/east-py-constraints.py');
const workspace = path.join(repoRoot, 'libs/east-py');
const hasUv = spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0;

/** Runs the script, and reads what it wrote. */
function write(from, ...flags) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'east-py-constraints-'));
  try {
    const ran = spawnSync('python3', [script, from, out, ...flags], { encoding: 'utf8' });
    const read = (name) => (fs.existsSync(path.join(out, name)) ? fs.readFileSync(path.join(out, name), 'utf8') : null);
    return { status: ran.status, stderr: ran.stderr, constraints: read('east-py-constraints.txt'), overrides: read('east-py-overrides.txt') };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

/** The pins of a constraints file: each package's versions, a platform's each. */
function pins(constraints) {
  const found = new Map();
  for (const line of constraints.split('\n')) {
    const pin = /^([A-Za-z0-9._-]+)==([^\s;\\]+)/.exec(line);
    if (pin !== null) found.set(pin[1], [...(found.get(pin[1]) ?? []), pin[2]]);
  }
  return found;
}

describe('the pins a release\'s east-py packages are installed under', { skip: hasUv ? false : 'uv not on PATH' }, () => {
  const lock = fs.readFileSync(path.join(workspace, 'uv.lock'), 'utf8');
  const release = lockedVersions(lock, 'elaraai-east-py')[0];

  it('writes the lock\'s third-party pins with their hashes, and the workspace\'s overrides', () => {
    const written = write(workspace);
    assert.equal(written.status, 0, written.stderr);
    const held = pins(written.constraints);
    // What the datascience package's extras pin, and a package of each python tier
    for (const name of ['torch', 'pytorch-lightning', 'numpy', 'boto3', 'numba']) {
      assert.deepEqual(held.get(name), lockedVersions(lock, name), name);
    }
    assert.ok(held.size > 100, `${held.size} pins`);
    assert.ok([...held.keys()].every((name) => !name.startsWith('elaraai-')), 'none of the workspace\'s own packages');
    // The workspace root's development group alone names it: an extra's pins are all here, a group's are not
    assert.ok(!held.has('pytest-subtests'), 'none of a development group\'s');
    assert.ok(written.constraints.split('\n').filter((line) => /--hash=sha256:[0-9a-f]{64}/.test(line)).length >= held.size, 'each with a hash');
    assert.ok(written.constraints.startsWith(`# The pins the east-py packages of release ${release} were tested with`));

    const declared = /override-dependencies\s*=\s*\[([^\]]*)\]/.exec(fs.readFileSync(path.join(workspace, 'pyproject.toml'), 'utf8'));
    const overrides = declared === null ? [] : [...declared[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(written.overrides.split('\n').filter((line) => line !== '' && !line.startsWith('#')), overrides);
  });

  it('writes the same bytes twice, and from the root\'s manifest and lock alone, as an image\'s build holds them', () => {
    const first = write(workspace);
    const alone = fs.mkdtempSync(path.join(os.tmpdir(), 'east-py-lock-'));
    try {
      for (const name of ['pyproject.toml', 'uv.lock']) fs.copyFileSync(path.join(workspace, name), path.join(alone, name));
      for (const again of [write(workspace), write(alone)]) {
        assert.equal(again.status, 0, again.stderr);
        assert.equal(again.constraints, first.constraints);
        assert.equal(again.overrides, first.overrides);
      }
    } finally {
      fs.rmSync(alone, { recursive: true, force: true });
    }
  });

  it('writes for the release its lock is of, named as a tag names it or as PEP 440 does, and refuses another\'s', () => {
    assert.equal(write(workspace, '--release', release).status, 0);
    const refused = write(workspace, '--release', '0.0.1');
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, new RegExp(`is release ${release.replaceAll('.', '\\.')}'s, not 0\\.0\\.1's: its pins are another release's`));
    assert.deepEqual([refused.constraints, refused.overrides], [null, null], 'nothing is written');

    // A prerelease, as its tag names it: a copy of the lock at that version
    const beta = fs.mkdtempSync(path.join(os.tmpdir(), 'east-py-lock-'));
    try {
      fs.copyFileSync(path.join(workspace, 'pyproject.toml'), path.join(beta, 'pyproject.toml'));
      fs.writeFileSync(path.join(beta, 'uv.lock'), lock.replaceAll(`version = "${release}"\nsource = { editable = `, 'version = "9.9.9b2"\nsource = { editable = '));
      assert.equal(write(beta, '--release', '9.9.9-beta.2').status, 0, 'the tag\'s form');
      assert.equal(write(beta, '--release', '9.9.9b2').status, 0, 'PEP 440\'s form');
      assert.equal(write(beta, '--release', '9.9.9').status, 1, 'not the release it is a prerelease of');
    } finally {
      fs.rmSync(beta, { recursive: true, force: true });
    }
  });

  it('says how it is used when given the wrong arguments', () => {
    assert.equal(write(workspace, 'extra').status, 2);
    assert.equal(write(workspace, '--release').status, 2);
  });
});
