/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalDistributionName, installedFilesDigest, leftToTier, pythonMinor, pythonSatisfies, readTierManifest, recordedSiteFiles, tierHolds, tierManifestDigest,
  type TierManifest,
} from './tier-manifest.js';
import { tierManifestOf, uvOnPath } from './test-helpers.js';

const RECORD = [
  '../../../bin/idna,sha256=SYIN4TtFm5oeBgQEc2JCs68aY26k012xrN4Kmu6WEsw,354',
  'idna-3.20.dist-info/INSTALLER,sha256=5hhM4Q4mYTT9z6QB6PGpUAW81PGNFrYrdXMj4oM_6ak,2',
  'idna-3.20.dist-info/METADATA,sha256=29jBTB5MoeDJgkptvHy794iE8461LZEUjNMCX2ceS4U,7207',
  'idna-3.20.dist-info/RECORD,,',
  'idna-3.20.dist-info/REQUESTED,sha256=47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU,0',
  'idna/__init__.py,sha256=MPqNDLZbXqGaNdXxAFhiqFPKEQXju2jNQhCey6-5eJM,868',
  'idna/core.py,sha256=YJYyAaJtqKKymwVOCoZiq1xnoTu9mm9oBnVTdWYnvuQ,13239',
  '',
].join('\n');

/** A python runtime image's interpreter: a virtualenv's, made from the system's. */
const TIER_PYTHON = { version: '3.11.2', executable: '/opt/venv/bin/python', base: '/usr/bin/python3', site: '/opt/venv/lib/python3.11/site-packages' };

