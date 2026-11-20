/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { pack as tarPack, type Headers } from 'tar-stream';
import {
  ENVIRONMENT_LAYER_ROOT, NODE_TIER_LINKS, composeEnvironmentOverTier, environmentLinkInside, readNodeTierLinks, unpackEnvironmentLayer,
} from './environment-layer-unpack.js';
import type { NodeTier, TierManifest } from './tier-manifest.js';

/** A python image's manifest, whose base interpreter is `base`. */
const overPython = (base: string): TierManifest => ({ python: { version: '3.11.2', executable: '/opt/venv/bin/python', base,
  site: '/opt/venv/lib/python3.11/site-packages', namespaces: [], distributions: [] } });

/** A node image's Node: East's packages at 1.0.0 in its global root. */
const NODE: NodeTier = { version: '22.12.0', root: '/opt/tier/node_modules', registry: 'https://registry.npmjs.org/',
  packages: [{ name: '@elaraai/east', version: '1.0.0' }, { name: '@elaraai/east-node-cli', version: '1.0.0' }] };

/** A gzip tar of the given entries, as a layer another machine sent. */
async function layerOf(entries: Array<Headers & { data?: string }>): Promise<Readable> {
  const tar = tarPack();
  for (const { data, ...header } of entries) tar.entry(header, data ?? '');
  tar.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of tar) chunks.push(chunk as Buffer);
  return Readable.from(gzipSync(Buffer.concat(chunks)));
}

/** Every path under a directory, `/` between segments, a link not followed. */
function everything(dir: string, at = ''): string[] {
  if (!fs.existsSync(path.join(dir, at))) return [];
  return fs.readdirSync(path.join(dir, at), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(at, entry.name);
    return entry.isDirectory() ? [rel, ...everything(dir, rel)] : [rel];
  });
}

it('takes a link written as a layer writes one, naming a path in the environment, and no other', () => {
  for (const [rel, linkname] of [['.venv/bin/python', '../../.python/cpython/bin/python3.12'], ['lib64', 'lib'], ['a/here', '.'],
    ['a/b/top', '../..'], ['a/sibling', '../b/c']] as const) {
    assert.strictEqual(environmentLinkInside(rel, linkname), true, `${rel} -> ${linkname}`);
  }
  for (const [rel, linkname, why] of [
    ['a/link', '', 'empty'], ['a/link', '/etc/passwd', 'absolute'], ['a/link', 'C:/x', 'a drive'], ['a/link', '..\\..\\x', 'backslashes'],
    ['a/link', '../../x', 'above the environment'], ['top', '..', 'the environment\'s parent'],
    ['a/link', 'b/../c', 'a .. after a name'], ['a/link', './b', 'a . segment'], ['a/link', 'b//c', 'an empty segment'], ['a/link', 'b/', 'a trailing /'],
  ] as const) {
    assert.strictEqual(environmentLinkInside(rel, linkname), false, `${rel} -> ${linkname}: ${why}`);
  }
});

