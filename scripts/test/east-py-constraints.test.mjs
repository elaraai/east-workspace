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
const [CONSTRAINTS, OVERRIDES] = EAST_PY_PINS;

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

/** A distribution's name as PEP 503 writes it. */
const canonical = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');

/**
 * What a constraints file pins: each pin by its name, version and marker, as
 * uv wrote it, with its hashes.
 */
function pins(constraints) {
  const found = new Map();
  let current = null;
  for (const line of constraints.split('\n')) {
    const pin = /^([A-Za-z0-9._-]+)==([^\s;\\]+)(?:\s*;\s*([^\\]*?))?\s*\\?$/.exec(line);
    if (pin !== null) {
      current = [];
      found.set(`${canonical(pin[1])}==${pin[2]}${pin[3] ? ` ; ${pin[3]}` : ''}`, current);
    }
    const hash = /--hash=(sha256:[0-9a-f]{64})/.exec(line);
    if (hash !== null && current !== null) current.push(hash[1]);
  }
  for (const hashes of found.values()) hashes.sort();
  return found;
}

/**
 * The script {@link held} runs, given each file's pins and markers: where each
 * marker holds, as packaging reads it, over every environment the markers
 * tell apart. Each variable takes each value a marker compares it with, and
 * one that none does; a Python's version takes each version a marker names,
 * and one either side of it.
 */
const HELD = String.raw`
import itertools, json, re, sys
from packaging.markers import Marker

files = json.load(sys.stdin)
markers = sorted({marker for pins in files for _, marker in pins if marker})
operator = r"(?:===|==|!=|<=|>=|~=|<|>|not in|in)"
compared = re.compile(rf"([a-z_]+)\s*{operator}\s*'([^']*)'|'([^']*)'\s*{operator}\s*([a-z_]+)")
seen = {}
for marker in markers:
    for match in compared.finditer(marker):
        name, value = (match[1], match[2]) if match[1] else (match[4], match[3])
        seen.setdefault(name, set()).add(value)
versions = set()
for literal in seen.pop("python_full_version", set()) | seen.pop("python_version", set()):
    a, b, c = ([int(part) for part in literal.split(".")] + [0, 0])[:3]
    below = (a, b, c - 1) if c > 0 else (a, b - 1, 999) if b > 0 else (a - 1, 999, 999)
    versions |= {(a, b, c), below, (a, b, c + 1)}
names = sorted(seen)
grid = [
    dict(zip(names, values), python_full_version=".".join(map(str, version)), python_version=f"{version[0]}.{version[1]}", extra="")
    for values in itertools.product(*(sorted(seen[name]) + ["e3-compared-with-none"] for name in names))
    for version in sorted(versions) or [(3, 12, 0)]
]
where = {}
for marker in markers:
    parsed = Marker(marker)
    where[marker] = "".join("1" if parsed.evaluate(environment) else "0" for environment in grid)
json.dump([[where[marker] if marker else "1" * len(grid) for _, marker in pins] for pins in files], sys.stdout)
`;

/**
 * What constraints files hold, compared by what they install where: each pin
 * by its name, version and hashes, with the environments its marker holds in,
 * read by packaging over every environment their markers tell apart. A marker
 * written otherwise, as one release of uv writes it and another does not,
 * holds the same; a marker moved or dropped does not.
 *
 * @param files - The files' text
 * @returns For each file, where each pin holds, by the pin and its hashes
 */