describe('a tier manifest', () => {
  it('digests the files a distribution installed, and not how it was installed', () => {
    const digest = installedFilesDigest(RECORD);
    assert.match(digest, /^sha256:[0-9a-f]{64}$/);
    // Another installer's bookkeeping, a compiled file, a script for another interpreter, rows in another order: the same files
    const another = [
      'idna/core.py,sha256=YJYyAaJtqKKymwVOCoZiq1xnoTu9mm9oBnVTdWYnvuQ,13239',
      'idna/__pycache__/core.cpython-311.pyc,,',
      'idna/__init__.py,sha256=MPqNDLZbXqGaNdXxAFhiqFPKEQXju2jNQhCey6-5eJM,868',
      'idna-3.20.dist-info/METADATA,sha256=29jBTB5MoeDJgkptvHy794iE8461LZEUjNMCX2ceS4U,7207',
      'idna-3.20.dist-info/INSTALLER,sha256=other,4',
      'idna-3.20.dist-info/direct_url.json,sha256=other,80',
      'idna-3.20.dist-info/RECORD,,',
      '../../../bin/idna,sha256=another-interpreter,360',
    ].join('\r\n');
    assert.equal(installedFilesDigest(another), digest);
    // One file changed, one more, one fewer: other files
    assert.notEqual(installedFilesDigest(RECORD.replace('YJYyAaJtqKKymwVOCoZiq1xnoTu9mm9oBnVTdWYnvuQ', 'changed')), digest);
    assert.notEqual(installedFilesDigest(`${RECORD}idna/extra.py,sha256=x,1\n`), digest);
    assert.notEqual(installedFilesDigest(RECORD.replace(/^idna\/core\.py.*\n/m, '')), digest);
    // A path that holds a comma is quoted in a RECORD
    assert.notEqual(installedFilesDigest('"pkg/a,b.py",sha256=x,1\n'), installedFilesDigest('pkg/a,sha256=x,1\n'));
  });

  it('says a tier holds a distribution only of that name, that version and the same files', () => {
    const manifest: TierManifest = { version: 1, python: TIER_PYTHON, namespaces: [],
      distributions: [{ name: 'torch', version: '2.9.0+cu130', files: 'sha256:aa' }, { name: 'elaraai-east-py', version: '1.0.109', files: 'sha256:bb' }] };
    assert.equal(tierHolds(manifest, { name: 'torch', version: '2.9.0+cu130', files: 'sha256:aa' }), true);
    assert.equal(tierHolds(manifest, { name: 'Elaraai_East.Py', version: '1.0.109', files: 'sha256:bb' }), true, 'by its PEP 503 name');
    assert.equal(tierHolds(manifest, { name: 'torch', version: '2.9.0+cpu', files: 'sha256:aa' }), false, 'a local label is part of the version');
    assert.equal(tierHolds(manifest, { name: 'torch', version: '2.9.0+cu130', files: 'sha256:cc' }), false, 'never by name and version alone');
    assert.equal(tierHolds(manifest, { name: 'numpy', version: '2.0.0', files: 'sha256:aa' }), false);
    assert.equal(canonicalDistributionName('Typing_Extensions'), 'typing-extensions');
  });

  it('reads a manifest of the form it knows, and refuses any other by what is wrong with it', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, python: TIER_PYTHON, namespaces: ['cuda', 'nvidia'],
      distributions: [{ name: 'Typing_Extensions', version: '4.12.2', files: 'sha256:aa' }] }));
    assert.deepEqual(readTierManifest(bytes).distributions, [{ name: 'typing-extensions', version: '4.12.2', files: 'sha256:aa' }]);
    assert.deepEqual(readTierManifest(bytes).python, TIER_PYTHON);
    assert.deepEqual(readTierManifest(bytes).namespaces, ['cuda', 'nvidia']);
    assert.match(tierManifestDigest(bytes), /^sha256:[0-9a-f]{64}$/);
    const refused = (value: unknown, words: RegExp): void => { assert.throws(() => readTierManifest(new TextEncoder().encode(JSON.stringify(value))), words); };
    assert.throws(() => readTierManifest(new TextEncoder().encode('not json')), /is not JSON/);
    refused({ version: 2 }, /not of the form this e3 reads/);
    refused({ version: 1 }, /names no interpreter/);
    refused({ version: 1, python: { ...TIER_PYTHON, executable: '' }, namespaces: [], distributions: [] }, /names no interpreter$/);
    refused({ version: 1, python: { version: '3.11.2', executable: '/p', site: '/s' }, namespaces: [], distributions: [] }, /names no base interpreter/);
    refused({ version: 1, python: TIER_PYTHON, namespaces: [] }, /lists no distributions/);
    refused({ version: 1, python: TIER_PYTHON, namespaces: [], distributions: [{ name: 'a', version: '1' }] }, /files digest/);
    // Which of its packages are namespace packages is part of what a tier says: one that does not say is not read
    refused({ version: 1, python: TIER_PYTHON, distributions: [] }, /names no namespace packages/);
    refused({ version: 1, python: TIER_PYTHON, namespaces: 'nvidia', distributions: [] }, /names no namespace packages/);
    refused({ version: 1, python: TIER_PYTHON, namespaces: ['nvidia', 3], distributions: [] }, /names no namespace packages/);
    refused({ version: 1, python: TIER_PYTHON, namespaces: ['nvidia/cudnn'], distributions: [] }, /names no namespace packages/);
  });

  it('lists the files a record names in the site directory, as written, and none installed outside it', () => {
    assert.deepEqual(recordedSiteFiles(RECORD).map(({ file }) => file), [
      'idna-3.20.dist-info/INSTALLER', 'idna-3.20.dist-info/METADATA', 'idna-3.20.dist-info/RECORD', 'idna-3.20.dist-info/REQUESTED',
      'idna/__init__.py', 'idna/core.py',
    ]);
    assert.deepEqual(recordedSiteFiles('"pkg/a,b.py",sha256=x,1\n'), [{ file: 'pkg/a,b.py', digest: 'sha256=x', size: '1' }]);
  });

  it('leaves to a tier each distribution it holds the same, and a family that shares a package only when it holds every one of it', () => {
    const record = (...files: string[]): string => files.map((file) => `${file},sha256=${file.length},1\n`).join('');
    const installed = [
      { name: 'six', version: '1.17.0', record: record('six.py', 'six-1.17.0.dist-info/METADATA', '__pycache__/six.cpython-311.pyc') },
      { name: 'idna', version: '3.10', record: record('idna/__init__.py', 'idna-3.10.dist-info/METADATA', '__pycache__/idna.cpython-311.pyc') },
      { name: 'nvidia-cublas', version: '12.0', record: record('nvidia/__init__.py', 'nvidia/cublas/lib.so', 'nvidia_cublas-12.0.dist-info/METADATA') },
      { name: 'nvidia-cudnn', version: '9.0', record: record('nvidia/__init__.py', 'nvidia/cudnn/lib.so', 'nvidia_cudnn-9.0.dist-info/METADATA') },
      { name: 'Own_Pkg', version: '0.1.0', record: record('own_pkg/__init__.py', 'own_pkg-0.1.0.dist-info/METADATA') },
    ];
    // The tier names `nvidia` a namespace package, and it is none here: these distributions give it an `__init__` module
    const held = (names: string[], version?: Record<string, string>): TierManifest => ({ version: 1, python: TIER_PYTHON, namespaces: ['nvidia'],
      distributions: installed.filter(({ name }) => names.includes(name))
        .map(({ name, version: own, record: files }) => ({ name: canonicalDistributionName(name), version: version?.[name] ?? own, files: installedFilesDigest(files) })) });
    const left = (manifest: TierManifest): string[] => [...leftToTier(installed, manifest)].sort();
    assert.deepEqual(left(held([])), []);
    assert.deepEqual(left(held(['six', 'idna', 'nvidia-cublas', 'nvidia-cudnn'])), ['idna', 'nvidia-cublas', 'nvidia-cudnn', 'six'],
      'modules that share only the directory of compiled files are apart');
    assert.deepEqual(left(held(['six', 'nvidia-cublas'])), ['six'], 'a part of nvidia/ left to the tier would be hidden by the part that ships');
    assert.deepEqual(left(held(['six', 'idna'], { idna: '3.11' })), ['six'], 'another version ships');
    assert.deepEqual(left(held(['Own_Pkg'])), ['own-pkg'], 'named as PEP 503 names it');
  });

  it('leaves the parts of a namespace package singly, where the tier names it one and no distribution gives it an __init__ module', () => {
    const record = (...files: string[]): string => files.map((file) => `${file},sha256=${file.length},1\n`).join('');
    const installed = [
      // torch's libraries, each in its own directory of `nvidia/`, which has no `__init__` module
      { name: 'nvidia-cudnn-cu13', version: '9.26', record: record('nvidia/cudnn/lib/libcudnn.so.9', 'nvidia/cudnn/__init__.py', 'nvidia_cudnn_cu13-9.26.dist-info/METADATA') },
      { name: 'nvidia-cublas', version: '13.4', record: record('nvidia/cu13/lib/libcublas.so.13', 'nvidia_cublas-13.4.dist-info/METADATA') },
      { name: 'nvidia-cufft', version: '12.2', record: record('nvidia/cu13/lib/libcufft.so.12', 'nvidia/__pycache__/x.cpython-311.pyc', 'nvidia_cufft-12.2.dist-info/METADATA') },
      // Two that share `nvidia/nccl`: torch's and xgboost's
      { name: 'nvidia-nccl-cu13', version: '2.30', record: record('nvidia/nccl/lib/libnccl.so.2', 'nvidia_nccl_cu13-2.30.dist-info/METADATA') },
      { name: 'nvidia-nccl-cu12', version: '2.32', record: record('nvidia/nccl/lib/libnccl.so.2', 'nvidia/nccl/include/nccl.h', 'nvidia_nccl_cu12-2.32.dist-info/METADATA') },
      // A module directly in the namespace package, and a package beside it
      { name: 'cuda-bindings', version: '13.5', record: record('cuda/ccuda.so', 'cuda/bindings/__init__.py', 'cuda_bindings-13.5.dist-info/METADATA') },
      { name: 'cuda-pathfinder', version: '1.9', record: record('cuda/pathfinder/__init__.py', 'cuda_pathfinder-1.9.dist-info/METADATA') },
      // A namespace package inside one: one level is read
      { name: 'ns-cloud-a', version: '1', record: record('outer/cloud/a/__init__.py', 'ns_cloud_a-1.dist-info/METADATA') },
      { name: 'ns-cloud-b', version: '1', record: record('outer/cloud/b/__init__.py', 'ns_cloud_b-1.dist-info/METADATA') },
      // A directory the tier does not name
      { name: 'unnamed-a', version: '1', record: record('unnamed/a/__init__.py', 'unnamed_a-1.dist-info/METADATA') },
      { name: 'unnamed-b', version: '1', record: record('unnamed/b/__init__.py', 'unnamed_b-1.dist-info/METADATA') },
    ];
    const names = installed.map(({ name }) => name);
    /** A tier that holds each of these but the ones named, and says which of its packages are namespace packages. */
    const tier = (without: string[], namespaces: string[] = ['cuda', 'nvidia', 'outer']): TierManifest => ({ version: 1, python: TIER_PYTHON, namespaces,
      distributions: installed.filter(({ name }) => !without.includes(name))
        .map(({ name, version, record: files }) => ({ name, version, files: installedFilesDigest(files) })) });
    const shipped = (manifest: TierManifest): string[] => names.filter((name) => !leftToTier(installed, manifest).has(name));

    assert.deepEqual(shipped(tier([])), [], 'all the tier\'s: all left');
    // xgboost's library, which nothing pins, is not the tier's: it ships, with the one that shares its directory, and no other of `nvidia/`
    assert.deepEqual(shipped(tier(['nvidia-nccl-cu12'])), ['nvidia-nccl-cu13', 'nvidia-nccl-cu12']);
    // Those that share `nvidia/cu13` go together; a directory of compiled files binds nothing
    assert.deepEqual(shipped(tier(['nvidia-cufft'])), ['nvidia-cublas', 'nvidia-cufft']);
    assert.deepEqual(shipped(tier(['nvidia-cudnn-cu13'])), ['nvidia-cudnn-cu13']);
    // A package beside a module of its namespace package is apart from it
    assert.deepEqual(shipped(tier(['cuda-pathfinder'])), ['cuda-pathfinder']);
    // A namespace package inside one binds what shares it
    assert.deepEqual(shipped(tier(['ns-cloud-a'])), ['ns-cloud-a', 'ns-cloud-b']);
    // What the tier does not name a namespace package binds, as any package does
    assert.deepEqual(shipped(tier(['unnamed-a'])), ['unnamed-a', 'unnamed-b']);
    assert.deepEqual(shipped(tier(['cuda-pathfinder'], ['nvidia'])), ['cuda-bindings', 'cuda-pathfinder'], 'the tier\'s `cuda` may have an `__init__` module');
    assert.deepEqual(shipped(tier(['nvidia-nccl-cu12'], [])), names.filter((name) => name.startsWith('nvidia-')), 'no namespace packages named: the whole family');

    // One distribution here that gives the package an `__init__` module makes it an ordinary one, whatever the tier says
    const ordinary = [...installed, { name: 'nvidia-old', version: '1', record: record('nvidia/__init__.py', 'nvidia/old/lib.so', 'nvidia_old-1.dist-info/METADATA') }];
    const left = leftToTier(ordinary, { ...tier(['nvidia-nccl-cu12']), distributions: [...tier(['nvidia-nccl-cu12']).distributions,
      { name: 'nvidia-old', version: '1', files: installedFilesDigest(ordinary.at(-1)!.record) }] });
    assert.deepEqual(ordinary.map(({ name }) => name).filter((name) => name.startsWith('nvidia-') && left.has(name)), [], 'none of the family is left');
    // An extension module is an `__init__` module too
    const extension = [...installed, { name: 'nvidia-ext', version: '1', record: record('nvidia/__init__.cpython-311-x86_64-linux-gnu.so', 'nvidia_ext-1.dist-info/METADATA') }];
    assert.equal(leftToTier(extension, tier(['nvidia-nccl-cu12'])).has('nvidia-cudnn-cu13'), false);
  });

  it('tells whether a Python meets a lock\'s requires-python, and reads its minor release', () => {
    const meets: Array<[string, string, boolean]> = [
      ['3.11.2', '>=3.11', true], ['3.11.2', '>=3.12', false], ['3.11.2', '>=3.11,<3.14', true], ['3.14.0', '>=3.11,<3.14', false],
      ['3.11.2', '>3.11', true], ['3.11.0', '>3.11', false], ['3.11.2', '<=3.11', false], ['3.11.0', '<=3.11', true],
      ['3.11.2', '==3.11.*', true], ['3.12.1', '==3.11.*', false], ['3.11.2', '==3.11.2', true], ['3.11.2', '==3.11', false],
      ['3.11.2', '!=3.11.*', false], ['3.12.1', '!=3.11.*', true], ['3.11.2', '!=3.11.2', false],
      ['3.11.2', '~=3.11', true], ['4.0.0', '~=3.11', false], ['3.11.2', '~=3.11.1', true], ['3.12.0', '~=3.11.1', false],
      ['3.11.2', ' >= 3.11 , < 4 ', true], ['3.13.0rc1', '>=3.13', true], ['3.11.2', '', true],
      // What it does not read is not met: the environment is then built whole
      ['3.11.2', '===3.11.2', false], ['3.11.2', '>=3.11.*', false], ['3.11.2', 'latest', false], ['unknown', '>=3.11', false],
    ];
    for (const [version, specifier, expected] of meets) assert.equal(pythonSatisfies(version, specifier), expected, `${version} ${specifier}`);
    assert.equal(pythonMinor('3.11.2'), '3.11');
    assert.equal(pythonMinor('3.13.0rc1'), '3.13');
    assert.throws(() => pythonMinor('3'), /names no Python minor release/);
  });

  it('is written by the image\'s script as this module reads and digests it: the same install, the same bytes',
    { skip: process.platform === 'win32' ? 'a runtime image is Linux' : uvOnPath() ? false : 'uv not on PATH' }, () => {
      const dir = mkdtempSync(join(tmpdir(), 'e3-tier-'));
      try {
        execFileSync('uv', ['venv', join(dir, 'venv')], { stdio: 'ignore' });
        const python = join(dir, 'venv', 'bin', 'python');
        execFileSync('uv', ['pip', 'install', '--python', python, 'idna==3.10', 'six==1.17.0'], { stdio: 'ignore' });
        const bytes = Buffer.from(tierManifestOf(python));
        assert.deepEqual(Buffer.from(tierManifestOf(python)), bytes, 'the same image writes the same bytes, so its digest names it');
        const manifest = readTierManifest(bytes);
        assert.equal(manifest.python.executable, python);
        // The interpreter the virtualenv was made from, which one made over the tier runs
        assert.equal(manifest.python.base, execFileSync(python, ['-c', 'import sys; print(sys._base_executable)'], { encoding: 'utf8' }).trim());
        assert.notEqual(manifest.python.base, python);
        assert.deepEqual(manifest.distributions.map(({ name, version }) => `${name}==${version}`), ['idna==3.10', 'six==1.17.0']);
        // Its namespace packages: each directory of the site directory with no `__init__` module, which idna's is not
        assert.ok(!manifest.namespaces.includes('idna') && manifest.namespaces.every((name) => !name.endsWith('.dist-info') && name !== '__pycache__'),
          manifest.namespaces.join(', '));
        for (const [name, file] of [['zz_namespace', 'part/__init__.py'], ['aa_namespace', 'module.py'], ['ordinary', '__init__.py'], ['extension', '__init__.cpython-311-x86_64-linux-gnu.so']] as const) {
          mkdirSync(join(manifest.python.site, name, ...file.split('/').slice(0, -1)), { recursive: true });
          writeFileSync(join(manifest.python.site, name, file), '');
        }
        const named = readTierManifest(Buffer.from(tierManifestOf(python))).namespaces;
        assert.deepEqual(named.filter((name) => !manifest.namespaces.includes(name)), ['aa_namespace', 'zz_namespace'], 'sorted, and none that has an `__init__` module');
        // This module's digest of each installed distribution is the script's
        for (const held of manifest.distributions) {
          const info = readdirSync(manifest.python.site).find((entry) => entry.endsWith('.dist-info') && canonicalDistributionName(entry).startsWith(`${held.name}-`))!;
          assert.equal(installedFilesDigest(readFileSync(join(manifest.python.site, info, 'RECORD'), 'utf8')), held.files, held.name);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
});
