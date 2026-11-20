/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { encodeBeast2For, none, variant } from '@elaraai/east';
import { EnvironmentSpecType } from '@elaraai/e3-types';
import { LocalStorage } from '../storage/local/index.js';
import { repoInit } from '../storage/local/repository.js';
import { environmentLayerPath, packEnvironmentLayers } from '../storage/local/environment-layers.js';
import { ENVIRONMENT_LAYER_ROOT, NODE_TIER_LINKS, composeEnvironmentOverTier, unpackEnvironmentLayer } from '../environment-layer-unpack.js';
import { readTierManifest, registryTarball, type NodeTier } from '../tier-manifest.js';
import { nodeTierManifestOf, startTestRegistry, writeNodePackages, type TestNodePackage, type TestRegistry } from '../test-helpers.js';
import { environmentFitsTier, hostEnvironmentPlatform, materializeEnvironment, materializeEnvironmentFor } from './environment.js';
import { nodeMembersShare, nodeTierShare, type LockedPackage } from './environment-node-tier.js';
import { encodeFile } from './environment.test-utils.js';

/** The registry a test's tier installed its East packages from. */
const REGISTRY = 'https://registry.npmjs.org/';

/** A tier that holds East's packages at 1.0.0. */
const TIER: NodeTier = { version: '22.12.0', root: '/usr/local/lib/node_modules', registry: REGISTRY,
  packages: ['@elaraai/e3', '@elaraai/east', '@elaraai/east-node-cli', '@elaraai/east-node-io', '@elaraai/east-node-std', '@elaraai/east-ui']
    .map((name) => ({ name, version: '1.0.0' })) };

/** A package npm installed from the registry, by where it is: its name, its version and what it needs. */
const registered = (key: string, version: string, needs: Partial<LockedPackage> = {}): [string, LockedPackage] => {
  const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
  return [key, { version, resolved: registryTarball(REGISTRY, name, version), ...needs }];
};

