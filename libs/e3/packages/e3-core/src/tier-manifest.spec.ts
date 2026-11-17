/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { canonicalPythonName } from '@elaraai/e3';
import {
  installedFilesDigest, leftToTier, pythonMinor, pythonSatisfies, readDistributionMetadata, readTierManifest, recordedSiteFiles, tierHolds,
  tierImports, tierManifestDigest, type InstalledDistribution, type TierManifest,
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

/** The script a tier image writes its manifest with: a file of this package. */
const SCRIPT = fileURLToPath(new URL('../../tier/tier-manifest.py', import.meta.url));

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

  it('sorts a distribution\'s files by code point, as the image\'s script does: a character above U+FFFF after one of U+E000 to U+FFFF', () => {
    // UTF-16 puts U+1F600 (a surrogate pair from U+D83D) before U+E000; code points do not
    const lines = 'pkg/\uE000.py\tsha256=a\t1\npkg/\u{1F600}.py\tsha256=b\t1\n';
    const digest = `sha256:${createHash('sha256').update(lines, 'utf8').digest('hex')}`;
    assert.equal(installedFilesDigest('pkg/\u{1F600}.py,sha256=b,1\npkg/\uE000.py,sha256=a,1\n'), digest);
    assert.equal(installedFilesDigest('pkg/\uE000.py,sha256=a,1\npkg/\u{1F600}.py,sha256=b,1\n'), digest);
  });

  it('digests a record as the image\'s script does, by running it', { skip: process.platform === 'win32' ? 'a runtime image is Linux' : false }, () => {
    const record = ['pkg/\u{1F600}.py,sha256=b,1', 'pkg/\uE000.py,sha256=a,1', '"pkg/a,b.py",sha256=c,2', 'pkg-1.0.dist-info/RECORD,,', '../../../bin/pkg,sha256=d,3', ''].join('\n');
    const script = 'import importlib.util, sys\n' +
      'spec = importlib.util.spec_from_file_location("tier_manifest", sys.argv[1])\n' +
      'module = importlib.util.module_from_spec(spec)\n' +
      'spec.loader.exec_module(module)\n' +
      'print(module.files_digest(sys.stdin.read()))\n';
    assert.equal(execFileSync('python3', ['-c', script, SCRIPT], { input: record, encoding: 'utf8' }).trim(), installedFilesDigest(record));
  });

  it('says a tier holds a distribution only of that name, that version and the same files', () => {
    const manifest: TierManifest = { version: 1, python: TIER_PYTHON, namespaces: [],
      distributions: [{ name: 'torch', version: '2.9.0+cu130', files: 'sha256:aa' }, { name: 'elaraai-east-py', version: '1.0.109', files: 'sha256:bb' }] };
    assert.equal(tierHolds(manifest, { name: 'torch', version: '2.9.0+cu130', files: 'sha256:aa' }), true);
    assert.equal(tierHolds(manifest, { name: 'Elaraai_East.Py', version: '1.0.109', files: 'sha256:bb' }), true, 'by its PEP 503 name');
    assert.equal(tierHolds(manifest, { name: 'torch', version: '2.9.0+cpu', files: 'sha256:aa' }), false, 'a local label is part of the version');
    assert.equal(tierHolds(manifest, { name: 'torch', version: '2.9.0+cu130', files: 'sha256:cc' }), false, 'never by name and version alone');
    assert.equal(tierHolds(manifest, { name: 'numpy', version: '2.0.0', files: 'sha256:aa' }), false);
    assert.equal(canonicalPythonName('Typing_Extensions'), 'typing-extensions');
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

    // What an environment built over the tier writes of it: a Python's version, and absolute paths, each on one line
    const python = (fields: Partial<typeof TIER_PYTHON>): unknown => ({ version: 1, python: { ...TIER_PYTHON, ...fields }, namespaces: [], distributions: [] });
    for (const version of ['3.11.2\ninclude-system-site-packages = true', '3.11', 'latest', '3.11.2 ']) {
      refused(python({ version }), /interpreter version .* is not a Python's/);
    }
    refused(python({ base: 'python3' }), /base interpreter "python3" is not an absolute path/);
    refused(python({ base: '/usr/bin/python3\nversion_info = 3.99' }), /base interpreter .* is not an absolute path/);
    refused(python({ site: 'lib/site-packages' }), /site directory .* is not an absolute path/);
    refused(python({ site: '/opt/venv/site\u0000' }), /site directory .* is not an absolute path/);
    refused(python({ executable: '/opt/venv/bin/python\r' }), /interpreter .* is not an absolute path/);
    for (const version of ['3.13.0rc1', '3.14.0a1+', '3.11.12']) {
      assert.equal(readTierManifest(new TextEncoder().encode(JSON.stringify(python({ version })))).python.version, version);
    }
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
    const installed: InstalledDistribution[] = [
      { name: 'six', version: '1.17.0', record: record('six.py', 'six-1.17.0.dist-info/METADATA', '__pycache__/six.cpython-311.pyc') },
      { name: 'idna', version: '3.10', record: record('idna/__init__.py', 'idna-3.10.dist-info/METADATA', '__pycache__/idna.cpython-311.pyc') },
      { name: 'nvidia-cublas', version: '12.0', record: record('nvidia/__init__.py', 'nvidia/cublas/lib.so', 'nvidia_cublas-12.0.dist-info/METADATA') },
      { name: 'nvidia-cudnn', version: '9.0', record: record('nvidia/__init__.py', 'nvidia/cudnn/lib.so', 'nvidia_cudnn-9.0.dist-info/METADATA') },
      { name: 'Own_Pkg', version: '0.1.0', record: record('own_pkg/__init__.py', 'own_pkg-0.1.0.dist-info/METADATA') },
    ].map((distribution) => ({ ...distribution, requires: [] }));
    // The tier names `nvidia` a namespace package, and it is none here: these distributions give it an `__init__` module
    const held = (names: string[], version?: Record<string, string>): TierManifest => ({ version: 1, python: TIER_PYTHON, namespaces: ['nvidia'],
      distributions: installed.filter(({ name }) => names.includes(name))
        .map(({ name, version: own, record: files }) => ({ name: canonicalPythonName(name), version: version?.[name] ?? own, files: installedFilesDigest(files) })) });
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
    const installed: InstalledDistribution[] = [
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
    ].map((distribution) => ({ ...distribution, requires: [] }));
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
    const ordinary = [...installed, { name: 'nvidia-old', version: '1', requires: [], record: record('nvidia/__init__.py', 'nvidia/old/lib.so', 'nvidia_old-1.dist-info/METADATA') }];
    const left = leftToTier(ordinary, { ...tier(['nvidia-nccl-cu12']), distributions: [...tier(['nvidia-nccl-cu12']).distributions,
      { name: 'nvidia-old', version: '1', files: installedFilesDigest(ordinary.at(-1)!.record) }] });
    assert.deepEqual(ordinary.map(({ name }) => name).filter((name) => name.startsWith('nvidia-') && left.has(name)), [], 'none of the family is left');
    // An extension module is an `__init__` module too
    const extension = [...installed, { name: 'nvidia-ext', version: '1', requires: [], record: record('nvidia/__init__.cpython-311-x86_64-linux-gnu.so', 'nvidia_ext-1.dist-info/METADATA') }];
    assert.equal(leftToTier(extension, tier(['nvidia-nccl-cu12'])).has('nvidia-cudnn-cu13'), false);
  });

  it('ships the distributions of native code that a shipped distribution of native code requires, which it finds under the environment\'s own site directory', () => {
    const record = (...files: string[]): string => files.map((file) => `${file},sha256=${file.length},1\n`).join('');
    const installed: InstalledDistribution[] = [
      // torch's own library finds its NVIDIA libraries by a RUNPATH relative to itself: $ORIGIN/../../nvidia/<library>/lib
      { name: 'torch', version: '2.15.0', requires: ['nvidia-cublas', 'nvidia-cudnn', 'filelock', 'not-installed'],
        record: record('torch/__init__.py', 'torch/lib/libtorch_cuda.so', 'torch-2.15.0.dist-info/METADATA') },
      { name: 'nvidia-cublas', version: '13.4', requires: [], record: record('nvidia/cublas/lib/libcublas.so.13', 'nvidia_cublas-13.4.dist-info/METADATA') },
      // One that requires a library of its own in turn, and shares its directory with a distribution of no native code
      { name: 'nvidia-cudnn', version: '9.26', requires: ['Nvidia_Cudnn.Ops'], record: record('nvidia/cudnn/lib/libcudnn.so.9', 'nvidia_cudnn-9.26.dist-info/METADATA') },
      { name: 'nvidia-cudnn-ops', version: '9.26', requires: [], record: record('nvidia/cudnn_ops/lib/libcudnn_ops.so.9', 'nvidia_cudnn_ops-9.26.dist-info/METADATA') },
      { name: 'nvidia-cudnn-headers', version: '9.26', requires: [], record: record('nvidia/cudnn/include/cudnn.h', 'nvidia_cudnn_headers-9.26.dist-info/METADATA') },
      { name: 'filelock', version: '3.20.0', requires: [], record: record('filelock/__init__.py', 'filelock-3.20.0.dist-info/METADATA') },
      // A distribution of no native code that requires one of native code
      { name: 'helper', version: '1.0', requires: ['numpy'], record: record('helper/__init__.py', 'helper-1.0.dist-info/METADATA') },
      { name: 'numpy', version: '2.4.4', requires: [], record: record('numpy/__init__.py', 'numpy/_core/_multiarray_umath.cpython-311-x86_64-linux-gnu.so', 'numpy-2.4.4.dist-info/METADATA') },
    ];
    const names = installed.map(({ name }) => name);
    /** A tier that holds each of these but the ones named. */
    const tier = (without: string[]): TierManifest => ({ version: 1, python: TIER_PYTHON, namespaces: ['nvidia'],
      distributions: installed.filter(({ name }) => !without.includes(name))
        .map(({ name, version, record: files }) => ({ name, version, files: installedFilesDigest(files) })) });
    const shipped = (manifest: TierManifest): string[] => names.filter((name) => !leftToTier(installed, manifest).has(name));

    assert.deepEqual(shipped(tier([])), [], 'all the tier\'s: all left');
    // Another torch than the tier's: its libraries ship with it, theirs in turn, and what shares a directory with one;
    // filelock, of no native code, stays the tier's
    assert.deepEqual(shipped(tier(['torch'])), ['torch', 'nvidia-cublas', 'nvidia-cudnn', 'nvidia-cudnn-ops', 'nvidia-cudnn-headers']);
    // One that is left to the tier takes nothing: the tier's torch finds the tier's libraries the same way
    assert.deepEqual(shipped(tier(['nvidia-cudnn'])), ['nvidia-cudnn', 'nvidia-cudnn-ops', 'nvidia-cudnn-headers']);
    // A distribution of no native code that ships finds the native code it requires through Python's path, which holds the tier's
    assert.deepEqual(shipped(tier(['helper'])), ['helper']);
  });

  it('says what an environment imports from its tier: the names of what it left there, the namespace packages both hold parts of, and their path files', () => {
    const record = (...files: string[]): string => files.map((file) => `${file},sha256=${file.length},1\n`).join('');
    const installed: InstalledDistribution[] = [
      // A module, its bytecode at the top of the site directory
      { name: 'six', version: '1.17.0', record: record('six.py', '__pycache__/six.cpython-311.pyc', 'six-1.17.0.dist-info/METADATA') },
      // Two packages and the path file that runs one of them, and what is no package's name
      { name: 'setuptools', version: '82.0.1', record: record('setuptools/__init__.py', '_distutils_hack/__init__.py', 'distutils-precedence.pth',
        'setuptools-82.0.1.dist-info/METADATA') },
      { name: 'numpy', version: '2.4.4', record: record('numpy/__init__.py', 'numpy.libs/libscipy_openblas.so', 'LICENSE.txt',
        'numpy/_core/_multiarray_umath.cpython-311-x86_64-linux-gnu.so', 'numpy-2.4.4.dist-info/METADATA') },
      // Parts of a namespace package both hold parts of, one left and one shipped; and an extension module directly in it
      { name: 'nvidia-cudnn', version: '9.26', record: record('nvidia/cudnn/__init__.py', 'nvidia/cudnn/lib/libcudnn.so.9', 'nvidia_cudnn-9.26.dist-info/METADATA') },
      { name: 'nvidia-cublas', version: '13.4', record: record('nvidia/cublas/__init__.py', 'nvidia_cublas-13.4.dist-info/METADATA') },
      { name: 'nvidia-tools', version: '1', record: record('nvidia/_tools.cpython-311-x86_64-linux-gnu.so', 'nvidia_tools-1.dist-info/METADATA') },
    ].map((distribution) => ({ ...distribution, requires: [] }));
    // The tier holds all but nvidia-cublas, and names two namespace packages: one the environment holds no part of
    const manifest: TierManifest = { version: 1, python: TIER_PYTHON, namespaces: ['google', 'nvidia'],
      distributions: installed.filter(({ name }) => name !== 'nvidia-cublas')
        .map(({ name, version, record: files }) => ({ name, version, files: installedFilesDigest(files) })) };
    assert.deepEqual(tierImports(installed, manifest), {
      distributions: ['numpy', 'nvidia-cudnn', 'nvidia-tools', 'setuptools', 'six'],
      roots: ['_distutils_hack', 'numpy', 'nvidia._tools', 'nvidia.cudnn', 'setuptools', 'six'],
      namespaces: ['nvidia'],
      pathFiles: ['distutils-precedence.pth'],
    });
    // Left to the tier as nvidia/ binds them, by name, when the tier does not name it a namespace package: the whole of it
    assert.deepEqual(tierImports(installed, { ...manifest, namespaces: [] }).roots, ['_distutils_hack', 'numpy', 'setuptools', 'six']);
  });

  it('reads a distribution\'s name, version and what it requires from its metadata\'s headers alone', () => {
    const metadata = [
      'Metadata-Version: 2.4', 'Name: torch', 'Version: 2.15.0', 'Requires-Dist: filelock',
      'Requires-Dist: nvidia-cublas==13.1.0.3; platform_system == "Linux" and platform_machine == "x86_64"',
      'Requires-Dist: Typing_Extensions>=4.10.0', 'Requires-Dist: opt-einsum>=3.3; extra == "opt-einsum"', 'Provides-Extra: opt-einsum',
      // The description, which is the package's own text
      '', 'Name: not-a-header', 'Requires-Dist: not-a-header', '',
    ].join('\r\n');
    assert.deepEqual(readDistributionMetadata(metadata), { name: 'torch', version: '2.15.0', requires: ['filelock', 'nvidia-cublas', 'Typing_Extensions', 'opt-einsum'] });
    assert.equal(readDistributionMetadata('Metadata-Version: 2.1\nName: no-version\n'), null);
    assert.equal(readDistributionMetadata('Metadata-Version: 2.1\nVersion: 1.0\n'), null);
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

  it('ships its script as a file of this package, found by the package\'s own name', () => {
    // An image built elsewhere for a tier takes the script from the release's package
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { files: string[]; exports: Record<string, unknown> };
    assert.ok(manifest.files.includes('tier'), manifest.files.join(', '));
    assert.equal(manifest.exports['./tier/*'], './tier/*');
    const script = createRequire(import.meta.url).resolve('@elaraai/e3-core/tier/tier-manifest.py');
    assert.equal(realpathSync(script), realpathSync(fileURLToPath(new URL('../../tier/tier-manifest.py', import.meta.url))));
    assert.match(readFileSync(script, 'utf8'), /^#!\/usr\/bin\/env python3\n/);
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

        // A runtime image's own shape: its packages in a virtualenv that the
        // system's interpreter made itself (`python3 -m venv /opt/venv`)
        const image = join(dir, 'image');
        execFileSync(manifest.python.base, ['-m', 'venv', '--without-pip', image], { stdio: 'ignore' });
        const imagePython = join(image, 'bin', 'python');
        execFileSync('uv', ['pip', 'install', '--python', imagePython, 'idna==3.10'], { stdio: 'ignore' });
        const made = readTierManifest(Buffer.from(tierManifestOf(imagePython)));
        const home = /^home\s*=\s*(.*?)\s*$/m.exec(readFileSync(join(image, 'pyvenv.cfg'), 'utf8'))![1]!;
        assert.equal(made.python.executable, imagePython);
        // The interpreter that made it, in the directory the virtualenv calls its home: what an
        // environment built over this tier names as its own home, where the standard library is found
        assert.ok(!made.python.base.startsWith(image), made.python.base);
        assert.equal(realpathSync(dirname(made.python.base)), realpathSync(home));
        assert.ok(made.python.site.startsWith(join(image, 'lib')) && made.python.site.endsWith('site-packages'), made.python.site);
        assert.equal(made.python.version, manifest.python.version);
        assert.deepEqual(made.distributions.map(({ name, version }) => `${name}==${version}`), ['idna==3.10']);

        // The distributions of its site directory alone, which an environment
        // built over it adds to its path: not one PYTHONPATH adds
        const elsewhere = join(dir, 'elsewhere');
        mkdirSync(join(elsewhere, 'elsewhere-1.0.dist-info'), { recursive: true });
        writeFileSync(join(elsewhere, 'elsewhere-1.0.dist-info', 'METADATA'), 'Metadata-Version: 2.1\nName: elsewhere\nVersion: 1.0\n');
        writeFileSync(join(elsewhere, 'elsewhere-1.0.dist-info', 'RECORD'), 'elsewhere.py,sha256=x,1\nelsewhere-1.0.dist-info/RECORD,,\n');
        const out = join(dir, 'manifest.json');
        execFileSync(imagePython, [SCRIPT, out], { env: { ...process.env, PYTHONPATH: elsewhere } });
        assert.deepEqual(readTierManifest(readFileSync(out)).distributions.map(({ name }) => name), ['idna']);
        // Two of one name in it, which no install makes: which files are whose cannot be told, so neither is the tier's
        const twice = join(made.python.site, 'idna-9.9.dist-info');
        mkdirSync(twice);
        writeFileSync(join(twice, 'METADATA'), 'Metadata-Version: 2.1\nName: IDNA\nVersion: 9.9\n');
        writeFileSync(join(twice, 'RECORD'), 'idna/__init__.py,sha256=y,2\nidna-9.9.dist-info/RECORD,,\n');
        execFileSync(imagePython, [SCRIPT, out]);
        assert.deepEqual(readTierManifest(readFileSync(out)).distributions, []);
        // This module's digest of each installed distribution is the script's
        for (const held of manifest.distributions) {
          const info = readdirSync(manifest.python.site).find((entry) => entry.endsWith('.dist-info') && canonicalPythonName(entry).startsWith(`${held.name}-`))!;
          assert.equal(installedFilesDigest(readFileSync(join(manifest.python.site, info, 'RECORD'), 'utf8')), held.files, held.name);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
});