describe('a layer unpacked where it runs', {
  skip: process.platform === 'win32' ? 'POSIX alone: a layer is composed on a rack\'s Linux guest, and a link needs a privilege on Windows' : false,
}, () => {
  let tmpDir: string;
  let roots = 0;
  const fresh = (): string => path.join(tmpDir, `root-${roots++}`);
  const under = (rel: string): string => `${ENVIRONMENT_LAYER_ROOT}/${rel}`;

  before(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-layer-unpack-spec-')); });
  after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('refuses an entry outside the environment, a link that leaves it, and a thing no layer holds, writing nothing outside', async () => {
    const root = fresh();
    const refused = async (entries: Array<Headers & { data?: string }>, why: RegExp): Promise<void> => {
      await assert.rejects(unpackEnvironmentLayer(await layerOf(entries), root), why);
    };
    const inside = under('x');
    await refused([{ name: 'var/task/other/x', data: 'x' }], /is not in the environment/);
    await refused([{ name: `${ENVIRONMENT_LAYER_ROOT}/../../../escaped`, data: 'x' }], /is not in the environment/);
    await refused([{ name: '/etc/escaped', data: 'x' }], /is not in the environment/);
    await refused([{ name: 'var/task', data: 'a file where a directory is' }], /no layer holds/);
    await refused([{ name: inside, type: 'symlink', linkname: '/etc/passwd' }], /outside the environment/);
    await refused([{ name: inside, type: 'symlink', linkname: '../../../etc/passwd' }], /outside the environment/);
    await refused([{ name: inside, type: 'link', linkname: `${ENVIRONMENT_LAYER_ROOT}/y` }], /no layer holds/);
    await refused([{ name: inside, type: 'fifo' }], /no layer holds/);
    await assert.rejects(unpackEnvironmentLayer(Readable.from(Buffer.from('not a gzip tar')), root));
    assert.ok(!fs.existsSync(path.join(tmpDir, 'escaped')) && !fs.existsSync(path.join(root, 'var', 'task', 'other')), 'nothing was written outside');
    // A link within the environment is one a layer holds.
    await unpackEnvironmentLayer(await layerOf([{ name: under('a/file'), data: 'held' },
      { name: under('b/link'), type: 'symlink', linkname: '../a/file' }]), root);
    assert.strictEqual(fs.readFileSync(path.join(root, ENVIRONMENT_LAYER_ROOT, 'b', 'link'), 'utf8'), 'held');
  });

  it('writes nothing through a link: a chain of links that each name the environment leads no entry outside the root', async () => {
    // Each link names the environment by its own path's text; on disk the
    // first stands for the environment, and the second, made through it,
    // would name the root's parent, and the file be written there.
    const root = fresh();
    await assert.rejects(unpackEnvironmentLayer(await layerOf([
      { name: under('a'), type: 'symlink', linkname: '.' },
      { name: under('a/a/a/a/b'), type: 'symlink', linkname: '../../../..' },
      { name: under('b/x'), data: 'escaped' },
    ]), root), /the entry '.*a\/a\/a\/a\/b' is at or under '.*\/a', which is not a directory/);
    assert.deepStrictEqual(everything(tmpDir).filter((rel) => !rel.startsWith('root-')), [], 'nothing beside the roots');
    assert.ok(!fs.existsSync(path.join(root, ENVIRONMENT_LAYER_ROOT, 'b')));

    // A link that climbs through another is not written as a layer writes one.
    await assert.rejects(unpackEnvironmentLayer(await layerOf([
      { name: under('up'), type: 'symlink', linkname: '.' },
      { name: under('x'), type: 'symlink', linkname: 'up/..' },
    ]), fresh()), /the link '.*\/x' names 'up\/\.\.', outside the environment or not as a layer writes one/);
  });

  it('refuses an entry under a link an earlier layer made, and puts a file or a link in a link\'s place rather than through it', async () => {
    const root = fresh();
    await unpackEnvironmentLayer(await layerOf([{ name: under('dir/kept'), data: 'kept' }, { name: under('a'), type: 'symlink', linkname: 'dir' }]), root);
    await assert.rejects(unpackEnvironmentLayer(await layerOf([{ name: under('a/x'), data: 'through a link' }]), root),
      /the entry '.*\/a\/x' is at or under '.*\/a', which is not a directory/);
    assert.ok(!fs.existsSync(path.join(root, ENVIRONMENT_LAYER_ROOT, 'dir', 'x')), 'nothing was written through the earlier layer\'s link');

    // A file at a link's path takes its place: what the link named is left.
    await unpackEnvironmentLayer(await layerOf([{ name: under('to-kept'), type: 'symlink', linkname: 'dir/kept' }]), root);
    await unpackEnvironmentLayer(await layerOf([{ name: under('to-kept'), data: 'its own' }]), root);
    const env = path.join(root, ENVIRONMENT_LAYER_ROOT);
    assert.ok(fs.lstatSync(path.join(env, 'to-kept')).isFile());
    assert.deepStrictEqual([fs.readFileSync(path.join(env, 'to-kept'), 'utf8'), fs.readFileSync(path.join(env, 'dir', 'kept'), 'utf8')], ['its own', 'kept']);

    // A link at a directory's path takes its place, and what is then under it
    // is refused, as under any link.
    await unpackEnvironmentLayer(await layerOf([{ name: under('dir'), type: 'symlink', linkname: '.' }]), root);
    assert.ok(fs.lstatSync(path.join(env, 'dir')).isSymbolicLink());
    await assert.rejects(unpackEnvironmentLayer(await layerOf([{ name: under('dir/again'), data: 'x' }]), root), /which is not a directory/);
    // A file where a directory is, is refused.
    await assert.rejects(unpackEnvironmentLayer(await layerOf([{ name: under('d2/f'), data: 'x' }, { name: under('d2'), data: 'x' }]), root),
      /is a file where a directory is/);
  });
});

describe('an environment built over a tier, composed over it', { skip: process.platform === 'win32' ? 'a rack\'s guest is Linux' : false }, () => {
  let tmp: string;
  before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-compose-')); });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  /** An environment's tree as its layers leave it: built over an interpreter in `home`. */
  const environment = (name: string, home: string): string => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(path.join(dir, '.venv', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.venv', 'pyvenv.cfg'), `home = ${home}\nimplementation = CPython\nversion_info = 3.11.2\n`);
    fs.symlinkSync('python', path.join(dir, '.venv', 'bin', 'python3'));
    return dir;
  };

  it('links the virtualenv\'s python to the tier\'s base interpreter, in place of what is there', async () => {
    const dir = environment('linked', '/usr/bin');
    await composeEnvironmentOverTier(dir, overPython('/usr/bin/python3'));
    assert.strictEqual(fs.readlinkSync(path.join(dir, '.venv', 'bin', 'python')), '/usr/bin/python3');
    // Composed again, over what the first left
    await composeEnvironmentOverTier(dir, overPython('/usr/bin/python3'));
    assert.strictEqual(fs.readlinkSync(path.join(dir, '.venv', 'bin', 'python')), '/usr/bin/python3');
    assert.deepStrictEqual(everything(dir).sort(), ['.venv', '.venv/bin', '.venv/bin/python', '.venv/bin/python3', '.venv/pyvenv.cfg']);
  });

  it('composes where the tier is not: its interpreter is linked as a path and never looked at, and only that link is written', async () => {
    // The tree alone, as where an environment's disk is made from its layers: the tier's image is not unpacked there
    const absent = '/opt/e3-no-such-tier/python/bin/python3.12';
    assert.ok(!fs.existsSync('/opt/e3-no-such-tier'), 'no file of this machine');
    const dir = environment(path.join('stage', 'var', 'task', '.e3-env'), path.posix.dirname(absent));
    fs.writeFileSync(path.join(tmp, 'stage', 'beside'), 'not the environment\'s');
    const config = fs.readFileSync(path.join(dir, '.venv', 'pyvenv.cfg'), 'utf8');
    const before = everything(tmp);

    await composeEnvironmentOverTier(dir, overPython(absent));
    const link = path.join(dir, '.venv', 'bin', 'python');
    assert.strictEqual(fs.readlinkSync(link), absent, 'the tier\'s path, as it was given');
    assert.ok(fs.lstatSync(link).isSymbolicLink() && !fs.existsSync(link), 'a link that names no file here');
    // The one link, beneath the directory given: nothing beside it, and nothing where the interpreter would be
    assert.deepStrictEqual(everything(tmp).sort(), [...before, 'stage/var/task/.e3-env/.venv/bin/python'].sort());
    assert.ok(!fs.existsSync('/opt/e3-no-such-tier'));
    // It is the last write: the virtualenv's own files are as its layers left them
    assert.strictEqual(fs.readFileSync(path.join(dir, '.venv', 'pyvenv.cfg'), 'utf8'), config);
    assert.strictEqual(fs.readlinkSync(path.join(dir, '.venv', 'bin', 'python3')), 'python', 'the virtualenv\'s other names reach it by the link');
  });

  it('refuses an environment built over another interpreter, an interpreter that is no absolute path, and a virtualenv whose directories are not real, linking nothing', async () => {
    const other = environment('other', '/usr/local/bin');
    await assert.rejects(() => composeEnvironmentOverTier(other, overPython('/usr/bin/python3')),
      /the environment was built over an interpreter in '\/usr\/local\/bin', not the tier's '\/usr\/bin\/python3'/);
    const whole = environment('whole', '../.python/cpython/bin');
    await assert.rejects(() => composeEnvironmentOverTier(whole, overPython('/usr/bin/python3')), /was built over an interpreter in/);
    await assert.rejects(() => composeEnvironmentOverTier(environment('relative', 'bin'), overPython('bin/python3')), /is not an absolute path/);
    // A tier whose image holds no Python, which a python environment is built over no tier of
    await assert.rejects(() => composeEnvironmentOverTier(environment('nodeTier', '/usr/bin'), { node: NODE }), /built over a tier's Python, and the tier holds none/);
    // A link standing in for the virtualenv's bin directory is not written through
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    const linked = path.join(tmp, 'through');
    fs.mkdirSync(path.join(linked, '.venv'), { recursive: true });
    fs.writeFileSync(path.join(linked, '.venv', 'pyvenv.cfg'), 'home = /usr/bin\n');
    fs.symlinkSync(outside, path.join(linked, '.venv', 'bin'));
    await assert.rejects(() => composeEnvironmentOverTier(linked, overPython('/usr/bin/python3')), /is not a directory of an environment built over a tier/);
    await assert.rejects(() => composeEnvironmentOverTier(path.join(tmp, 'absent'), overPython('/usr/bin/python3')), /is not a directory of an environment built over a tier/);
    for (const dir of [other, whole]) assert.ok(!fs.existsSync(path.join(dir, '.venv', 'bin', 'python')));
    assert.deepStrictEqual(fs.readdirSync(outside), []);
  });

  /** A node environment's tree as its layers leave it: what it left to the tier named, and npm's link to a left package's command. */
  const nodeEnvironment = (name: string, links: unknown[]): string => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'node_modules', '@elaraai'));
    fs.symlinkSync('../@elaraai/east-node-cli/bin/east-node.mjs', path.join(dir, 'node_modules', '.bin', 'east-node'));
    fs.writeFileSync(path.join(dir, NODE_TIER_LINKS), JSON.stringify({ links }));
    return dir;
  };
  const LEFT = [
    { path: 'node_modules/@elaraai/east', name: '@elaraai/east', version: '1.0.0' },
    { path: 'node_modules/@elaraai/east-node-cli', name: '@elaraai/east-node-cli', version: '1.0.0' },
    // One npm nested under a package of the project's, whose directories its layers did not keep
    { path: 'node_modules/@acme/pricing/node_modules/@elaraai/east', name: '@elaraai/east', version: '1.0.0' },
  ];

  it('links each of East\'s packages a node environment left to the tier to the image\'s copy, where it was, in place of what is there', async () => {
    const dir = nodeEnvironment('node', LEFT);
    fs.mkdirSync(path.join(dir, 'node_modules', '@elaraai', 'east'));
    await composeEnvironmentOverTier(dir, { node: NODE });
    for (const { path: where, name } of LEFT) assert.strictEqual(fs.readlinkSync(path.join(dir, ...where.split('/'))), `/opt/tier/node_modules/${name}`, where);
    // npm's link to a left package's command leads to the image's, through it
    assert.strictEqual(fs.readlinkSync(path.join(dir, 'node_modules', '.bin', 'east-node')), '../@elaraai/east-node-cli/bin/east-node.mjs');
    // Composed again, over what the first left; a tier that also holds Python is one to compose over
    await composeEnvironmentOverTier(dir, { ...overPython('/usr/bin/python3'), node: NODE });
    assert.deepStrictEqual(everything(dir).sort(), [NODE_TIER_LINKS, 'node_modules', 'node_modules/.bin', 'node_modules/.bin/east-node',
      'node_modules/@acme', 'node_modules/@acme/pricing', 'node_modules/@acme/pricing/node_modules', 'node_modules/@acme/pricing/node_modules/@elaraai',
      'node_modules/@acme/pricing/node_modules/@elaraai/east', 'node_modules/@elaraai', 'node_modules/@elaraai/east', 'node_modules/@elaraai/east-node-cli']);
  });

  it('refuses a package the tier does not hold at its version, a tier with no Node, and a links file that names what is no package of the environment, linking nothing', async () => {
    const lacking: NodeTier = { ...NODE, packages: [{ name: '@elaraai/east', version: '1.0.0' }, { name: '@elaraai/east-node-cli', version: '0.9.0' }] };
    const dir = nodeEnvironment('lacking', LEFT);
    await assert.rejects(() => composeEnvironmentOverTier(dir, { node: lacking }),
      /the environment left @elaraai\/east-node-cli 1\.0\.0 to the tier, whose image does not hold it/);
    await assert.rejects(() => composeEnvironmentOverTier(dir, overPython('/usr/bin/python3')), /built over a tier's Node, and the tier holds none/);
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'node_modules', '@elaraai')), [], 'none linked');
    for (const odd of [
      { path: '../escaped/node_modules/@elaraai/east', name: '@elaraai/east', version: '1.0.0' },
      { path: '/etc/node_modules/@elaraai/east', name: '@elaraai/east', version: '1.0.0' },
      { path: 'node_modules/@elaraai/other', name: '@elaraai/east', version: '1.0.0' },
      { path: 'node_modules/@elaraai/../../x', name: '@elaraai/../../x', version: '1.0.0' },
      { path: 'node_modules/@elaraai/east', name: '@elaraai/east', version: '' },
    ]) {
      assert.throws(() => readNodeTierLinks(JSON.stringify({ links: [odd] })), /is not a package of the environment/, JSON.stringify(odd));
    }
    assert.throws(() => readNodeTierLinks(JSON.stringify({ links: [LEFT[0], LEFT[0]] })), /is not a package of the environment/, 'one path twice');
    assert.throws(() => readNodeTierLinks('not json'), /is not JSON/);
    assert.throws(() => readNodeTierLinks('{}'), /names no packages/);
    // A link standing in for a directory on the way is not written through
    const outside = path.join(tmp, 'node-outside');
    fs.mkdirSync(outside);
    const through = nodeEnvironment('node-through', [LEFT[2]]);
    fs.symlinkSync(outside, path.join(through, 'node_modules', '@acme'));
    await assert.rejects(() => composeEnvironmentOverTier(through, { node: NODE }), /'node_modules\/@acme\/pricing\/node_modules\/@elaraai\/east' is under 'node_modules\/@acme', which is not a directory/);
    assert.deepStrictEqual(fs.readdirSync(outside), []);
  });
});
