/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Work that declares an environment, on a rack: the launching machine builds
 * the environment's layers for the rack's platform, the hub leases the work
 * only to a rack that composes environments for that platform and serves it
 * the layers, and the rack runs the work from them.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BlobType, East, IntegerType, StringType, encodeBeast2For, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { EnvironmentSpecType, TaskObjectType, decodeTaskObject } from '@elaraai/e3-types';
import { Budget, LocalStorage, LocalTaskRunner, datasetWrite, environmentLayerPath, hostEnvironmentPlatform, inputsHash, packageImport, packageRead,
  readEnvironmentManifest, repoInit, workspaceCreate, workspaceDeploy } from '@elaraai/e3-core';
import { RackHub, type RackHubOptions } from '../hub/hub.js';
import { defaultHubConfig, saveHubConfig } from '../hub/config.js';
import { HubClient } from '../client/hub-client.js';
import { TestRackAgent, type TestRackAgentOptions } from '../testing/test-rack-agent.js';
import { pinnedFetch } from '../tls/tls.js';
import { DEFAULT_RACK_POLICY, setMode, setRule } from '../routing/policy.js';
import { ENV_LAYER_MEDIA_TYPE, type EnvLayerManifest } from '../server/env-publication.js';
import type { RackLeaseEvent } from '../protocol/task-envelope.js';
import { E3_RACK_VERSION } from '../version.js';
import { openRackRunner, type OpenRackRunnerOptions } from './rack-runner.js';
import { ranLocally, type RackPlacementEvent } from './rack-body.js';
import type { RackEnvironmentEvent } from './environment.js';
import { describeRackSummary } from './summary.js';

/** An environment's file, as export stores it: a beast2 Blob of its bytes. */
const encodeFile = encodeBeast2For(BlobType);
const posix = process.platform !== 'win32';
const NOT_ON_WINDOWS = 'no environment is installed for another platform on Windows: its work stays local, which the last test here holds';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(options: RackHubOptions = {}) {
  const home = await mkdtemp(join(tmpdir(), 'e3v-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  await saveHubConfig({ ...defaultHubConfig(), listen: some({ host: '127.0.0.1', port: 0n }) }, home);
  const hub = new RackHub({ foreground: true, home, ...options });
  assert(await hub.start()); cleanup.push(() => hub.stop());
  const client = new HubClient(home);
  const repo = join(home, 'repo'); assert(repoInit(repo).success);
  const storage = new LocalStorage();
  const input = e3.input('text', StringType, variant('value', 'four'));
  const task = e3.task('length', [input], East.function([StringType], IntegerType, (_$, text) => text.length()));
  const zip = join(home, 'package.zip');
  await e3.export(e3.package('rack', '1.0.0', task), zip);
  await packageImport(storage, repo, zip);
  await workspaceCreate(storage, repo, 'dev');
  await workspaceDeploy(storage, repo, 'dev', 'rack', '1.0.0');
  const hash = (await packageRead(storage, repo, 'rack', '1.0.0')).tasks.get('length')!;
  const base = decodeTaskObject(await storage.objects.read(repo, hash));
  const inputs = [await datasetWrite(storage, repo, 'four', StringType)];
  const budget = new Budget({ cores: 1, memory: 512 * 1024 ** 2 }, { sampler: null });
  const placements: RackPlacementEvent[] = [];
  const environments: RackEnvironmentEvent[] = [];
  const policy = setMode({ ...DEFAULT_RACK_POLICY, enabled: true }, 'auto');
  const open = async (options: Partial<OpenRackRunnerOptions> = {}) => {
    const rack = await openRackRunner({ repoPath: repo, workspace: 'dev', storage, label: 'environment test', budget, policy, home, waitForRackMs: 0,
      onPlacement: (event) => { placements.push(event); }, onEnvironment: (event) => { environments.push(event); }, ...options });
    cleanup.push(() => rack.close());
    return rack;
  };
  const agent = async (as: Pick<TestRackAgentOptions, 'report' | 'label'> = {}) => {
    const mint = await client.enroll();
    const pin = mint.certificateSha256.type === 'some' ? mint.certificateSha256.value : undefined;
    const peer = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { certificateSha256: pin, ...as });
    cleanup.push(() => peer.close());
    // What reads a data URL as the rack does: over the hub's pinned certificate.
    return Object.assign(peer, { get: pin === undefined ? fetch : pinnedFetch(pin) });
  };
  const write = (bytes: Uint8Array): Promise<string> => storage.objects.write(repo, encodeFile(bytes));
  /** The fixture's task, declaring an environment. */
  const declaring = (environment: string): Promise<string> =>
    storage.objects.write(repo, encodeBeast2For(TaskObjectType)({ ...base, environment: some(environment) }));
  let packs = 0;
  /**
   * A node environment with no dependencies, so npm installs it with nothing
   * fetched, whose project is one package: `index.js` holds `marker`, beside
   * `files`. Packed by npm, as an export packs a project.
   */
  const environment = async (marker: string, files: Record<string, string> = {}, manifest = JSON.stringify({ name: 'e3-rack-fixture', version: '1.0.0', private: true })): Promise<string> => {
    const project = join(home, `project-${packs++}`);
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'e3-rack-own', version: '1.0.0', main: 'index.js' }));
    await writeFile(join(project, 'index.js'), `module.exports.marker = ${JSON.stringify(marker)};\n`);
    for (const [name, data] of Object.entries(files)) await writeFile(join(project, name), data);
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', project], { cwd: project, encoding: 'utf8' })) as [{ filename: string }];
    return storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(variant('node', {
      packageJson: await write(Buffer.from(manifest)),
      lock: await write(Buffer.from(JSON.stringify({
        name: 'e3-rack-fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
        packages: { '': { name: 'e3-rack-fixture', version: '1.0.0' } },
      }))),
      tarballs: [await write(await readFile(join(project, packed.filename)))],
    })));
  };
  /** Runs a task through the rack runner, and says where it was placed. */
  const run = async (rack: Awaited<ReturnType<typeof open>>, taskHash: string, force = false) => {
    placements.length = 0;
    const result = await rack.runner.execute(storage, taskHash, inputs, { taskName: 'length', force });
    return { result, placed: placements.filter((event) => event.kind === 'placed') };
  };
  return { home, hub, client, repo, storage, hash, inputs, budget, placements, environments, policy, open, agent, declaring, environment, run };
}