describe('what a node environment built over a tier leaves to it', () => {
  it('leaves East\'s packages the tier holds and what only they need, and keeps what the project\'s own packages need and what nothing reaches', () => {
    const packages = new Map<string, LockedPackage>([
      ['', { dependencies: { '@elaraai/east': '1.0.0', '@elaraai/east-node-io': '1.0.0', yaml: '2.8.1' }, devDependencies: { '@elaraai/east-node-cli': '1.0.0' } }],
      registered('node_modules/@elaraai/east', '1.0.0', { dependencies: { 'sorted-btree': '^1.8.1' }, peerDependencies: { typescript: '>=5.0.0' } }),
      registered('node_modules/sorted-btree', '1.8.1'),
      registered('node_modules/typescript', '5.9.3'),
      registered('node_modules/@elaraai/east-node-io', '1.0.0', { dependencies: { mongodb: '^6', yaml: '^2', bl: '^4' }, peerDependencies: { '@elaraai/east': '1.0.0' } }),
      registered('node_modules/mongodb', '6.0.0', { dependencies: { bson: '^6' } }),
      registered('node_modules/bson', '6.0.0'),
      // One npm could not hoist, and an optional one for another platform npm did not install
      registered('node_modules/@elaraai/east-node-io/node_modules/bl', '4.1.0', { optionalDependencies: { 'fsevents-like': '1' } }),
      // Shared with the project's own code
      registered('node_modules/yaml', '2.8.1'),
      registered('node_modules/@elaraai/east-node-cli', '1.0.0', { dependencies: { commander: '^14' }, peerDependencies: { '@elaraai/east-diagnostics': '1.0.0' } }),
      registered('node_modules/commander', '14.0.0'),
      // Not the tier's, and needed by a left package alone
      registered('node_modules/@elaraai/east-diagnostics', '1.0.0'),
      // What nothing reaches stays
      registered('node_modules/left-pad', '1.3.0'),
    ]);
    const share = nodeTierShare(packages, [''], TIER);
    assert.deepStrictEqual(share.links, [
      { path: 'node_modules/@elaraai/east', name: '@elaraai/east', version: '1.0.0' },
      { path: 'node_modules/@elaraai/east-node-cli', name: '@elaraai/east-node-cli', version: '1.0.0' },
      { path: 'node_modules/@elaraai/east-node-io', name: '@elaraai/east-node-io', version: '1.0.0' },
    ]);
    assert.deepStrictEqual(share.removed, ['node_modules/@elaraai/east-diagnostics', 'node_modules/bson', 'node_modules/commander', 'node_modules/mongodb',
      'node_modules/sorted-btree', 'node_modules/typescript']);
    assert.strictEqual(share.gone, 10, 'what was left and removed, and the package npm nested inside a left one');
  });

  it('keeps an East package that is the project\'s own: another version, a path, a repository, another registry, an alias', () => {
    const packages = new Map<string, LockedPackage>([
      ['', { dependencies: { '@elaraai/east-node-std': '0.9.0', '@elaraai/east-ui': 'file:vendor/east-ui', '@elaraai/east': 'github:elaraai/east',
        '@elaraai/e3': '1.0.0', 'east-alias': 'npm:@elaraai/east@1.0.0' } }],
      registered('node_modules/@elaraai/east-node-std', '0.9.0', { dependencies: { 'dep-a': '1' } }),
      registered('node_modules/dep-a', '1.0.0'),
      ['node_modules/@elaraai/east-ui', { resolved: 'vendor/east-ui', link: true }],
      ['vendor/east-ui', { name: '@elaraai/east-ui', version: '1.0.0', dependencies: { 'dep-b': '1' } }],
      registered('node_modules/dep-b', '1.0.0'),
      ['node_modules/@elaraai/east', { version: '1.0.0', resolved: 'git+ssh://git@github.com/elaraai/east.git#0123456789abcdef' }],
      ['node_modules/@elaraai/e3', { version: '1.0.0', resolved: 'https://mirror.example/@elaraai/e3/-/e3-1.0.0.tgz' }],
      ['node_modules/east-alias', { name: '@elaraai/east', version: '1.0.0', resolved: registryTarball(REGISTRY, '@elaraai/east', '1.0.0') }],
    ]);
    assert.deepStrictEqual(nodeTierShare(packages, [''], TIER), { links: [], removed: [], gone: 0 });
  });

  it('links a left package npm nested under one the project keeps, and none nested under one removed; and reads a workspace member\'s needs, its development ones among them', () => {
    const packages = new Map<string, LockedPackage>([
      ['', { workspaces: ['packages/pricing'] } as LockedPackage],
      ['node_modules/@acme/pricing', { resolved: 'packages/pricing', link: true }],
      ['packages/pricing', { name: '@acme/pricing', version: '1.0.0', dependencies: { '@elaraai/east': '0.9.0', thing: '1', '@elaraai/east-node-io': '1.0.0' },
        devDependencies: { semver: '7' } }],
      registered('packages/pricing/node_modules/semver', '7.7.2'),
      // Another version at the top, for the member; the tier's nested under a package of the project's that needs it
      registered('node_modules/@elaraai/east', '0.9.0'),
      registered('node_modules/thing', '1.0.0', { dependencies: { '@elaraai/east': '1.0.0' } }),
      registered('node_modules/thing/node_modules/@elaraai/east', '1.0.0'),
      registered('node_modules/@elaraai/east-node-io', '1.0.0', { dependencies: { mongodb: '6' } }),
      registered('node_modules/mongodb', '6.0.0', { dependencies: { '@elaraai/east': '1.0.0' } }),
      registered('node_modules/mongodb/node_modules/@elaraai/east', '1.0.0'),
    ]);
    const share = nodeTierShare(packages, ['', 'packages/pricing'], TIER);
    assert.deepStrictEqual(share.links.map((link) => link.path), ['node_modules/@elaraai/east-node-io', 'node_modules/thing/node_modules/@elaraai/east']);
    assert.deepStrictEqual(share.removed, ['node_modules/mongodb'], 'and what npm nested in it goes with it');
    assert.strictEqual(share.gone, 4);
  });
});

