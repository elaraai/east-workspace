import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PINNED_EXTRAS, extraRequirements, extrasPinErrors } from '../lib/extras-pins.mjs';
import { lockPackages, lockedVersions } from '../lib/uv-lock.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A package manifest whose extras hold these requirement lines. */
const manifest = (extras) => '[project]\nname = "pkg"\nversion = "1.0.0"\n\n[project.optional-dependencies]\n' +
  Object.entries(extras).map(([name, lines]) => `${name} = [\n${lines.map((line) => `    "${line}",\n`).join('')}]\n`).join('') +
  '\n[build-system]\nrequires = ["hatchling"]\n';

/** A lock that holds these packages, each at these versions. */
const lock = (packages) => 'version = 1\n\n' + Object.entries(packages).flatMap(([name, versions]) =>
  versions.map((version) => `[[package]]\nname = "${name}"\nversion = "${version}"\nsource = { registry = "https://pypi.org/simple" }\n`)).join('\n');

const pinned = { file: 'pkg/pyproject.toml', lock: 'uv.lock', pins: { torch: ['torch', 'lightning', 'all'], 'pytorch-lightning': ['lightning', 'all'] } };
const held = lock({ torch: ['2.15.0'], 'pytorch-lightning': ['2.6.6'], numpy: ['2.3.5', '2.4.4'] });
const good = {
  torch: ['torch==2.15.0', 'cloudpickle>=3.0.0'],
  lightning: ['torch==2.15.0', 'pytorch-lightning==2.6.6', 'cloudpickle>=3.0.0'],
  all: ['scikit-learn>=1.4.0,<1.6.0', 'torch==2.15.0', 'pytorch-lightning==2.6.6'],
};

