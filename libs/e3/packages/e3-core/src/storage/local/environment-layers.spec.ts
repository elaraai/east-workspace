/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { gunzipSync, gzipSync } from 'node:zlib';
import { extract as tarExtract, pack as tarPack, type Headers } from 'tar-stream';
import { BlobType, encodeBeast2For, variant } from '@elaraai/east';
import { EnvironmentSpecType } from '@elaraai/e3-types';
import { LocalStorage } from './index.js';
import { repoInit } from './repository.js';
import { EnvironmentTargetRefused, hostEnvironmentPlatform, type TargetEnvironment } from '../../execution/environment.js';
import { getPidStartTime } from '../../execution/processHelpers.js';
import { ENVIRONMENT_LAYER_ROOT, unpackEnvironmentLayer } from '../../environment-layer-unpack.js';
import {
  buildEnvironmentLayers, environmentLayerPath, environmentLayersDir, packEnvironmentLayers,
  readEnvironmentManifest, sweepEnvironmentLayers, type EnvironmentLayer,
} from './environment-layers.js';

/** An environment's file, as export stores it: a beast2 Blob of its bytes. */
const encodeFile = encodeBeast2For(BlobType);

/** What a layer's tar holds: each entry's header, and a file's bytes. */
async function entriesOf(file: string): Promise<Array<{ header: Headers; data: string }>> {
  const entries: Array<{ header: Headers; data: string }> = [];
  const extract = tarExtract();
  extract.on('entry', (header, stream, next) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => { entries.push({ header, data: Buffer.concat(chunks).toString('utf8') }); next(); });
  });
  await new Promise<void>((resolve, reject) => {
    extract.on('finish', resolve);
    extract.on('error', reject);
    Readable.from(gunzipSync(fs.readFileSync(file))).pipe(extract);
  });
  return entries;
}