describe('what a workspace member\'s node environment keeps', () => {
  it('keeps its member, what it needs, its link and the runner\'s packages with what they need, and removes what the root and the member\'s development alone need', () => {
    const packages = new Map<string, LockedPackage>([
      ['', { workspaces: ['packages/pricing'], dependencies: { '@elaraai/e3': '1.0.0', '@elaraai/east-node-io': '1.0.0' },
        devDependencies: { '@elaraai/east-node-cli': '1.0.0', 'dev-tool': '1.0.0' } } as LockedPackage],
      ['node_modules/@acme/pricing', { resolved: 'packages/pricing', link: true }],
      ['packages/pricing', { name: '@acme/pricing', version: '1.0.0', dependencies: { '@elaraai/east': '1.0.0', 'own-dep': '1.0.0' },
        devDependencies: { 'member-dev': '1.0.0' } }],
      registered('node_modules/@elaraai/east', '1.0.0', { peerDependencies: { typescript: '>=5.0.0' } }),
      registered('node_modules/typescript', '5.9.3'),
      registered('node_modules/own-dep', '1.0.0', { dependencies: { shared: '1.0.0' } }),
      registered('node_modules/shared', '1.0.0'),
      registered('node_modules/member-dev', '1.0.0'),
      registered('node_modules/dev-tool', '1.0.0', { dependencies: { 'tool-dep': '2.0.0' } }),
      // One npm could not hoist: it goes with the package it is in
      registered('node_modules/dev-tool/node_modules/tool-dep', '2.0.0'),
      registered('node_modules/@elaraai/e3', '1.0.0', { dependencies: { 'e3-dep': '1.0.0' } }),
      registered('node_modules/e3-dep', '1.0.0'),
      registered('node_modules/@elaraai/east-node-cli', '1.0.0', { dependencies: { commander: '^14' }, peerDependencies: { '@elaraai/east': '1.0.0' } }),
      registered('node_modules/commander', '14.0.0'),
      registered('node_modules/@elaraai/east-node-io', '1.0.0', { dependencies: { mongodb: '^6' } }),
      registered('node_modules/mongodb', '6.0.0'),
    ]);
    const share = nodeMembersShare(packages, ['packages/pricing']);
    assert.deepStrictEqual(share.roots, ['packages/pricing', 'node_modules/@elaraai/east-node-cli', 'node_modules/@elaraai/east-node-io'],
      'its member, and the runner\'s packages the root\'s lock installed: not east-node-std, which it did not');
    assert.deepStrictEqual(share.removed, ['node_modules/@elaraai/e3', 'node_modules/dev-tool', 'node_modules/e3-dep', 'node_modules/member-dev'],
      'what the root alone depends on and the member\'s development dependency, and what npm nested in dev-tool with it; the TypeScript East takes as a peer stays');
  });

  it('keeps what a member needs at another version than the root\'s, which npm nested under the member, and a member another depends on', () => {
    const packages = new Map<string, LockedPackage>([
      ['', { workspaces: ['packages/common', 'packages/pricing'], dependencies: { thing: '1.0.0' } } as LockedPackage],
      ['node_modules/@acme/common', { resolved: 'packages/common', link: true }],
      ['node_modules/@acme/pricing', { resolved: 'packages/pricing', link: true }],
      ['packages/common', { name: '@acme/common', version: '1.0.0', dependencies: { thing: '2.0.0' } }],
      ['packages/pricing', { name: '@acme/pricing', version: '1.0.0', dependencies: { '@acme/common': '1.0.0' } }],
      registered('node_modules/thing', '1.0.0'),
      registered('packages/common/node_modules/thing', '2.0.0', { dependencies: { inner: '1.0.0' } }),
      registered('node_modules/inner', '1.0.0'),
    ]);
    assert.deepStrictEqual(nodeMembersShare(packages, ['packages/common', 'packages/pricing']).removed, ['node_modules/thing'],
      'the root\'s version goes; the member\'s, and what it needs, stay');
  });

  it('leaves to a tier, of what a member\'s environment keeps, what a left package needs and the member is developed with besides', () => {
    // The TypeScript the member is developed with, which East takes as a peer
    const packages = new Map<string, LockedPackage>([
      ['', { workspaces: ['packages/pricing'] } as LockedPackage],
      ['node_modules/@acme/pricing', { resolved: 'packages/pricing', link: true }],
      ['packages/pricing', { name: '@acme/pricing', version: '1.0.0', dependencies: { '@elaraai/east': '1.0.0' }, devDependencies: { typescript: '5' } }],
      registered('node_modules/@elaraai/east', '1.0.0', { peerDependencies: { typescript: '>=5.0.0' } }),
      registered('node_modules/typescript', '5.9.3'),
    ]);
    const kept = nodeMembersShare(packages, ['packages/pricing']);
    assert.deepStrictEqual(kept.removed, [], 'kept for the peer East takes');
    assert.deepStrictEqual(nodeTierShare(packages, kept.roots, TIER, false).removed, ['node_modules/typescript'], 'over a tier, East\'s needs are the image\'s');
    assert.deepStrictEqual(nodeTierShare(packages, kept.roots, TIER).removed, [], 'where what the member is developed with is its own, it stays');
  });
});

