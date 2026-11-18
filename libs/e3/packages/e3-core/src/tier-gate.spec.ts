/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TIER_GATE_MODULE, TIER_GATE_PATH_FILE, tierGateModule } from './tier-gate.js';

/** Writes a file under a root, with the directories it needs. */
function file(root: string, path: string, text = ''): void {
  mkdirSync(join(root, ...path.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** What `check`, a python program, prints as JSON, run with nothing of this
 *  machine's site directories on its path, from `cwd`. */
function python(check: readonly string[], cwd: string): Record<string, unknown> {
  return JSON.parse(execFileSync('python3', ['-I', '-S', '-c', check.join('\n')], { encoding: 'utf8', cwd })) as Record<string, unknown>;
}

describe('the import gate of an environment built over a tier', { skip: process.platform === 'win32' ? 'a runtime image is Linux' : false }, () => {
  it('imports from the tier what was left to it alone, lists what the environment installed, runs the left path files alone, and finds the part of a namespace package the environment ships before the tier\'s of its name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e3-gate-'));
    try {
      const env = join(dir, 'env');
      const tier = join(dir, 'tier');
      // The tier: a package left to it and one not, each with its metadata and a path file
      file(tier, 'left_pkg/__init__.py', 'WHERE = "tier"\n');
      file(tier, 'left_pkg-1.0.dist-info/METADATA', 'Metadata-Version: 2.1\nName: left-pkg\nVersion: 1.0\n');
      file(tier, 'left_pkg.pth', 'import sys; sys.e3_left_path_file = True\n');
      file(tier, 'other_pkg/__init__.py', '');
      file(tier, 'other_pkg-2.0.dist-info/METADATA', 'Metadata-Version: 2.1\nName: other-pkg\nVersion: 2.0\n');
      file(tier, 'other.pth', 'import sys; sys.e3_other_path_file = True\n');
      // Parts of a namespace package both hold parts of: one left to the tier, one not
      file(tier, 'ns/left_part/__init__.py');
      file(tier, 'ns/not_left/__init__.py');
      // An ordinary package of the name of a part the environment ships, of a distribution the environment does not hold,
      // and a module of the name of a namespace package the environment ships
      file(tier, 'ns/shipped/__init__.py', 'WHERE = "tier"\n');
      file(tier, 'hidden.py', 'WHERE = "tier"\n');
      // The environment: the metadata of what it left to the tier, which leaving
      // keeps; its own part of the namespace package, and the parts the tier's would hide
      file(env, 'left_pkg-1.0.dist-info/METADATA', 'Metadata-Version: 2.1\nName: left-pkg\nVersion: 1.0\n');
      file(env, 'ns/own/__init__.py');
      file(env, 'ns/shipped/module.py', 'WHERE = "environment"\n');
      file(env, 'hidden/part.py', 'WHERE = "environment"\n');
      file(env, `${TIER_GATE_MODULE}.py`, tierGateModule(tier,
        { distributions: ['left-pkg'], roots: ['left_pkg', 'ns.left_part'], namespaces: ['ns'], pathFiles: ['left_pkg.pth'] }));
      file(env, TIER_GATE_PATH_FILE, `import ${TIER_GATE_MODULE}\n`);

      // The environment's site directory read as Python reads one, and nothing else of this machine's
      const seen = python([
        'import importlib, importlib.metadata as metadata, importlib.util, json, site, sys',
        `site.addsitedir(${JSON.stringify(env)})`,
        'def imported(name):',
        '    try:',
        '        return getattr(importlib.import_module(name), "WHERE", "found")',
        '    except ModuleNotFoundError:',
        '        return None',
        'def version(name):',
        '    try:',
        '        return metadata.version(name)',
        '    except metadata.PackageNotFoundError:',
        '        return None',
        'print(json.dumps({',
        '    "imported": {name: imported(name) for name in ["left_pkg", "other_pkg", "ns.own", "ns.left_part", "ns.not_left", "ns.shipped.module", "hidden.part"]},',
        '    "versions": {name: version(name) for name in ["left-pkg", "other-pkg"]},',
        '    "listed": sorted(dist.metadata["Name"] for dist in metadata.distributions()),',
        // What a scan of the path finds, as pkg_resources's does
        '    "scanned": sorted(dist.metadata["Name"] for dist in metadata.distributions(path=sys.path)),',
        // A probe of a name neither holds, in a namespace package both hold parts of
        '    "probed": [importlib.util.find_spec(name) is None for name in ["ns.absent", "ns.own"]],',
        '    "pathFiles": [getattr(sys, "e3_left_path_file", False), getattr(sys, "e3_other_path_file", False)],',
        `    "tierOnPath": ${JSON.stringify(tier)} in sys.path,`,
        `    "tierOnPackagePath": any(part.startswith(${JSON.stringify(tier)}) for part in sys.modules["ns"].__path__),`,
        '}))',
      ], dir);
      assert.deepEqual(seen.imported, {
        left_pkg: 'tier', other_pkg: null,
        'ns.own': 'found', 'ns.left_part': 'found', 'ns.not_left': null,
        // The tier's ordinary package and module of these names never take the place of the parts the environment ships
        'ns.shipped.module': 'environment', 'hidden.part': 'environment',
      });
      assert.deepEqual(seen.versions, { 'left-pkg': '1.0', 'other-pkg': null });
      assert.deepEqual(seen.listed, ['left-pkg'], 'its metadata, and no other distribution of the tier\'s');
      assert.deepEqual(seen.scanned, ['left-pkg'], 'a scan of the path finds what was left to the tier, as where the environment runs whole');
      assert.deepEqual(seen.probed, [true, false], 'a probe of a name nothing holds finds nothing, and raises nothing');
      assert.deepEqual(seen.pathFiles, [true, false], 'the path file of what was left to the tier, and no other');
      assert.equal(seen.tierOnPath, false, 'the tier\'s site directory is not on the path');
      assert.equal(seen.tierOnPackagePath, false, 'nor is a directory of the tier\'s on a package\'s path');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('imports the tier\'s package of a name left to it over a bare directory of that name on the path, and a module or an ordinary package found first over the tier\'s', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e3-gate-'));
    try {
      const env = join(dir, 'env');
      const tier = join(dir, 'tier');
      const cwd = join(dir, 'work');
      file(tier, 'idna/__init__.py', 'WHERE = "tier"\n');
      file(tier, 'six.py', 'WHERE = "tier"\n');
      file(tier, 'nvidia/cudnn/__init__.py', 'WHERE = "tier"\n');
      file(env, `${TIER_GATE_MODULE}.py`, tierGateModule(tier,
        { distributions: ['idna', 'six', 'nvidia-cudnn'], roots: ['idna', 'nvidia.cudnn', 'six'], namespaces: ['nvidia'], pathFiles: [] }));
      file(env, TIER_GATE_PATH_FILE, `import ${TIER_GATE_MODULE}\n`);
      // The working directory holds a bare directory of one name left to the
      // tier, a namespace portion, and a module of another, first on the path
      mkdirSync(join(cwd, 'idna'), { recursive: true });
      file(cwd, 'six.py', 'WHERE = "work"\n');

      const seen = python([
        'import importlib, json, site, sys',
        'sys.path.insert(0, "")',
        `site.addsitedir(${JSON.stringify(env)})`,
        'print(json.dumps({name: getattr(importlib.import_module(name), "WHERE", None) for name in ["idna", "six", "nvidia.cudnn"]}))',
      ], cwd);
      assert.deepEqual(seen, { idna: 'tier', six: 'work', 'nvidia.cudnn': 'tier' },
        'as where the environment runs whole: an ordinary package wins over a namespace portion, and what is first on the path over what follows');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes each value into the module as the literal Python reads as it', () => {
    const source = tierGateModule('/opt/venv/lib/python3.12/site-packages "quoted"',
      { distributions: ['torch'], roots: ['torch'], namespaces: [], pathFiles: [] });
    assert.match(source, /^TIER = "\/opt\/venv\/lib\/python3\.12\/site-packages \\"quoted\\""$/m);
    assert.match(source, /^ROOTS = frozenset\(\["torch"\]\)$/m);
    assert.match(source, /^PATH_FILES = \[\]$/m);
    assert.doesNotMatch(source, /__(TIER|ROOTS|NAMESPACES|PATH_FILES)__/);
  });
});