function held(...files) {
  const read = files.map((text) => [...pins(text)].map(([key, hashes]) => {
    const [pin, marker = null] = key.split(' ; ');
    return { pin: `${pin} ${hashes.join(',')}`, marker };
  }));
  const ran = spawnSync('uv', ['run', '--no-project', '--with', 'packaging', 'python', '-c', HELD],
    { input: JSON.stringify(read.map((entries) => entries.map(({ pin, marker }) => [pin, marker]))), encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(ran.status, 0, ran.stderr);
  return JSON.parse(ran.stdout).map((where, file) => {
    const byPin = new Map();
    read[file].forEach(({ pin }, at) => {
      const before = byPin.get(pin);
      byPin.set(pin, before === undefined ? where[at] : [...where[at]].map((bit, i) => (bit === '1' || before[i] === '1' ? '1' : '0')).join(''));
    });
    return byPin;
  });
}

/** The versions a constraints file pins a distribution at, a platform's each. */
const versionsOf = (held, name) => [...held.keys()].filter((pin) => pin.startsWith(`${canonical(name)}==`)).map((pin) => pin.split(/==| ; /)[1]).sort();

/** The lines of a settings file that are not comments. */
const lines = (text) => text.split('\n').filter((line) => line !== '' && !line.startsWith('#'));

/** A uv setting of the workspace root's manifest that is an array of strings. */
function setting(name) {
  const declared = new RegExp(`^${name}\\s*=\\s*\\[([^\\]]*)\\]`, 'm').exec(fs.readFileSync(path.join(workspace, 'pyproject.toml'), 'utf8'));
  return declared === null ? [] : [...declared[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/** A copy of the workspace root's manifest and lock, which `edit` may change. */
function copyOfRoot(edit = (manifest, lock) => ({ manifest, lock })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'east-py-lock-'));
  const { manifest, lock } = edit(fs.readFileSync(path.join(workspace, 'pyproject.toml'), 'utf8'), fs.readFileSync(path.join(workspace, 'uv.lock'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'pyproject.toml'), manifest);
  fs.writeFileSync(path.join(dir, 'uv.lock'), lock);
  return dir;
}

describe('the pins a release\'s east-py packages are installed under', { skip: hasUv ? false : 'uv not on PATH' }, () => {
  const lock = fs.readFileSync(path.join(workspace, 'uv.lock'), 'utf8');
  const release = lockedVersions(lock, 'elaraai-east-py')[0];

  it('writes the lock\'s third-party pins with their markers and hashes, and the workspace\'s overrides', () => {
    const written = write(workspace);
    assert.equal(written.status, 0, written.stderr);
    const held = pins(written.files[CONSTRAINTS]);
    // What the datascience package's extras pin, and a package of each python tier
    for (const name of ['torch', 'pytorch-lightning', 'xgboost', 'numpy', 'boto3', 'numba']) {
      assert.deepEqual(versionsOf(held, name), [...lockedVersions(lock, name)].sort(), name);
    }
    // A pin the lock holds for some platforms alone says which
    assert.ok([...held.keys()].some((pin) => pin.startsWith('nvidia-nccl-cu13==') && pin.includes(' ; ')), 'nvidia-nccl-cu13 for Linux alone');
    assert.ok(held.size > 100, `${held.size} pins`);
    assert.ok([...held.keys()].every((pin) => !pin.startsWith('elaraai-')), 'none of the workspace\'s own packages');
    // The workspace root's development group alone names it: an extra's pins are all here, a group's are not
    assert.ok(versionsOf(held, 'pytest-subtests').length === 0, 'none of a development group\'s');
    assert.ok([...held.values()].every((hashes) => hashes.length > 0), 'each with a hash');
    for (const name of EAST_PY_PINS) assert.match(written.files[name].split('\n', 1)[0], new RegExp(` of release ${release.replaceAll('.', '\\.')} `), name);
    assert.deepEqual(lines(written.files[OVERRIDES]), setting('override-dependencies'));
    assert.ok(lines(written.files[OVERRIDES]).length > 0, 'the workspace sets overrides');
  });

  it('writes the same bytes twice, and from the root\'s manifest and lock alone', () => {
    const first = write(workspace);
    const alone = copyOfRoot();
    try {
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
    assert.deepEqual(Object.values(refused.files), [null, null], 'nothing is written');

    // A prerelease, as its tag names it: a copy of the lock at that version
    const beta = copyOfRoot((manifest, locked) => ({ manifest,
      lock: locked.replaceAll(`version = "${release}"\nsource = { editable = `, 'version = "9.9.9b2"\nsource = { editable = ') }));
    try {
      assert.equal(write(beta, '--release', '9.9.9-beta.2').status, 0, 'the tag\'s form');
      assert.equal(write(beta, '--release', '9.9.9b2').status, 0, 'PEP 440\'s form');
      assert.equal(write(beta, '--release', '9.9.9').status, 1, 'not the release it is a prerelease of');
    } finally {
      fs.rmSync(beta, { recursive: true, force: true });
    }
  });

  it('refuses a workspace that leaves a distribution out of its lock, which no pin file would keep out of an install', () => {
    const excluding = copyOfRoot((manifest, locked) => ({ lock: locked,
      manifest: manifest.replace('override-dependencies = [', 'exclude-dependencies = ["nvidia-nccl-cu12"]\noverride-dependencies = [') }));
    try {
      const refused = write(excluding);
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /leaves distributions out of its lock \(exclude-dependencies\), which no pin file keeps out of an install/);
      assert.deepEqual(Object.values(refused.files), [null, null], 'nothing is written');
    } finally {
      fs.rmSync(excluding, { recursive: true, force: true });
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
    const stale = (name) => `${EAST_PY_PINS_DIR}/${name} is stale: python3 scripts/east-py-constraints.py libs/east-py ${EAST_PY_PINS_DIR}`;
    // The overrides to the byte; the pins by what they install where, with their hashes
    assert.equal(shipped(OVERRIDES), written.files[OVERRIDES], stale(OVERRIDES));
    const [inShipped, inWritten] = held(shipped(CONSTRAINTS), written.files[CONSTRAINTS]);
    assert.deepEqual(inShipped, inWritten, stale(CONSTRAINTS));
    assert.equal(shipped(CONSTRAINTS).split('\n', 1)[0], written.files[CONSTRAINTS].split('\n', 1)[0]);
    assert.deepEqual(fs.readdirSync(kept).filter((name) => name.startsWith('east-py-')).sort(), [...EAST_PY_PINS].sort(), 'and no other pin file');
  });

  it('compares pins by what they install where: in another order, or a marker as another uv writes it, the same; a marker moved, swapped or dropped, another', () => {
    const pin = (name, version, marker, hash) => `${name}==${version}${marker === '' ? '' : ` ; ${marker}`} \\\n    --hash=sha256:${hash.repeat(64)}\n`;
    const mac = "platform_machine == 'x86_64' and sys_platform == 'darwin'";
    const notMac = "platform_machine != 'x86_64' or sys_platform != 'darwin'";
    // One marker, as uv 0.11 and uv 0.13 write it
    const factored = "(platform_machine == 'aarch64' or platform_machine == 'x86_64') and sys_platform == 'linux'";
    const expanded = "(platform_machine == 'aarch64' and sys_platform == 'linux') or (platform_machine == 'x86_64' and sys_platform == 'linux')";
    const file = ({ numpy = [mac, notMac], cupti = factored, split = '3.13', six = '', reversed = false } = {}) => {
      const each = [
        pin('numpy', '2.3.5', numpy[0], 'a'), pin('numpy', '2.4.4', numpy[1], 'b'),
        pin('nvidia-cuda-cupti', '13.2.86', cupti, 'c'),
        pin('scipy', '1.15.3', `python_full_version < '${split}'`, 'd'), pin('scipy', '1.17.1', `python_full_version >= '${split}'`, 'e'),
        pin('six', '1.17.0', six, 'f'),
      ];
      return `# pins\n${(reversed ? each.reverse() : each).join('')}`;
    };
    const [as, reordered, rewritten, moved, swapped, split, dropped] = held(
      file(), file({ reversed: true }), file({ cupti: expanded }), file({ six: "sys_platform == 'win32'" }),
      file({ numpy: [notMac, mac] }), file({ split: '3.12' }), file({ numpy: [mac, ''] }));
    assert.equal(as.size, 6);
    assert.deepEqual(reordered, as, 'in another order');
    assert.deepEqual(rewritten, as, 'a marker as another uv writes it');
    for (const [other, why] of [[moved, 'a marker moved'], [swapped, 'two markers swapped'], [split, 'a version split moved'], [dropped, 'a marker dropped']]) {
      assert.notDeepEqual(other, as, why);
    }
  });
});

describe('the east-py workspace\'s lock', () => {
  const lock = fs.readFileSync(path.join(workspace, 'uv.lock'), 'utf8');

  it('holds one NCCL library, which torch and xgboost both ask for: two distributions of it install the same file, and the one installed last wins', () => {
    // torch 2.15.0 pins `nvidia-nccl-cu13`, and xgboost 3.4 and later ask for
    // it; an earlier xgboost asks for `nvidia-nccl-cu12`. Both are
    // `nvidia/nccl/lib/libnccl.so.2`, and with cu12's on top torch does not
    // import: `undefined symbol: ncclCommResume`.
    const nccl = [...lock.matchAll(/^name = "(nvidia-nccl-[a-z0-9]+)"$/gm)].map((match) => match[1]);
    assert.deepEqual([...new Set(nccl)], ['nvidia-nccl-cu13'], 'the one torch pins');
    assert.deepEqual(lockedVersions(lock, 'nvidia-nccl-cu13').length, 1);
    for (const version of lockedVersions(lock, 'xgboost')) {
      const [major, minor] = version.split('.').map(Number);
      assert.ok(major > 3 || (major === 3 && minor >= 4), `xgboost ${version} asks for nvidia-nccl-cu13`);
    }
  });
});

describe('the image install script', { skip: process.platform === 'win32' ? 'an image is built on Linux' : false }, () => {
  const install = path.join(repoRoot, 'docker/images/install-packages.sh');
  const release = lockedVersions(fs.readFileSync(path.join(workspace, 'uv.lock'), 'utf8'), 'elaraai-east-py')[0];

  /**
   * Runs the datascience layer's install with a `uv` and an `npm` that say
   * what they were asked. The npm serves `npm pack` of an @elaraai/e3-core
   * whose pins are this checkout's, their first lines naming `published`;
   * anything else it is asked fails.
   */
  function run(version, { pinsDir = true, published = release, uv = true } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'east-py-install-'));
    try {
      const bin = path.join(dir, 'bin');
      const tier = path.join(dir, 'e3-core', 'package', 'tier');
      fs.mkdirSync(bin);
      fs.mkdirSync(tier, { recursive: true });
      for (const name of EAST_PY_PINS) {
        const [, ...rest] = fs.readFileSync(path.join(kept, name), 'utf8').split('\n');
        fs.writeFileSync(path.join(tier, name), [`# The pins of release ${published} as published`, ...rest].join('\n'));
      }
      if (uv) fs.writeFileSync(path.join(bin, 'uv'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${path.join(dir, 'uv-asked')}"\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'npm'), [
        '#!/bin/sh',
        `printf '%s\\n' "$*" >> "${path.join(dir, 'npm-asked')}"`,
        '[ "$1" = pack ] || exit 1',
        `exec tar -czf elaraai-e3-core.tgz -C "${path.join(dir, 'e3-core')}" package`,
        '',
      ].join('\n'), { mode: 0o755 });
      const keptPins = path.join(dir, 'pins');
      // The tools the script runs, and no other: no uv of this machine's, nor its npm
      const tools = path.join(dir, 'tools');
      fs.mkdirSync(tools);
      for (const tool of ['bash', 'mktemp', 'tar', 'gzip', 'mkdir', 'cp', 'rm', 'head', 'grep', 'sed', 'printf', 'sh']) {
        const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
        if (found !== '') fs.symlinkSync(found, path.join(tools, tool));
      }
      const ran = spawnSync('bash', [install, '--datascience-only', '--skip-verify'], { encoding: 'utf8',
        env: { PATH: `${bin}:${tools}`, HOME: dir, EAST_PY_VERSION: version, ...(pinsDir && { EAST_PY_PINS_DIR: keptPins }) } });
      const asked = (file) => fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n') : [];
      return { status: ran.status, stderr: ran.stderr, uv: asked('uv-asked'), npm: asked('npm-asked'), keptPins,
        left: EAST_PY_PINS.filter((name) => fs.existsSync(path.join(keptPins, name))) };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('installs a named release under the pins its published @elaraai/e3-core ships, and keeps them; and asks npm nothing else', () => {
    const named = run(release);
    assert.equal(named.status, 0, named.stderr);
    assert.equal(named.npm.length, 1);
    assert.match(named.npm[0], new RegExp(`^pack --silent --cache \\S+ @elaraai/e3-core@${release.replaceAll('.', '\\.')}$`), 'the release\'s own e3-core');
    assert.deepEqual(named.uv, [`pip install --constraint ${named.keptPins}/east-py-constraints.txt --override ${named.keptPins}/east-py-overrides.txt ` +
      `elaraai-east-py-datascience[all]==${release}`]);
    assert.deepEqual(named.left, EAST_PY_PINS, 'and keeps them');
  });

  it('refuses pins the published package says are another release\'s, and installs nothing', () => {
    const other = run(release, { published: '0.0.1' });
    assert.equal(other.status, 1);
    assert.match(other.stderr, new RegExp(`@elaraai/e3-core@${release.replaceAll('.', '\\.')}'s east-py-constraints\\.txt is not release ${release.replaceAll('.', '\\.')}'s`));
    assert.deepEqual(other.uv, []);
  });

  it('installs `latest` under no pins, and keeps none; and a named release with nowhere to keep pins as it is asked', () => {
    const latest = run('latest');
    assert.equal(latest.status, 0, latest.stderr);
    assert.deepEqual(latest.uv, ['pip install elaraai-east-py-datascience[all]']);
    assert.deepEqual([latest.npm, latest.left], [[], []], 'an image installed under no pins says it holds none');
    const unkept = run(release, { pinsDir: false });
    assert.deepEqual([unkept.uv, unkept.npm], [[`pip install elaraai-east-py-datascience[all]==${release}`], []]);
  });

  it('fails a python install it was asked for when no uv is on the PATH', () => {
    const without = run(release, { uv: false });
    assert.equal(without.status, 1);
    assert.match(without.stderr, /uv is not on PATH: the python packages cannot be installed/);
    assert.deepEqual(without.npm, []);
  });
});