it('builds an environment\'s layers once for the rack\'s platform, leases the work to a rack that composes environments, and the rack runs it from the layers with nothing installed',
  { skip: posix ? false : NOT_ON_WINDOWS }, async () => {
    const f = await fixture(); const agent = await f.agent(); const rack = await f.open();
    const platform = hostEnvironmentPlatform();
    assert(platform !== null, 'this machine is one an environment is installed for');
    assert.match(rack.describe(), new RegExp(`^test rack \\(1 slots, e3 \\S+, environments for ${platform}\\)$`));

    const envHash = await f.environment('first');
    const task = await f.declaring(envHash);
    const running = rack.runner.execute(f.storage, task, f.inputs, { taskName: 'length' });
    const grant = await agent.claim(); assert(grant);
    const event = JSON.parse(grant.eventJson) as RackLeaseEvent;
    assert.equal(event.environment, envHash, 'the lease names the environment');
    assert('hashes' in event.closure && event.closure.hashes.includes(envHash), 'and its closure holds the environment\'s spec');
    const remote = await agent.execute(grant); assert.equal(remote.status, 'success', remote.error);
    const result = await running; assert.equal(result.state, 'success', result.error ?? '');

    // Built once, before the lease: what the rack has nothing of yet, and what it came to.
    assert.deepEqual(f.environments.map((built) => built.kind), ['building', 'built']);
    const built = f.environments[1]!; assert(built.kind === 'built');
    assert.deepEqual([built.envHash, built.platform, built.layers, built.fresh], [envHash, platform, 2, 2], 'what its lock installs, and the project\'s own package');
    const manifest = JSON.parse((await readEnvironmentManifest(f.repo, `${envHash}-${E3_RACK_VERSION}-${platform}.json`))!) as EnvLayerManifest;
    assert.deepEqual({ ...manifest, layers: manifest.layers.length }, { envHash, e3Version: E3_RACK_VERSION, baseImage: 'rack-tier:node', baseTier: 'node', layers: 2 });
    assert(manifest.layers.every((layer) => layer.mediaType === ENV_LAYER_MEDIA_TYPE));
    assert.equal(built.bytes, manifest.layers.reduce((sum, layer) => sum + layer.sizeBytes, 0));

    // The rack composed it from the layers, and linked it where e3-core looks: it installed nothing.
    const linked = join(agent.repo, 'envs', envHash);
    assert((await lstat(linked)).isSymbolicLink(), 'linked, not built');
    assert.equal(await readlink(linked), agent.composedAt(envHash));
    assert.match(await readFile(join(agent.composedAt(envHash), 'node_modules', 'e3-rack-own', 'index.js'), 'utf8'), /"first"/);
    assert(f.placements.some((placed) => placed.kind === 'placed' && placed.where === 'rack'));
    assert(!f.placements.some(ranLocally));
    const record = await f.storage.refs.executionGetLatest(f.repo, task, inputsHash(f.inputs));
    assert(record?.type === 'success');

    // A local run of the same task, which installs the environment here, writes the same output.
    const local = await new LocalTaskRunner(f.repo, f.budget).execute(f.storage, task, f.inputs, { force: true });
    assert.equal(local.state, 'success', local.error ?? ''); assert.equal(local.outputHash, remote.outputHash);

    // A second run builds nothing, in this run's session or another's: the repository keeps the layers.
    f.environments.length = 0;
    for (const runner of [rack, await f.open()]) {
      const again = runner.runner.execute(f.storage, task, f.inputs, { taskName: 'length', force: true });
      assert.equal((await agent.runOne())?.status, 'success');
      assert.equal((await again).state, 'success');
    }
    assert.equal(f.environments.length, 0, 'nothing is built again');

    // The project's code changes: the environment is another, and one layer of it is new.
    const changed = await f.declaring(await f.environment('second'));
    const next = rack.runner.execute(f.storage, changed, f.inputs, { taskName: 'length' });
    assert.equal((await agent.runOne())?.status, 'success');
    assert.equal((await next).state, 'success');
    const rebuilt = f.environments.find((again) => again.kind === 'built'); assert(rebuilt?.kind === 'built');
    assert.deepEqual([rebuilt.layers, rebuilt.fresh], [2, 1], 'what its lock installs is the layer the repository kept');
    assert.match(describeRackSummary(rack.takeSummary())!, /^Rack summary: 3 tasks on test rack · .* · 0 ran locally$/);
  });

