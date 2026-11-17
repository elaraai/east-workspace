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

describe('the import gate of an environment built over a tier', { skip: process.platform === 'win32' ? 'a runtime image is Linux' : false }, () => {
  it('imports and lists from the tier what was left to it alone, runs its path files alone, and finds the part of a namespace package the environment ships before the tier\'s of its name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e3-gate-'));
    try {
      const env = join(dir, 'env');
      const tier = join(dir, 'tier');
      const file = (root: string, path: string, text = ''): void => {
        mkdirSync(join(root, ...path.split('/').slice(0, -1)), { recursive: true });
        writeFileSync(join(root, path), text);
      };
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
      // The environment: its own part of the namespace package, and the parts the tier's would hide
      file(env, 'ns/own/__init__.py');
      file(env, 'ns/shipped/module.py', 'WHERE = "environment"\n');
      file(env, 'hidden/part.py', 'WHERE = "environment"\n');
      file(env, `${TIER_GATE_MODULE}.py`, tierGateModule(tier,
        { distributions: ['left-pkg'], roots: ['left_pkg', 'ns.left_part'], namespaces: ['ns'], pathFiles: ['left_pkg.pth'] }));
      file(env, TIER_GATE_PATH_FILE, `import ${TIER_GATE_MODULE}\n`);

      // The environment's site directory read as Python reads one, and nothing else of this machine's
      const check = [
        'import importlib, importlib.metadata as metadata, json, site, sys',
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
        '    "pathFiles": [getattr(sys, "e3_left_path_file", False), getattr(sys, "e3_other_path_file", False)],',
        `    "tierOnPath": ${JSON.stringify(tier)} in sys.path,`,
        '}))',
      ].join('\n');
      const seen = JSON.parse(execFileSync('python3', ['-I', '-S', '-c', check], { encoding: 'utf8' })) as Record<string, unknown>;
      assert.deepEqual(seen.imported, {
        left_pkg: 'tier', other_pkg: null,
        'ns.own': 'found', 'ns.left_part': 'found', 'ns.not_left': null,
        // The tier's ordinary package and module of these names never take the place of the parts the environment ships
        'ns.shipped.module': 'environment', 'hidden.part': 'environment',
      });
      assert.deepEqual(seen.versions, { 'left-pkg': '1.0', 'other-pkg': null });
      assert.deepEqual(seen.listed, ['left-pkg'], 'its metadata, and no other distribution of the tier\'s');
      assert.deepEqual(seen.pathFiles, [true, false], 'the path file of what was left to the tier, and no other');
      assert.equal(seen.tierOnPath, false, 'the tier\'s site directory is not on the path');
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
    assert.doesNotMatch(source, /__(TIER|ROOTS|NAMESPACES|DISTRIBUTIONS|PATH_FILES)__/);
  });
});
