/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalDistributionName, installedFilesDigest, leftToTier, pythonMinor, pythonSatisfies, readTierManifest, recordedSiteFiles, tierHolds, tierManifestDigest,
  type TierManifest,
} from './tier-manifest.js';

/** The script a runtime image writes its manifest with: the spec runs from `dist/src`. */
const SCRIPT = fileURLToPath(new URL('../../../../../../docker/images/tier-manifest.py', import.meta.url));

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
    const manifest: TierManifest = { version: 1, python: TIER_PYTHON,
      distributions: [{ name: 'torch', version: '2.9.0+cu130', files: 'sha256:aa' }, { name: 'elaraai-east-py', version: '1.0.109', files: 'sha256:bb' }] };
    assert.equal(tierHolds(manifest, { name: 'torch', version: '2.9.0+cu130', files: 'sha256:aa' }), true);
    assert.equal(tierHolds(manifest, { name: 'Elaraai_East.Py', version: '1.0.109', files: 'sha256:bb' }), true, 'by its PEP 503 name');
    assert.equal(tierHolds(manifest, { name: 'torch', version: '2.9.0+cpu', files: 'sha256:aa' }), false, 'a local label is part of the version');
    assert.equal(tierHolds(manifest, { name: 'torch', version: '2.9.0+cu130', files: 'sha256:cc' }), false, 'never by name and version alone');
    assert.equal(tierHolds(manifest, { name: 'numpy', version: '2.0.0', files: 'sha256:aa' }), false);
    assert.equal(canonicalDistributionName('Typing_Extensions'), 'typing-extensions');
  });

  it('reads a manifest of the form it knows, and refuses any other by what is wrong with it', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, python: TIER_PYTHON,
      distributions: [{ name: 'Typing_Extensions', version: '4.12.2', files: 'sha256:aa' }] }));
    assert.deepEqual(readTierManifest(bytes).distributions, [{ name: 'typing-extensions', version: '4.12.2', files: 'sha256:aa' }]);
    assert.deepEqual(readTierManifest(bytes).python, TIER_PYTHON);
    assert.match(tierManifestDigest(bytes), /^sha256:[0-9a-f]{64}$/);
    const refused = (value: unknown, words: RegExp): void => { assert.throws(() => readTierManifest(new TextEncoder().encode(JSON.stringify(value))), words); };
    assert.throws(() => readTierManifest(new TextEncoder().encode('not json')), /is not JSON/);
    refused({ version: 2 }, /not of the form this e3 reads/);
    refused({ version: 1 }, /names no interpreter/);
    refused({ version: 1, python: { ...TIER_PYTHON, executable: '' }, distributions: [] }, /names no interpreter$/);
    refused({ version: 1, python: { version: '3.11.2', executable: '/p', site: '/s' }, distributions: [] }, /names no base interpreter/);
    refused({ version: 1, python: TIER_PYTHON }, /lists no distributions/);
    refused({ version: 1, python: TIER_PYTHON, distributions: [{ name: 'a', version: '1' }] }, /files digest/);
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
    const held = (names: string[], version?: Record<string, string>): TierManifest => ({ version: 1, python: TIER_PYTHON,
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

  const hasUv = ((): boolean => {
    try { execFileSync('uv', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
  })();

  it('is written by the image\'s script as this module reads and digests it: the same install, the same bytes',
    { skip: process.platform === 'win32' ? 'a runtime image is Linux' : hasUv ? false : 'uv not on PATH' }, () => {
      const dir = mkdtempSync(join(tmpdir(), 'e3-tier-'));
      try {
        execFileSync('uv', ['venv', join(dir, 'venv')], { stdio: 'ignore' });
        const python = join(dir, 'venv', 'bin', 'python');
        execFileSync('uv', ['pip', 'install', '--python', python, 'idna==3.10', 'six==1.17.0'], { stdio: 'ignore' });
        const write = (name: string): Buffer => {
          execFileSync(python, [SCRIPT, join(dir, name)], { stdio: 'ignore' });
          return readFileSync(join(dir, name));
        };
        const bytes = write('tier-manifest.json');
        assert.deepEqual(write('again.json'), bytes, 'the same image writes the same bytes, so its digest names it');
        const manifest = readTierManifest(bytes);
        assert.equal(manifest.python.executable, python);
        // The interpreter the virtualenv was made from, which one made over the tier runs
        assert.equal(manifest.python.base, execFileSync(python, ['-c', 'import sys; print(sys._base_executable)'], { encoding: 'utf8' }).trim());
        assert.notEqual(manifest.python.base, python);
        assert.deepEqual(manifest.distributions.map(({ name, version }) => `${name}==${version}`), ['idna==3.10', 'six==1.17.0']);
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