it('leases work that declares an environment only to a rack that composes environments for a platform its layers are kept for, and serves that rack its own environment\'s layers alone',
  { skip: posix ? false : NOT_ON_WINDOWS }, async () => {
    const f = await fixture({ leaseWindowMs: 40 });
    const platform = hostEnvironmentPlatform()!;
    // Neither composes for this machine's platform: one names the platform and composes nothing, one composes and names none.
    const plain = await f.agent({ report: { features: [], target: platform }, label: 'plain' });
    const untold = await f.agent({ report: { features: ['environments'] }, label: 'untold' });
    const composing = await f.agent({ label: 'composing' });
    const rack = await f.open();
    const envHash = await f.environment('served');
    const task = await f.declaring(envHash);
    const running = rack.runner.execute(f.storage, task, f.inputs, { taskName: 'length' });
    for (let waited = 0; !f.environments.some((built) => built.kind === 'built') && waited < 120_000; waited += 10) await delay(10);
    assert.deepEqual([...new Set(f.environments.map((built) => built.platform))], [platform], 'built for the platform of the rack that composes, and no other');

    // A rack that composes environments for another platform enrolls: no layers are kept for it.
    const foreign = platform.endsWith('apple-darwin') ? 'x86_64-manylinux_2_28' : 'aarch64-apple-darwin';
    const other = await f.agent({ report: { features: ['environments'], target: foreign }, label: 'other' });
    for (const never of [plain, untold, other]) assert.equal(await never.claim(), null, 'never granted the lease');
    const grant = await composing.claim(); assert(grant, 'granted to the rack whose platform the layers were built for');

    // Its own environment's manifest and layers, each the bytes its digest names, whole or from a byte on.
    const { env } = await composing.storageRequest(grant, { envManifest: some(envHash) });
    assert(env.type === 'some');
    const manifest = JSON.parse(env.value.manifestJson) as EnvLayerManifest;
    assert.equal(manifest.envHash, envHash);
    assert.deepEqual(env.value.layers.map((layer) => [layer.digest, Number(layer.sizeBytes)]), manifest.layers.map((layer) => [layer.digest, layer.sizeBytes]));
    for (const layer of env.value.layers) {
      const whole = await composing.get(layer.url);
      assert.equal(whole.status, 200);
      const bytes = Buffer.from(await whole.arrayBuffer());
      assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, layer.digest);
      const tail = await composing.get(layer.url, { headers: { range: 'bytes=7-' } });
      assert.equal(tail.status, 206);
      assert.deepEqual(Buffer.from(await tail.arrayBuffer()), bytes.subarray(7));
    }
    // Another environment's manifest is not its lease's to read.
    await assert.rejects(composing.storageRequest(grant, { envManifest: some(await f.environment('another')) }), /HTTP 403 forbidden: Environment \S+ is not part of lease/);

    assert.equal((await composing.execute(grant)).status, 'success');
    assert.equal((await running).state, 'success');
    // A layer's URL ends with its lease.
    assert.equal((await composing.get(env.value.layers[0]!.url)).status, 404);
  });