describe('a repository\'s kept environment layers', {
  skip: process.platform === 'win32' ? 'POSIX alone: no environment is installed for another platform on Windows, so none is packed there' : false,
}, () => {
  let tmpDir: string;
  let repo: string;
  const storage = new LocalStorage();
  let trees = 0;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-env-layers-spec-'));
    repo = path.join(tmpDir, 'repo');
    await repoInit(repo);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** An installed tree as a python environment for another platform is: an
   *  interpreter, what the lock installs, and the project's own package. */
  function tree(files: Record<string, string> = {}): TargetEnvironment {
    const dir = path.join(tmpDir, `tree-${trees++}`);
    const write = (rel: string, data: string, mode = 0o644): void => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), data, { mode });
    };
    write('.python/cpython/bin/python3.12', 'interpreter', 0o755);
    write('.python/cpython/lib/libpython.so', 'library');
    write('.venv/pyvenv.cfg', 'home = ../.python/cpython/bin\n');
    fs.mkdirSync(path.join(dir, '.venv', 'bin'), { recursive: true });
    fs.symlinkSync('../../.python/cpython/bin/python3.12', path.join(dir, '.venv', 'bin', 'python'));
    write('.venv/bin/east-py', '#!/bin/sh\n', 0o755);
    write('.venv/lib/python3.12/site-packages/dep/__init__.py', 'DEP = 1\n');
    write('.venv/lib/python3.12/site-packages/dep/data.bin', 'x'.repeat(300));
    write('.venv/lib/python3.12/site-packages/own/__init__.py', 'OWN = 1\n');
    fs.mkdirSync(path.join(dir, '.venv', 'lib', 'python3.12', 'site-packages', 'empty'));
    for (const [rel, data] of Object.entries(files)) write(rel, data);
    return { dir, interpreter: '.python', project: ['.venv/lib/python3.12/site-packages/own/__init__.py', ...Object.keys(files)].sort(), fromTier: null };
  }

  it('packs a tree as its interpreter, its packages and its project, each under the environment\'s place, sorted, with no time or owner of this machine', async () => {
    const packed = await packEnvironmentLayers(repo, tree());
    assert.strictEqual(packed.layers.length, 3);
    assert.strictEqual(packed.fresh, 3);
    const [interpreter, packages, project] = await Promise.all(packed.layers.map((layer) => entriesOf(environmentLayerPath(repo, layer.digest))));
    const names = (entries: Array<{ header: Headers }>): string[] => entries.map((entry) => entry.header.name);
    const under = (rel: string): string => `${ENVIRONMENT_LAYER_ROOT}/${rel}`;

    assert.deepStrictEqual(names(interpreter!), ['var', 'var/task', ENVIRONMENT_LAYER_ROOT,
      under('.python'), under('.python/cpython'), under('.python/cpython/bin'), under('.python/cpython/bin/python3.12'),
      under('.python/cpython/lib'), under('.python/cpython/lib/libpython.so')]);
    assert.deepStrictEqual(names(packages!), ['var', 'var/task', ENVIRONMENT_LAYER_ROOT,
      under('.venv'), under('.venv/bin'), under('.venv/bin/east-py'), under('.venv/bin/python'),
      under('.venv/lib'), under('.venv/lib/python3.12'), under('.venv/lib/python3.12/site-packages'),
      under('.venv/lib/python3.12/site-packages/dep'), under('.venv/lib/python3.12/site-packages/dep/__init__.py'),
      under('.venv/lib/python3.12/site-packages/dep/data.bin'),
      under('.venv/lib/python3.12/site-packages/empty'),
      under('.venv/pyvenv.cfg')], 'what the lock installs, an empty directory among it, and no directory of the project\'s own');
    assert.deepStrictEqual(names(project!), ['var', 'var/task', ENVIRONMENT_LAYER_ROOT,
      under('.venv'), under('.venv/lib'), under('.venv/lib/python3.12'), under('.venv/lib/python3.12/site-packages'),
      under('.venv/lib/python3.12/site-packages/own'), under('.venv/lib/python3.12/site-packages/own/__init__.py')],
    'the project\'s own files, and the directories above them');

    for (const { header } of [...interpreter!, ...packages!, ...project!]) {
      assert.strictEqual(header.mtime?.getTime(), 0, `${header.name} has no time`);
      assert.deepStrictEqual([header.uid, header.gid, header.uname, header.gname], [0, 0, '', ''], `${header.name} has no owner`);
    }
    const entry = (entries: Array<{ header: Headers; data: string }>, rel: string) => entries.find((candidate) => candidate.header.name === under(rel))!;
    assert.deepStrictEqual([entry(interpreter!, '.python/cpython/bin/python3.12').header.mode, entry(interpreter!, '.python/cpython/lib/libpython.so').header.mode],
      [0o755, 0o644], 'a file may be run, or not');
    const link = entry(packages!, '.venv/bin/python').header;
    assert.deepStrictEqual([link.type, link.linkname], ['symlink', '../../.python/cpython/bin/python3.12']);
    assert.strictEqual(entry(project!, '.venv/lib/python3.12/site-packages/own/__init__.py').data, 'OWN = 1\n');

    for (const layer of packed.layers) {
      const bytes = fs.readFileSync(environmentLayerPath(repo, layer.digest));
      assert.strictEqual(layer.digest, `sha256:${createHash('sha256').update(bytes).digest('hex')}`, 'a layer is named by the SHA-256 of its bytes');
      assert.strictEqual(layer.sizeBytes, bytes.length);
    }
  });

  it('packs the same files to the same layers, and a change to the project\'s code to one new layer', async () => {
    const first = await packEnvironmentLayers(repo, tree());
    // The same files, written at another time.
    const again = await packEnvironmentLayers(repo, tree());
    assert.deepStrictEqual(again.layers, first.layers);
    assert.strictEqual(again.fresh, 0, 'nothing is written again');

    // The project's code changes, and adds a directory of its own.
    const changed = await packEnvironmentLayers(repo, tree({ '.venv/lib/python3.12/site-packages/own/more.py': 'MORE = 1\n',
      '.venv/lib/python3.12/site-packages/own/sub/__init__.py': '' }));
    assert.strictEqual(changed.fresh, 1);
    assert.deepStrictEqual(changed.layers.slice(0, 2), first.layers.slice(0, 2), 'the interpreter and the packages are the layers it had');
    assert.notStrictEqual(changed.layers[2]!.digest, first.layers[2]!.digest);
    assert.ok(!fs.readdirSync(path.join(environmentLayersDir(repo), 'blobs')).some((file) => file.endsWith('.partial')), 'no staging file is left');
  });

  it('splits the packages by the bytes of their files, in sorted order, and never a file', async () => {
    const packed = await packEnvironmentLayers(repo, tree(), 200);
    // The interpreter, the packages up to the file that would pass 200 bytes,
    // that file alone though it is more, what follows it, and the project.
    assert.strictEqual(packed.layers.length, 5);
    const files = await Promise.all(packed.layers.slice(1, 4).map(async (layer) =>
      (await entriesOf(environmentLayerPath(repo, layer.digest))).filter((entry) => entry.header.type !== 'directory')
        .map((entry) => entry.header.name.slice(ENVIRONMENT_LAYER_ROOT.length + 1))));
    assert.deepStrictEqual(files, [
      ['.venv/bin/east-py', '.venv/bin/python', '.venv/lib/python3.12/site-packages/dep/__init__.py'],
      ['.venv/lib/python3.12/site-packages/dep/data.bin'],
      ['.venv/pyvenv.cfg'],
    ]);
    await assert.rejects(packEnvironmentLayers(repo, tree(), 0), RangeError);
  });

  it('unpacks its layers to the tree it packed: every file, its mode, each link and the empty directory', async () => {
    const source = tree();
    const packed = await packEnvironmentLayers(repo, source);
    const root = path.join(tmpDir, 'guest');
    for (const layer of packed.layers) await unpackEnvironmentLayer(fs.createReadStream(environmentLayerPath(repo, layer.digest)), root);
    const dir = path.join(root, ENVIRONMENT_LAYER_ROOT);
    const walk = (base: string, at = ''): string[] => fs.readdirSync(path.join(base, at), { withFileTypes: true }).flatMap((entry) => {
      const rel = path.posix.join(at, entry.name);
      const stat = fs.lstatSync(path.join(base, rel));
      if (entry.isDirectory()) return [`${rel}/`, ...walk(base, rel)];
      if (entry.isSymbolicLink()) return [`${rel} -> ${fs.readlinkSync(path.join(base, rel))}`];
      return [`${rel} ${(stat.mode & 0o111) !== 0 ? 'x' : '-'} ${fs.readFileSync(path.join(base, rel), 'utf8')}`];
    });
    assert.deepStrictEqual(walk(dir), walk(source.dir));
    assert.strictEqual(fs.readFileSync(path.join(dir, '.venv', 'bin', 'python'), 'utf8'), 'interpreter', 'a link leads where it led');
  });

  it('packs each link as the path from it to what it leads to, which a layer writes and leads where it led', async () => {
    const source = tree();
    const bin = path.join(source.dir, '.venv', 'bin');
    fs.symlinkSync('./east-py', path.join(bin, 'dotted'));
    fs.symlinkSync('python', path.join(bin, 'python3'));
    fs.symlinkSync(path.join(source.dir, '.venv', 'pyvenv.cfg'), path.join(source.dir, '.venv', 'absolute-inside'));
    fs.symlinkSync('../lib/../missing', path.join(bin, 'dangling'));
    const packed = await packEnvironmentLayers(repo, source);
    const links = new Map((await Promise.all(packed.layers.map((layer) => entriesOf(environmentLayerPath(repo, layer.digest))))).flat()
      .filter(({ header }) => header.type === 'symlink').map(({ header }) => [header.name.slice(ENVIRONMENT_LAYER_ROOT.length + 1), header.linkname]));
    assert.deepStrictEqual(Object.fromEntries(links), {
      '.venv/bin/python': '../../.python/cpython/bin/python3.12',
      '.venv/bin/dotted': 'east-py',
      '.venv/bin/python3': '../../.python/cpython/bin/python3.12',
      '.venv/absolute-inside': 'pyvenv.cfg',
      '.venv/bin/dangling': '../missing',
    }, 'a link through a link names what it leads to; one that leads nowhere is its own text, as a layer writes it');
    const root = path.join(tmpDir, 'links-guest');
    for (const layer of packed.layers) await unpackEnvironmentLayer(fs.createReadStream(environmentLayerPath(repo, layer.digest)), root);
    const env = path.join(root, ENVIRONMENT_LAYER_ROOT);
    assert.deepStrictEqual(['.venv/bin/dotted', '.venv/bin/python3', '.venv/absolute-inside'].map((rel) => fs.readFileSync(path.join(env, rel), 'utf8')),
      ['#!/bin/sh\n', 'interpreter', 'home = ../.python/cpython/bin\n']);
  });

  it('refuses to pack a link that names a path outside its tree, and something that is no file, directory or link', async () => {
    for (const [target, what] of [['/usr/bin/python3', 'absolute'], ['../../outside', 'above the tree']] as const) {
      const source = tree();
      fs.symlinkSync(target, path.join(source.dir, '.venv', 'escape'));
      await assert.rejects(packEnvironmentLayers(repo, source), /the link '\.venv\/escape' names '.*', outside its tree/, what);
    }
    const source = tree();
    execFileSync('mkfifo', [path.join(source.dir, '.venv', 'pipe')]);
    await assert.rejects(packEnvironmentLayers(repo, source), /'\.venv\/pipe' is not a file, a directory or a link/);
  });

  describe('built for a platform', () => {
    const platform = hostEnvironmentPlatform() ?? 'x86_64-manylinux_2_28';
    const write = (bytes: Uint8Array): Promise<string> => storage.objects.write(repo, encodeFile(bytes));

    /** A node environment with no dependencies, whose project is one package
     *  holding `marker`. npm installs it with nothing fetched. */
    async function environment(marker: string): Promise<string> {
      const tar = tarPack();
      tar.entry({ name: 'package/package.json' }, JSON.stringify({ name: 'e3-layers-own', version: '1.0.0', main: 'index.js' }));
      tar.entry({ name: 'package/index.js' }, `module.exports.marker = ${JSON.stringify(marker)};\n`);
      tar.finalize();
      const chunks: Buffer[] = [];
      for await (const chunk of tar) chunks.push(chunk as Buffer);
      return storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(variant('node', {
        packageJson: await write(Buffer.from(JSON.stringify({ name: 'e3-layers-fixture', version: '1.0.0', private: true }))),
        lock: await write(Buffer.from(JSON.stringify({
          name: 'e3-layers-fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
          packages: { '': { name: 'e3-layers-fixture', version: '1.0.0' } },
        }))),
        tarballs: [await write(gzipSync(Buffer.concat(chunks)))],
      })));
    }
    const manifestOf = (layers: readonly EnvironmentLayer[]): string => JSON.stringify({ layers });
    const building = (): string[] => fs.readdirSync(path.join(environmentLayersDir(repo), 'building'));

    it('builds an environment\'s layers once: a second call, and one made while the first builds, are answered what it kept', async () => {
      const envHash = await environment('first');
      const name = `${envHash}-${platform}.json`;
      assert.strictEqual(await readEnvironmentManifest(repo, name), null);
      let builds = 0;
      const build = () => buildEnvironmentLayers(storage, repo, envHash, { platform }, name, manifestOf, { onBuilding: () => { builds++; } });
      const [a, b] = await Promise.all([build(), build()]);
      assert.strictEqual(builds, 1, 'one build');
      assert.strictEqual([a, b].filter((result) => result.built !== null).length, 1, 'one of the two built it');
      const built = (a.built ?? b.built)!;
      assert.strictEqual(a.manifest, b.manifest);
      assert.strictEqual(a.manifest, manifestOf(built.layers));
      assert.strictEqual(await readEnvironmentManifest(repo, name), a.manifest);
      assert.strictEqual(built.fresh, built.layers.length);
      assert.ok(built.ms >= 0);
      for (const layer of built.layers) assert.ok(fs.existsSync(environmentLayerPath(repo, layer.digest)));
      assert.deepStrictEqual(building(), [], 'no claim and no scratch tree is left');

      const again = await build();
      assert.deepStrictEqual(again, { manifest: a.manifest, built: null });
      assert.strictEqual(builds, 1, 'nothing is built again');

      // The project's code changes: the environment is another, and what its
      // lock installs is the layer it had.
      const changed = await environment('second');
      const next = await buildEnvironmentLayers(storage, repo, changed, { platform }, `${changed}-${platform}.json`, manifestOf);
      assert.strictEqual(next.built?.fresh, 1, 'one new layer');
      assert.deepStrictEqual(next.built?.layers.slice(0, -1), built.layers.slice(0, -1));

      // Composed from its layers, the environment is whole.
      const root = path.join(tmpDir, 'composed');
      for (const layer of next.built!.layers) await unpackEnvironmentLayer(fs.createReadStream(environmentLayerPath(repo, layer.digest)), root);
      const { marker } = (await import(path.join(root, ENVIRONMENT_LAYER_ROOT, 'node_modules', 'e3-layers-own', 'index.js'))) as { marker: string };
      assert.strictEqual(marker, 'second');
    });

    it('takes over the claim of a build whose builder died, and waits for one whose builder lives until it is told to stop', async () => {
      const envHash = await environment('claimed');
      const name = `${envHash}-${platform}.json`;
      const claim = path.join(environmentLayersDir(repo), 'building', `${name}.claim`);
      fs.mkdirSync(path.dirname(claim), { recursive: true });
      // This process's pid with another start time: a process that is gone.
      fs.writeFileSync(claim, `${process.pid} ${await getPidStartTime(process.pid) + 1}\n`);
      const taken = await buildEnvironmentLayers(storage, repo, envHash, { platform }, name, manifestOf);
      assert.ok(taken.built !== null, 'built over a dead builder\'s claim');

      const other = await environment('held');
      const held = `${other}-${platform}.json`;
      const live = path.join(environmentLayersDir(repo), 'building', `${held}.claim`);
      fs.writeFileSync(live, `${process.pid} ${await getPidStartTime(process.pid)}\n`);
      const stop = new AbortController();
      const waiting = buildEnvironmentLayers(storage, repo, other, { platform }, held, manifestOf, { signal: stop.signal, onBuilding: () => assert.fail('built under a live claim') });
      setTimeout(() => stop.abort(), 50);
      await assert.rejects(waiting, /the wait for another build was stopped/);
      assert.strictEqual(await readEnvironmentManifest(repo, held), null);
      fs.rmSync(live);

      // A claim that names no builder: its builder died before it named
      // itself. A fresh one is waited for; an old one is taken over.
      const unnamed = await environment('unnamed');
      const unnamedName = `${unnamed}-${platform}.json`;
      const blank = path.join(environmentLayersDir(repo), 'building', `${unnamedName}.claim`);
      fs.writeFileSync(blank, '');
      const pausing = new AbortController();
      const paused = buildEnvironmentLayers(storage, repo, unnamed, { platform }, unnamedName, manifestOf,
        { signal: pausing.signal, onBuilding: () => assert.fail('built under a fresh claim') });
      setTimeout(() => pausing.abort(), 50);
      await assert.rejects(paused, /the wait for another build was stopped/, 'a claim just made is its builder\'s, named or not');
      const longAgo = new Date(Date.now() - 60_000);
      fs.utimesSync(blank, longAgo, longAgo);
      const over = await buildEnvironmentLayers(storage, repo, unnamed, { platform }, unnamedName, manifestOf);
      assert.ok(over.built !== null, 'built over a claim that never named its builder');
    });

    it('keeps no manifest and no scratch of an environment that is refused, and refuses a name that is not the environment\'s', async () => {
      const tools = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(variant('tools', { files: [] })));
      const name = `${tools}-${platform}.json`;
      await assert.rejects(buildEnvironmentLayers(storage, repo, tools, { platform }, name, manifestOf),
        (err: unknown) => err instanceof EnvironmentTargetRefused && err.reason === 'tools');
      assert.strictEqual(await readEnvironmentManifest(repo, name), null);
      assert.deepStrictEqual(building(), []);
      const other = 'f'.repeat(64);
      await assert.rejects(buildEnvironmentLayers(storage, repo, tools, { platform }, `${other}-${platform}.json`, manifestOf), /is not a manifest's name for the environment/);
      await assert.rejects(readEnvironmentManifest(repo, '../policy.beast2'), /is not an environment manifest's name/);
      assert.throws(() => environmentLayerPath(repo, 'sha256:../../x'), /is not a layer's digest/);
    });

    it('sweeps the manifests of environments nothing reaches and the layers no kept manifest names, a dead build\'s leavings, and nothing while a build runs', async () => {
      const sweepRepo = path.join(tmpDir, 'sweep-repo');
      await repoInit(sweepRepo);
      const dir = environmentLayersDir(sweepRepo);
      const [kept, gone] = ['a'.repeat(64), 'b'.repeat(64)];
      const shared = await packEnvironmentLayers(sweepRepo, tree());
      const only = await packEnvironmentLayers(sweepRepo, tree({ 'extra.py': 'EXTRA = 1\n' }));
      fs.mkdirSync(path.join(dir, 'manifests'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'manifests', `${kept}-p.json`), manifestOf(shared.layers));
      fs.writeFileSync(path.join(dir, 'manifests', `${gone}-p.json`), manifestOf(only.layers));
      fs.writeFileSync(path.join(dir, 'manifests', `${kept}-unread.json`), 'not json');
      // A manifest's staging file, of a write in flight or one a crash left
      const staged = `${kept}-r.json.abc123.partial`;
      fs.writeFileSync(path.join(dir, 'manifests', staged), manifestOf(shared.layers));
      fs.mkdirSync(path.join(dir, 'building'), { recursive: true });
      const start = await getPidStartTime(process.pid);
      const live = path.join(dir, 'building', `${kept}-q.json.claim`);
      fs.writeFileSync(live, `${process.pid} ${start}\n`);
      fs.writeFileSync(path.join(dir, 'building', `${gone}-q.json.claim`), `${process.pid} ${start + 1}\n`);
      fs.mkdirSync(path.join(dir, 'building', `${gone}-q.json.tree-${process.pid}-${start + 1}`));
      // A claim whose builder died before it named itself, long ago
      const blank = path.join(dir, 'building', `${gone}-s.json.claim`);
      fs.writeFileSync(blank, '');
      fs.utimesSync(blank, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
      fs.writeFileSync(path.join(dir, 'blobs', 'left.partial'), 'a write a crash left');
      const blobs = (): string[] => fs.readdirSync(path.join(dir, 'blobs')).sort();
      const all = blobs();

      // A build runs: its layers are kept though no manifest names them yet,
      // and so is a manifest's staging file, which only a build writes.
      assert.strictEqual(await sweepEnvironmentLayers(sweepRepo, new Set([kept])), 5,
        'the dead builds\' claims and tree, the unreached environment\'s manifest and the one that does not read');
      assert.deepStrictEqual(blobs(), all);
      assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'manifests')).sort(), [`${kept}-p.json`, staged].sort());
      assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'building')), [path.basename(live)]);

      fs.rmSync(live);
      assert.strictEqual(await sweepEnvironmentLayers(sweepRepo, new Set([kept])), 3,
        'the layer only the unreached environment named, and the two staging files');
      assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'manifests')), [`${kept}-p.json`]);
      assert.deepStrictEqual(blobs(), shared.layers.map((layer) => layer.digest.replace(':', '-')).sort());
      assert.strictEqual(await sweepEnvironmentLayers(sweepRepo, new Set([kept])), 0);
      assert.strictEqual(await sweepEnvironmentLayers(path.join(tmpDir, 'no-such-repo'), new Set()), 0);
    });
  });
});