describe('a node environment built over a tier, and composed over it', {
  skip: process.platform === 'win32' ? 'Windows is refused: no environment is installed for another platform there' : false,
}, () => {
  let tmp: string;
  let repo: string;
  let registry: TestRegistry;
  let tierRoot: string;
  let manifest: ReturnType<typeof readTierManifest>;
  let settings: { env: Record<string, string> };
  const storage = new LocalStorage();
  const host = hostEnvironmentPlatform()!;
  const write = (bytes: Uint8Array): Promise<string> => storage.objects.write(repo, encodeFile(bytes));

  /** What the registry serves: East's packages as the registry has them, and what they and the project need. */
  const SERVED: TestNodePackage[] = [
    { name: '@elaraai/east', version: '1.0.0', dependencies: { 'east-only': '1.0.0' }, files: { 'index.js': 'module.exports.where = "registry";\n' } },
    { name: 'east-only', version: '1.0.0', files: { 'index.js': 'module.exports = "needed by East alone";\n' } },
    { name: '@elaraai/east-node-std', version: '1.0.0', dependencies: { shared: '1.0.0' }, peerDependencies: { '@elaraai/east': '1.0.0' },
      bin: { 'east-tool': 'tool.js' }, files: { 'index.js': 'module.exports.east = require("@elaraai/east");\n', 'tool.js': '#!/usr/bin/env node\nconsole.log("registry tool");\n' } },
    { name: 'shared', version: '1.0.0', files: { 'index.js': 'module.exports.from = __dirname;\n' } },
    { name: '@elaraai/east-ui', version: '0.9.0', files: { 'index.js': 'module.exports.where = "the project\'s own east-ui";\n' } },
    { name: 'own-dep', version: '1.0.0', dependencies: { shared: '1.0.0' }, files: { 'index.js': 'module.exports.shared = require("shared").from;\n' } },
    // The runner's CLI, and what a workspace's root and its members' development need
    { name: '@elaraai/east-node-cli', version: '1.0.0', dependencies: { 'cli-only': '1.0.0' }, peerDependencies: { '@elaraai/east': '1.0.0' },
      bin: { 'east-node': 'cli.js' }, files: { 'cli.js': '#!/usr/bin/env node\nconsole.log("registry cli");\n' } },
    { name: 'cli-only', version: '1.0.0', files: { 'index.js': 'module.exports = "needed by the CLI alone";\n' } },
    { name: 'dev-tool', version: '1.0.0', bin: { 'dev-tool': 'tool.js' }, files: { 'tool.js': '#!/usr/bin/env node\nconsole.log("a dev tool");\n' } },
    { name: 'root-only', version: '1.0.0', files: { 'index.js': 'module.exports = "the root\'s own";\n' } },
    { name: 'member-dev', version: '1.0.0', files: { 'index.js': 'module.exports = "the member\'s development";\n' } },
  ];

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-node-tier-spec-'));
    repo = path.join(tmp, 'repo');
    await repoInit(repo);
    registry = await startTestRegistry(SERVED);
    // npm's cache and registry the test's own, beside the process's environment
    const inherited = Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined);
    settings = { env: { ...Object.fromEntries(inherited), npm_config_cache: path.join(tmp, 'npm-cache'), npm_config_registry: registry.url } };
    // The image: East's packages installed globally, each its own copy of what it needs nested in it
    tierRoot = path.join(tmp, 'image', 'node_modules');
    writeNodePackages(tierRoot, [
      { name: '@elaraai/east', version: '1.0.0', files: { 'index.js': 'module.exports.where = "tier";\n' } },
      { name: '@elaraai/east-node-std', version: '1.0.0', bin: { 'east-tool': 'tool.js' },
        files: { 'index.js': 'module.exports.east = require("@elaraai/east");\n', 'tool.js': '#!/usr/bin/env node\nconsole.log("tier tool");\n' } },
      { name: '@elaraai/east-ui', version: '1.0.0' },
      { name: '@elaraai/east-node-cli', version: '1.0.0', bin: { 'east-node': 'cli.js' }, files: { 'cli.js': '#!/usr/bin/env node\nconsole.log("tier cli");\n' } },
    ]);
    writeNodePackages(path.join(tierRoot, '@elaraai', 'east-node-std', 'node_modules'), [{ name: 'shared', version: '1.0.0', files: { 'index.js': 'module.exports.from = __dirname;\n' } }]);
    manifest = readTierManifest(Buffer.from(nodeTierManifestOf(tierRoot, registry.url)));
  });

  after(async () => {
    await registry.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** Runs npm, which reads the test's registry: never with a call that holds the loop the registry answers on. */
  const npm = async (args: string[], cwd: string): Promise<string> => (await promisify(execFile)('npm', args, { cwd, env: settings.env, encoding: 'utf8' })).stdout;

  /** A project locked by npm from the test's registry: its manifest, lock and own code. */
  const locked = async (dir: string, manifestJson: object, files: Record<string, string> = {}): Promise<void> => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifestJson));
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), text);
    }
    await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund'], dir);
  };

  /** A package of the project's, as `npm pack` packs it. */
  const packed = async (dir: string): Promise<Buffer> => {
    const [made] = JSON.parse(await npm(['pack', '--json', '--pack-destination', dir], dir)) as [{ filename: string }];
    return fs.readFileSync(path.join(dir, made.filename));
  };

  /** What a guest composes from the layers of a tree: unpacked under a root of its own, and composed over the tier. */
  const composed = async (built: Awaited<ReturnType<typeof materializeEnvironmentFor>>, name: string): Promise<string> => {
    const packed = await packEnvironmentLayers(repo, built);
    const root = path.join(tmp, name);
    for (const layer of packed.layers) await unpackEnvironmentLayer(fs.createReadStream(environmentLayerPath(repo, layer.digest)), root);
    const envDir = path.join(root, ...ENVIRONMENT_LAYER_ROOT.split('/'));
    await composeEnvironmentOverTier(envDir, manifest);
    return envDir;
  };

  it('fits a node environment npm locked, which it builds without East\'s packages the tier holds and what only they need, and composes so the project loads the image\'s, one copy of East, and its own beside them', async () => {
    const project = path.join(tmp, 'project');
    await locked(project, { name: 'e3-tier-own', version: '1.0.0', main: 'index.js',
      dependencies: { '@elaraai/east': '1.0.0', '@elaraai/east-node-std': '1.0.0', '@elaraai/east-ui': '0.9.0', 'own-dep': '1.0.0' } }, {
      'index.js': [
        'const east = require("@elaraai/east");',
        'module.exports = { east: east.where, one: east === require("@elaraai/east-node-std").east, ui: require("@elaraai/east-ui").where,',
        '  shared: require("own-dep").shared };',
      ].join('\n'),
    });
    const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(variant('node', {
      packageJson: await write(fs.readFileSync(path.join(project, 'package.json'))),
      lock: await write(fs.readFileSync(path.join(project, 'package-lock.json'))),
      tarballs: [await write(await packed(project))],
    })));
    assert.strictEqual(await environmentFitsTier(storage, repo, envHash, manifest), true);

    const dir = path.join(tmp, 'built');
    const built = await materializeEnvironmentFor(storage, repo, envHash, { platform: host, over: manifest }, dir, settings);
    // Left: East's two the tier holds, and what East alone needs; the project's other version of east-ui ships
    assert.deepStrictEqual({ interpreter: built.interpreter, fromTier: built.fromTier }, { interpreter: null, fromTier: 3 });
    const modules = path.join(dir, 'node_modules');
    assert.deepStrictEqual(fs.readdirSync(path.join(modules, '@elaraai')), ['east-ui']);
    assert.ok(!fs.existsSync(path.join(modules, 'east-only')), 'what only East needs is the image\'s');
    for (const kept of ['shared', 'own-dep', 'e3-tier-own']) assert.ok(fs.existsSync(path.join(modules, kept)), `${kept} ships`);
    assert.ok(!fs.existsSync(path.join(modules, '.package-lock.json')), 'npm\'s account of a tree it no longer is goes');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, NODE_TIER_LINKS), 'utf8')), { links: [
      { path: 'node_modules/@elaraai/east', name: '@elaraai/east', version: '1.0.0' },
      { path: 'node_modules/@elaraai/east-node-std', name: '@elaraai/east-node-std', version: '1.0.0' },
    ] });
    // npm's link to a left package's command stays, and leads to the image's once it is linked
    assert.strictEqual(fs.readlinkSync(path.join(modules, '.bin', 'east-tool')), '../@elaraai/east-node-std/tool.js');
    assert.deepStrictEqual(built.project.filter((file) => file.startsWith('node_modules/e3-tier-own/')),
      ['node_modules/e3-tier-own/index.js', 'node_modules/e3-tier-own/package.json'], 'the project\'s own package');
    assert.ok(built.project.every((file) => fs.existsSync(path.join(dir, ...file.split('/')))), 'and nothing it names is gone');

    // Composed from its layers over the image: the image's East, one copy of it, and its own beside
    const envDir = await composed(built, 'guest');
    assert.strictEqual(fs.readlinkSync(path.join(envDir, 'node_modules', '@elaraai', 'east')), path.join(tierRoot, '@elaraai', 'east'));
    const out = JSON.parse(execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("e3-tier-own")))'], { cwd: envDir, encoding: 'utf8' })) as Record<string, unknown>;
    assert.deepStrictEqual(out, { east: 'tier', one: true, ui: 'the project\'s own east-ui', shared: path.join(fs.realpathSync(envDir), 'node_modules', 'shared') });
    assert.strictEqual(execFileSync(path.join(envDir, 'node_modules', '.bin', 'east-tool'), { encoding: 'utf8' }).trim(), 'tier tool');

    // Over an image that does not hold one of them at its version, it is refused, and nothing is linked
    const older: NodeTier = { ...manifest.node!, packages: manifest.node!.packages.map((held) => held.name === '@elaraai/east-node-std' ? { ...held, version: '0.9.0' } : held) };
    const again = path.join(tmp, 'guest-older');
    for (const layer of (await packEnvironmentLayers(repo, built)).layers) await unpackEnvironmentLayer(fs.createReadStream(environmentLayerPath(repo, layer.digest)), again);
    const againDir = path.join(again, ...ENVIRONMENT_LAYER_ROOT.split('/'));
    await assert.rejects(() => composeEnvironmentOverTier(againDir, { node: older }), /left @elaraai\/east-node-std 1\.0\.0 to the tier, whose image does not hold it/);
    assert.ok(!fs.existsSync(path.join(againDir, 'node_modules', '@elaraai', 'east')));
  });

  it('builds an npm workspace over a tier: its members stay, linked, and East\'s packages they need are the image\'s', async () => {
    const ws = path.join(tmp, 'workspace');
    const members = {
      'packages/common': { manifest: { name: '@acme/common', version: '1.0.0', main: 'index.js', dependencies: { '@elaraai/east': '1.0.0' } },
        code: 'module.exports.east = require("@elaraai/east").where;\n' },
      'packages/pricing': { manifest: { name: '@acme/pricing', version: '1.0.0', main: 'index.js', dependencies: { '@acme/common': '1.0.0', 'own-dep': '1.0.0' } },
        code: 'module.exports.price = () => [require("@acme/common").east, typeof require("own-dep").shared];\n' },
    };
    await locked(ws, { name: 'sol-root', version: '1.0.0', private: true, workspaces: Object.keys(members) },
      Object.fromEntries(Object.entries(members).flatMap(([rel, member]) => [[`${rel}/package.json`, JSON.stringify(member.manifest)], [`${rel}/index.js`, member.code]])));
    const tarballs = [];
    for (const [rel, member] of Object.entries(members)) tarballs.push({ path: rel, name: member.manifest.name, tarball: await write(await packed(path.join(ws, rel))) });
    const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(variant('workspace_node', {
      packageJson: await write(fs.readFileSync(path.join(ws, 'package.json'))), lock: await write(fs.readFileSync(path.join(ws, 'package-lock.json'))),
      config: none, subject: 'packages/pricing', members: tarballs,
    })));
    const built = await materializeEnvironmentFor(storage, repo, envHash, { platform: host, over: manifest }, path.join(tmp, 'ws-built'), settings);
    assert.strictEqual(built.fromTier, 2, 'East, and what it alone needs');
    assert.deepStrictEqual([...built.project], ['packages/common/index.js', 'packages/common/package.json', 'packages/pricing/index.js', 'packages/pricing/package.json']);
    const envDir = await composed(built, 'ws-guest');
    const out = execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("@acme/pricing").price()))'], { cwd: envDir, encoding: 'utf8' });
    assert.deepStrictEqual(JSON.parse(out), ['tier', 'string']);
  });

  it('keeps of a workspace member\'s environment what its member and the runner need, here, for a platform and over a tier, which leaves East\'s of that to the image (#1700)', async () => {
    const ws = path.join(tmp, 'members');
    const member = { name: '@acme/pricing', version: '1.0.0', main: 'index.js', dependencies: { '@elaraai/east': '1.0.0', 'own-dep': '1.0.0' },
      devDependencies: { 'member-dev': '1.0.0' } };
    await locked(ws, { name: 'sol-root', version: '1.0.0', private: true, workspaces: ['packages/pricing'],
      dependencies: { 'root-only': '1.0.0' }, devDependencies: { '@elaraai/east-node-cli': '1.0.0', 'dev-tool': '1.0.0' } }, {
      'packages/pricing/package.json': JSON.stringify(member),
      'packages/pricing/index.js': 'module.exports.price = () => [require("@elaraai/east").where, typeof require("own-dep").shared];\n',
    });
    const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(variant('workspace_node', {
      packageJson: await write(fs.readFileSync(path.join(ws, 'package.json'))), lock: await write(fs.readFileSync(path.join(ws, 'package-lock.json'))),
      config: none, subject: 'packages/pricing',
      members: [{ path: 'packages/pricing', name: member.name, tarball: await write(await packed(path.join(ws, 'packages', 'pricing'))) }],
    })));
    /** The packages a built environment holds at its top, and the commands npm linked for them. */
    const holds = (dir: string): { packages: string[]; commands: string[] } => {
      const modules = path.join(dir, 'node_modules');
      const packages = fs.readdirSync(modules).filter((name) => !name.startsWith('.'))
        .flatMap((name) => name.startsWith('@') ? fs.readdirSync(path.join(modules, name)).map((inner) => `${name}/${inner}`) : [name]).sort();
      return { packages, commands: fs.readdirSync(path.join(modules, '.bin')).sort() };
    };
    /** What the member's code reads, and what the runner's command says, run from an environment's directory. */
    const runs = (envDir: string): [unknown, string] => [
      JSON.parse(execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("@acme/pricing").price()))'], { cwd: envDir, encoding: 'utf8' })),
      execFileSync(path.join(envDir, 'node_modules', '.bin', 'east-node'), { encoding: 'utf8' }).trim(),
    ];
    // Neither what the root alone depends on, its dev tool and its command among it, nor the member's development
    const whole = { packages: ['@acme/pricing', '@elaraai/east', '@elaraai/east-node-cli', 'cli-only', 'east-only', 'own-dep', 'shared'], commands: ['east-node'] };

    const [bin] = await materializeEnvironment(storage, repo, envHash, settings);
    const here = path.dirname(path.dirname(bin!));
    assert.deepStrictEqual(holds(here), whole, 'here');
    assert.ok(!fs.existsSync(path.join(here, 'node_modules', '.package-lock.json')), 'npm\'s account of a tree it no longer is goes');
    assert.deepStrictEqual(runs(here), [['registry', 'string'], 'registry cli']);

    const built = await materializeEnvironmentFor(storage, repo, envHash, { platform: host }, path.join(tmp, 'members-built'), settings);
    assert.strictEqual(built.fromTier, null);
    assert.deepStrictEqual(holds(built.dir), whole, 'for a platform');
    assert.deepStrictEqual([...built.project], ['packages/pricing/index.js', 'packages/pricing/package.json']);

    // Over a tier: of what it keeps, East's packages the image holds, its CLI among them, and what only they need, are the image's
    const over = await materializeEnvironmentFor(storage, repo, envHash, { platform: host, over: manifest }, path.join(tmp, 'members-over'), settings);
    assert.strictEqual(over.fromTier, 4, 'East and its CLI, and what each alone needs: the tier\'s count alone');
    assert.deepStrictEqual(holds(over.dir), { packages: ['@acme/pricing', 'own-dep', 'shared'], commands: ['east-node'] });
    assert.ok(!fs.existsSync(path.join(over.dir, 'node_modules', '@elaraai')), 'a scope that held only what was left goes, and the agent makes it again');
    assert.deepStrictEqual((JSON.parse(fs.readFileSync(path.join(over.dir, NODE_TIER_LINKS), 'utf8')) as { links: { name: string }[] }).links.map((link) => link.name),
      ['@elaraai/east', '@elaraai/east-node-cli']);
    assert.deepStrictEqual(runs(await composed(over, 'members-guest')), [['tier', 'string'], 'tier cli']);
  });
});
