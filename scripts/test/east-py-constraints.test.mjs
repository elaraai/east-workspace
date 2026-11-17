import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lockedVersions } from '../lib/extras-pins.mjs';
import { EAST_PY_PINS, EAST_PY_PINS_DIR } from '../set-python-version.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repoRoot, 'scripts/east-py-constraints.py');
const workspace = path.join(repoRoot, 'libs/east-py');
const kept = path.join(repoRoot, EAST_PY_PINS_DIR);
const hasUv = spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0;
const [CONSTRAINTS, OVERRIDES, EXCLUDES] = EAST_PY_PINS;

/** Runs the script, and reads what it wrote: each pin file's text, by its name. */
function write(from, ...flags) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'east-py-constraints-'));
  try {
    const ran = spawnSync('python3', [script, from, out, ...flags], { encoding: 'utf8' });
    const files = Object.fromEntries(EAST_PY_PINS.map((name) => [name, fs.existsSync(path.join(out, name)) ? fs.readFileSync(path.join(out, name), 'utf8') : null]));
    return { status: ran.status, stderr: ran.stderr, files };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

/**
 * What a constraints file pins: each distribution's versions, a platform's
 * each, and each pin's hashes. Read for what it says, and not for how uv
 * writes it, which a later uv may change.
 */
function pins(constraints) {
  const found = new Map();
  let current = null;
  for (const line of constraints.split('\n')) {
    const pin = /^([A-Za-z0-9._-]+)==([^\s;\\]+)/.exec(line);
    if (pin !== null) {
      current = { version: pin[2], hashes: [] };
      found.set(pin[1], [...(found.get(pin[1]) ?? []), current]);
    }
    const hash = /--hash=(sha256:[0-9a-f]{64})/.exec(line);
    if (hash !== null && current !== null) current.hashes.push(hash[1]);
  }
  for (const versions of found.values()) for (const pinned of versions) pinned.hashes.sort();
  return found;
}

/** The lines of a settings file that are not comments. */
const lines = (text) => text.split('\n').filter((line) => line !== '' && !line.startsWith('#'));

/** A uv setting of the workspace root's manifest that is an array of strings. */
function setting(name) {
  const declared = new RegExp(`^${name}\\s*=\\s*\\[([^\\]]*)\\]`, 'm').exec(fs.readFileSync(path.join(workspace, 'pyproject.toml'), 'utf8'));
  return declared === null ? [] : [...declared[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe('the pins a release\'s east-py packages are installed under', { skip: hasUv ? false : 'uv not on PATH' }, () => {
  const lock = fs.readFileSync(path.join(workspace, 'uv.lock'), 'utf8');
  const release = lockedVersions(lock, 'elaraai-east-py')[0];

  it('writes the lock\'s third-party pins with their hashes, and the workspace\'s overrides and excludes', () => {
    const written = write(workspace);
    assert.equal(written.status, 0, written.stderr);
    const held = pins(written.files[CONSTRAINTS]);
    // What the datascience package's extras pin, and a package of each python tier
    for (const name of ['torch', 'pytorch-lightning', 'numpy', 'boto3', 'numba']) {
      assert.deepEqual(held.get(name).map(({ version }) => version), lockedVersions(lock, name), name);
    }
    assert.ok(held.size > 100, `${held.size} pins`);
    assert.ok([...held.keys()].every((name) => !name.startsWith('elaraai-')), 'none of the workspace\'s own packages');
    // The workspace root's development group alone names it: an extra's pins are all here, a group's are not
    assert.ok(!held.has('pytest-subtests'), 'none of a development group\'s');
    assert.ok([...held.values()].flat().every(({ hashes }) => hashes.length > 0), 'each with a hash');
    for (const name of EAST_PY_PINS) assert.match(written.files[name].split('\n', 1)[0], new RegExp(` of release ${release.replaceAll('.', '\\.')} `), name);

    assert.deepEqual(lines(written.files[OVERRIDES]), setting('override-dependencies'));
    assert.deepEqual(lines(written.files[EXCLUDES]), setting('exclude-dependencies'));
    assert.ok(lines(written.files[EXCLUDES]).length > 0 && lines(written.files[OVERRIDES]).length > 0, 'the workspace sets both');
    // What the lock leaves out is in no pin
    for (const excluded of lines(written.files[EXCLUDES])) assert.ok(!held.has(excluded), excluded);
  });

  it('writes the same bytes twice, and from the root\'s manifest and lock alone', () => {
    const first = write(workspace);
    const alone = fs.mkdtempSync(path.join(os.tmpdir(), 'east-py-lock-'));
    try {
      for (const name of ['pyproject.toml', 'uv.lock']) fs.copyFileSync(path.join(workspace, name), path.join(alone, name));
      for (const again of [write(workspace), write(alone)]) {
        assert.equal(again.status, 0, again.stderr);
        assert.deepEqual(again.files, first.files);
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
    assert.deepEqual(Object.values(refused.files), [null, null, null], 'nothing is written');

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

  it('is what the files @elaraai/e3-core ships were written by: they are the lock\'s, now', () => {
    const written = write(workspace);
    assert.equal(written.status, 0, written.stderr);
    const shipped = (name) => fs.readFileSync(path.join(kept, name), 'utf8');
    // The two settings, to the byte; the pins, by what they pin
    for (const name of [OVERRIDES, EXCLUDES]) {
      assert.equal(shipped(name), written.files[name], `${EAST_PY_PINS_DIR}/${name} is stale: python3 scripts/east-py-constraints.py libs/east-py ${EAST_PY_PINS_DIR}`);
    }
    assert.deepEqual([...pins(shipped(CONSTRAINTS))], [...pins(written.files[CONSTRAINTS])],
      `${EAST_PY_PINS_DIR}/${CONSTRAINTS} is stale: python3 scripts/east-py-constraints.py libs/east-py ${EAST_PY_PINS_DIR}`);
    assert.equal(shipped(CONSTRAINTS).split('\n', 1)[0], written.files[CONSTRAINTS].split('\n', 1)[0]);
  });
});

describe('the east-py workspace\'s lock', () => {
  const lock = fs.readFileSync(path.join(workspace, 'uv.lock'), 'utf8');

  it('holds one NCCL library: two distributions of it install the same file, and the one installed last wins', () => {
    // torch brings `nvidia-nccl-cu13`, pinned; xgboost 3.2.0 asks for
    // `nvidia-nccl-cu12`. Both are `nvidia/nccl/lib/libnccl.so.2`. With
    // xgboost's on top, torch does not import: `undefined symbol: ncclCommResume`.
    const nccl = [...lock.matchAll(/^name = "(nvidia-nccl-[a-z0-9]+)"$/gm)].map((match) => match[1]);
    assert.deepEqual([...new Set(nccl)], ['nvidia-nccl-cu13'], 'the one torch pins');
    assert.deepEqual(lockedVersions(lock, 'nvidia-nccl-cu13').length, 1);
  });
});

describe('the image install script', { skip: process.platform === 'win32' ? 'an image is built on Linux' : false }, () => {
  const install = path.join(repoRoot, 'docker/images/install-packages.sh');
  const release = lockedVersions(fs.readFileSync(path.join(workspace, 'uv.lock'), 'utf8'), 'elaraai-east-py')[0];

  /** Runs the datascience layer's install with a `uv` that only says what it was asked. */
  function run(version, withPins = true) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'east-py-install-'));
    try {
      const pinsDir = path.join(dir, 'pins');
      fs.cpSync(kept, pinsDir, { recursive: true });
      fs.mkdirSync(path.join(dir, 'bin'));
      fs.writeFileSync(path.join(dir, 'bin', 'uv'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${path.join(dir, 'asked')}"\n`, { mode: 0o755 });
      const ran = spawnSync('bash', [install, '--datascience-only', '--skip-verify'], { encoding: 'utf8',
        env: { PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, EAST_PY_VERSION: version, ...(withPins && { EAST_PY_PINS_DIR: pinsDir }) } });
      const asked = fs.existsSync(path.join(dir, 'asked')) ? fs.readFileSync(path.join(dir, 'asked'), 'utf8').trim().split('\n') : [];
      return { status: ran.status, stderr: ran.stderr, asked, pinsDir, left: EAST_PY_PINS.filter((name) => fs.existsSync(path.join(pinsDir, name))) };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('installs a named release under its pins, its overrides and its excludes', () => {
    const named = run(release);
    assert.equal(named.status, 0, named.stderr);
    assert.deepEqual(named.asked, [`pip install --constraint ${named.pinsDir}/east-py-constraints.txt --override ${named.pinsDir}/east-py-overrides.txt ` +
      `--excludes ${named.pinsDir}/east-py-excludes.txt elaraai-east-py-datascience[all]==${release}`]);
    assert.deepEqual(named.left, EAST_PY_PINS, 'and keeps them');
  });

  it('refuses pins that are another release\'s, and installs nothing', () => {
    const other = run('0.0.1');
    assert.equal(other.status, 1);
    assert.match(other.stderr, /east-py-constraints\.txt is not release 0\.0\.1's: a release's images are built from its own tag/);
    assert.deepEqual(other.asked, []);
  });

  it('installs `latest` under no pins, and keeps none; and a named release with none given, as it is asked', () => {
    const latest = run('latest');
    assert.equal(latest.status, 0, latest.stderr);
    assert.deepEqual(latest.asked, ['pip install elaraai-east-py-datascience[all]']);
    assert.deepEqual(latest.left, [], 'an image installed under no pins says it holds none');
    assert.deepEqual(run(release, false).asked, [`pip install elaraai-east-py-datascience[all]==${release}`]);
  });
});