describe('the exact pins an extra holds, against the lock', () => {
  it('reads each extra\'s requirements: an inline array, one over several lines, comments, and a requirement that names extras', () => {
    const read = extraRequirements('[project]\nname = "pkg"\n\n[project.optional-dependencies]\n' +
      'mads = ["PyNomadBBO>=4.4.0"]\n' +
      '# a comment between two extras, with a ] and a "quote"\n' +
      'net = [\n    "fsspec[http]>=2024.1",  # one that names an extra of its own\n    \'single==1.0\',\n]\n' +
      'google-or = [\n    "ortools>=9.9",\n]\n\n[build-system]\nrequires = ["not-an-extra"]\n');
    assert.deepEqual([...read], [['mads', ['PyNomadBBO>=4.4.0']], ['net', ['fsspec[http]>=2024.1', 'single==1.0']], ['google-or', ['ortools>=9.9']]]);
    assert.deepEqual([...extraRequirements('[project]\nname = "pkg"\n')], [], 'a manifest with no extras has none');
  });

  it('reads the manifest as TOML: a comment after the table\'s header, an indented header after it, and an escaped quote in a marker', () => {
    const read = extraRequirements('[project]\nname = "pkg"\n\n[project.optional-dependencies]  # extras\n' +
      'torch = ["torch==2.15.0 ; sys_platform == \\"linux\\""]\n\n  [build-system]\n  requires = ["hatchling"]\n');
    assert.deepEqual([...read], [['torch', ['torch==2.15.0 ; sys_platform == "linux"']]]);
    assert.throws(() => extraRequirements('[project.optional-dependencies]\ntorch = ["torch==2.15.0"\n'), /the manifest is not read as TOML: /);
    assert.throws(() => extraRequirements('[project.optional-dependencies]\ntorch = "torch==2.15.0"\n'),
      /the extra 'torch' is not an array of strings/);
  });

  it('reads the versions a lock holds a package at, by its name as PEP 503 writes it', () => {
    assert.deepEqual(lockedVersions(held, 'numpy'), ['2.3.5', '2.4.4']);
    assert.deepEqual(lockedVersions(held, 'PyTorch_Lightning'), ['2.6.6']);
    assert.deepEqual(lockedVersions(held, 'absent'), []);
  });

  it('reads a lock as TOML, as uv does: a member by its editable source, a table laid out over several lines, and a lock that is not TOML refused', () => {
    const laidOut = 'version = 1\n\n[[package]]\nname = "elaraai-east-py"\nversion = "1.0.5b1"\nsource = { editable = "packages/east-py" }\n\n' +
      '[[package]]\nversion = "1.17.0"   # the version before the name\nname = "six"\n\n[package.source]\nregistry = "https://pypi.org/simple"\n';
    assert.deepEqual(lockPackages(laidOut), [
      { name: 'elaraai-east-py', version: '1.0.5b1', editable: true },
      { name: 'six', version: '1.17.0', editable: false },
    ]);
    assert.deepEqual(lockedVersions(laidOut, 'six'), ['1.17.0']);
    assert.throws(() => lockPackages('[[package]]\nname = "six'), /the lock is not read as TOML: /);
  });

  it('passes extras that pin each package exactly, the same in each, at the lock\'s version', () => {
    assert.deepEqual(extrasPinErrors(manifest(good), held, pinned), []);
  });

  it('refuses a pin that is another version than the lock holds, by name', () => {
    const errors = extrasPinErrors(manifest(good), lock({ torch: ['2.10.0'], 'pytorch-lightning': ['2.6.6'] }), pinned);
    assert.deepEqual(errors, ['pkg/pyproject.toml: torch is pinned ==2.15.0, and uv.lock holds 2.10.0: `uv lock` writes the lock of the pin']);
  });

  it('refuses a range, a pin with a wildcard, and a requirement with a marker, where an exact pin is asked', () => {
    for (const [line, said] of [
      ['torch>=2.4.0', '\'torch>=2.4.0\''],
      ['torch==2.15.*', '\'torch==2.15.*\''],
      ['torch~=2.15.0', '\'torch~=2.15.0\''],
      ['torch==2.15.0; sys_platform == \'linux\'', '\'torch==2.15.0; sys_platform == \'linux\'\''],
      ['torch', '\'torch\''],
    ]) {
      const errors = extrasPinErrors(manifest({ ...good, torch: [line] }), held, pinned);
      assert.deepEqual(errors, [`pkg/pyproject.toml (torch): ${said} is not an exact pin of torch (torch==<version>)`], line);
    }
  });

  it('refuses two extras that pin one package at different versions, by both names', () => {
    const errors = extrasPinErrors(manifest({ ...good, all: ['torch==2.14.1', 'pytorch-lightning==2.6.6'] }), held, pinned);
    assert.deepEqual(errors, ['pkg/pyproject.toml: torch is pinned ==2.15.0 in \'torch\' and ==2.14.1 in \'all\'']);
  });

  it('refuses an extra that is missing, one that does not name the package, and one that names it twice', () => {
    const { lightning: _lightning, ...without } = good;
    assert.deepEqual(extrasPinErrors(manifest(without), held, pinned), ['pkg/pyproject.toml: the extra \'lightning\' is not found']);
    assert.deepEqual(extrasPinErrors(manifest({ ...good, all: ['pytorch-lightning==2.6.6'] }), held, pinned),
      ['pkg/pyproject.toml (all): does not require torch']);
    assert.deepEqual(extrasPinErrors(manifest({ ...good, torch: ['torch==2.15.0', 'Torch==2.15.0'] }), held, pinned),
      ['pkg/pyproject.toml (torch): requires torch 2 times']);
  });

  it('refuses a lock that holds the package at no version, or at more than one', () => {
    assert.deepEqual(extrasPinErrors(manifest(good), lock({ 'pytorch-lightning': ['2.6.6'] }), pinned),
      ['pkg/pyproject.toml: torch is pinned ==2.15.0, and uv.lock holds no torch']);
    assert.deepEqual(extrasPinErrors(manifest(good), lock({ torch: ['2.15.0', '2.2.2'], 'pytorch-lightning': ['2.6.6'] }), pinned),
      ['pkg/pyproject.toml: torch is pinned ==2.15.0, and uv.lock holds it at 2.15.0 and 2.2.2: one pin cannot be both']);
  });

  it('holds for this repository\'s own package and lock', () => {
    for (const set of PINNED_EXTRAS) {
      const errors = extrasPinErrors(fs.readFileSync(path.join(repoRoot, set.file), 'utf8'), fs.readFileSync(path.join(repoRoot, set.lock), 'utf8'), set);
      assert.deepEqual(errors, []);
    }
  });
});