it('runs here the work of a rack that could not compose its environment, by that name', { skip: posix ? false : NOT_ON_WINDOWS }, async () => {
  const f = await fixture(); const agent = await f.agent(); const rack = await f.open();
  const platform = hostEnvironmentPlatform()!;
  const envHash = await f.environment('spoiled');
  const task = await f.declaring(envHash);
  const running = rack.runner.execute(f.storage, task, f.inputs, { taskName: 'length' });
  const grant = await agent.claim(); assert(grant);
  // A layer the repository keeps is no longer the bytes its manifest names.
  const manifest = JSON.parse((await readEnvironmentManifest(f.repo, `${envHash}-${E3_RACK_VERSION}-${platform}.json`))!) as EnvLayerManifest;
  const spoiled = environmentLayerPath(f.repo, manifest.layers[0]!.digest);
  const bytes = await readFile(spoiled);
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
  await writeFile(spoiled, bytes);

  const remote = await agent.execute(grant);
  assert.deepEqual([remote.status, remote.state, remote.reason?.code], ['failed', 'error', 'environment-failed']);
  assert.match(remote.reason?.detail ?? '', new RegExp(`^Rack environment layer ${manifest.layers[0]!.digest} is not the bytes its manifest names$`));
  await assert.rejects(lstat(join(agent.repo, 'envs', envHash)), 'nothing is linked of an environment that was not composed');
  // The rack's fault never fails a run: the work runs here, where the environment is installed for this machine.
  const result = await running; assert.equal(result.state, 'success', result.error ?? '');
  const local = f.placements.find((event) => event.kind === 'placed' && event.where === 'local');
  assert(local?.kind === 'placed' && local.where === 'local');
  assert.equal(local.detail?.code, 'environment-failed');
  assert.match(local.reason, /^fallback:environment-failed: Rack environment layer sha256:[0-9a-f]{64} is not the bytes its manifest names$/);
});

it('keeps work whose environment cannot go to a rack on this machine, with its reason and the build\'s own words in its log',
  { skip: posix ? false : NOT_ON_WINDOWS }, async () => {
    const f = await fixture();
    const spec = (value: Parameters<ReturnType<typeof encodeBeast2For<typeof EnvironmentSpecType>>>[0]) => f.storage.objects.write(f.repo, encodeBeast2For(EnvironmentSpecType)(value));
    /** Runs the task with the environment, which this machine is to run for the reason; answers what its log was told. */
    const local = async (rack: Awaited<ReturnType<typeof f.open>>, environment: string, reason: string, as: { force?: boolean; installs?: boolean } = {}) => {
      const task = await f.declaring(environment);
      const { result, placed } = await f.run(rack, task, as.force);
      // The local body installs the environment for this machine, where it can be installed at all.
      assert.equal(result.state === 'success', as.installs ?? true, result.error ?? '');
      assert.deepEqual(placed, [{ kind: 'placed', taskName: 'length', role: 'task', where: 'local', reason }]);
      assert(ranLocally(placed[0]!), 'a rack\'s work that this machine ran: a run prints it, and counts it');
      return (await f.storage.logs.read(f.repo, task, inputsHash(f.inputs), result.executionId, 'stderr')).data;
    };
    const NOT_BUILT = /the environment was not built for a rack/;

    // No rack composes environments: the one enrolled runs stock work alone.
    await f.agent({ report: { features: [] } });
    const rack = await f.open();
    assert.match(rack.describe(), /^test rack \(1 slots, e3 \S+\)$/);
    const kept = await f.environment('kept');
    assert.doesNotMatch(await local(rack, kept, 'no-rack-for-environment:node'), NOT_BUILT);
    assert.equal(f.environments.length, 0, 'nothing is built for a rack that composes nothing');
    // It is not waited for under rack-only either: a healthy rack has said what it does.
    const only = await f.open({ rackOnly: true, unreachableWaitMs: 60_000 });
    const started = Date.now();
    await local(only, kept, 'no-rack-for-environment:node', { force: true });
    assert(Date.now() - started < 30_000, 'no wait for a rack that composes nothing');

    // An environment that is files, or an image.
    assert.doesNotMatch(await local(rack, await spec(variant('tools', { files: [] })), 'environment:tools'), NOT_BUILT);

    // A rack composes them. A project package with a native addon is refused by name, before anything is installed;
    await f.agent({ label: 'composing' });
    await rack.refreshSlots();
    const native = await f.environment('native', { 'addon.node': 'built for the machine it was packed on' });
    const said = await local(rack, native, 'environment:native-package:e3-rack-own');
    assert.match(said, /^e3: the environment was not built for a rack \(environment:native-package:e3-rack-own\): .*e3-rack-own holds a native addon \(addon\.node\).* — running locally\n/);
    // once in a run, however many tasks declare it.
    await local(rack, native, 'environment:native-package:e3-rack-own', { force: true });
    assert.deepEqual(f.environments.map((event) => event.kind), ['building'], 'one build, refused');

    // An install that fails is the build's failure, in npm's own words.
    f.environments.length = 0;
    const broken = await f.environment('broken', {}, '{ not a manifest');
    assert.match(await local(rack, broken, 'environment:build-failed', { installs: false }),
      /^e3: the environment was not built for a rack \(environment:build-failed\): environment materialization: .*npm ci.* failed:/);
    assert.equal(await readEnvironmentManifest(f.repo, `${broken}-${E3_RACK_VERSION}-${hostEnvironmentPlatform()!}.json`), null, 'no manifest is kept of it');

    // A rule that asks a GPU of a task that is not east-py's is not a rack's.
    const gpu = await f.open({ policy: setRule(f.policy, 'length', 'rack', { gpu: true }) });
    const { placed } = await f.run(gpu, f.hash, true);
    assert.deepEqual(placed, [{ kind: 'placed', taskName: 'length', role: 'task', where: 'local', reason: 'gpu-not-east-py' }]);
    assert.match(describeRackSummary(rack.takeSummary())!, /· 5 ran locally$/);
  });

it('keeps every task that declares an environment on a Windows launching machine, by that name', { skip: posix ? 'Windows alone' : false }, async () => {
  const f = await fixture(); await f.agent(); const rack = await f.open();
  // Its kind is all a Windows machine reads of it: nothing is installed for another platform there.
  const environment = await f.storage.objects.write(f.repo, encodeBeast2For(EnvironmentSpecType)(variant('python', { pyproject: 'a'.repeat(64), lock: 'b'.repeat(64), sdists: [] })));
  const task = await f.declaring(environment);
  // The local body then fails to install it, which is the task's own: where it was placed is what is held here.
  await rack.runner.execute(f.storage, task, f.inputs, { taskName: 'length' }).catch(() => undefined);
  assert.deepEqual(f.placements.filter((event) => event.kind === 'placed'), [{ kind: 'placed', taskName: 'length', role: 'task', where: 'local', reason: 'environment:windows-host' }]);
  assert.equal(f.environments.length, 0);
});
