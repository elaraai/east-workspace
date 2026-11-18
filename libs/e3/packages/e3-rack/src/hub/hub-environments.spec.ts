/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { none, some } from '@elaraai/east';
import { environmentLayerPath, environmentLayersDir, tierManifestDigest } from '@elaraai/e3-core';
import { RackHub } from './hub.js';
import { socketRequest } from '../client/local-http.js';
import { E3_RACK_VERSION } from '../version.js';
import { HubEnrollResultType, HubEnrollType, RemoveRackResultType, TierManifestRequestType, TierManifestResultType } from '../protocol/control.js';
import { RackHeartbeatRequestType } from '../protocol/rack-wire.js';
import { RACK_ENVIRONMENTS_OVER_TIER, RACK_MANIFESTS_WANTED_HEADER, readRackManifestsWanted, readRackReport } from '../protocol/rack-json.js';
import { TestRackAgent } from '../testing/test-rack-agent.js';
import { envManifestKey, envManifestName, type EnvLayerManifest } from '../server/env-publication.js';
import { closeAll, cleanup, event, fixture, tierImage } from './hub.test-utils.js';

afterEach(closeAll);

it('keeps the manifest of each tier image a rack reports, by its digest, says which each rack names, and answers one for as long as a rack reports it', async () => {
  const lines: string[] = [];
  const f = await fixture({ log: (line) => { lines.push(line); } });
  const manifest = (digest: string) => socketRequest(f.socket, 'POST', '/v1/tier-manifests', { requestType: TierManifestRequestType, body: { digest }, responseType: TierManifestResultType });
  const [py, science, forged] = [tierImage('3.11.2'), tierImage('3.11.2', [{ name: 'torch', version: '2.9.0+cu130', files: 'sha256:aa' }]), tierImage('3.12.1')];
  const composing = { features: ['environments', RACK_ENVIRONMENTS_OVER_TIER], target: 'x86_64-manylinux_2_28' };
  const racks = async () => new Map((await f.status()).capacity.racks.map((rack) => [rack.label, rack.tierManifests]));

  // Each tier's image by its manifest's digest, with the text a source that reads it is sent
  const agent = await f.agent({ label: 'both', report: { ...composing, tiers: { py: { digest: py.digest, manifest: py.text }, 'py-datascience': { digest: science.digest, manifest: science.text } } } });
  assert.deepEqual((await racks()).get('both'), [{ tier: 'py', manifest: py.digest }, { tier: 'py-datascience', manifest: science.digest }]);
  assert.deepEqual(await manifest(py.digest), some(py.text));
  assert.deepEqual(await manifest(science.digest), some(science.text));
  assert.deepEqual(await manifest(forged.digest), none, 'one no rack reports');

  // A rack that names a digest and sends no text, one whose text is not the
  // bytes its digest names, and one that names an image without saying it
  // composes over one: none is a tier a session could build over
  await f.agent({ label: 'no text', report: { ...composing, tiers: { py: { digest: forged.digest } } } });
  const forger = await f.agent({ label: 'forged', report: { ...composing, tiers: { py: { digest: forged.digest, manifest: py.text } } }, manifestEveryHeartbeat: true });
  await f.agent({ label: 'unsaid', report: { features: ['environments'], target: 'x86_64-manylinux_2_28', tiers: { py: { digest: py.digest, manifest: py.text } } } });
  const named = await racks();
  assert.deepEqual([named.get('no text'), named.get('forged'), named.get('unsaid')], [[], [], []]);
  assert.deepEqual(await manifest(forged.digest), none);
  assert.equal(lines.filter((line) => /the manifest it reports of its tier 'py' was not kept: its text is not the bytes its digest names/.test(line)).length, 1);
  // An agent that sends a manifest's text with each heartbeat sends it again: refused each time, and said once
  for (let beat = 0; beat < 3; beat++) await forger.heartbeat();
  assert.equal(lines.filter((line) => /the manifest it reports of its tier 'py' was not kept/.test(line)).length, 1);
  assert.deepEqual((await racks()).get('forged'), []);
  // One that sends it when asked is not asked again for a text it sent that was not the bytes its digest names: it would send the same
  const asked = await f.agent({ label: 'refused', report: { ...composing, tiers: { py: { digest: forged.digest, manifest: py.text } } } });
  await asked.heartbeat();
  assert.deepEqual(asked.lastReport?.tiers?.py, { digest: forged.digest });
  assert.equal(lines.filter((line) => /the manifest it reports of its tier 'py' was not kept/.test(line)).length, 1);

  // A report this build cannot read of a tier refuses the heartbeat, as any other field does
  assert.throws(() => readRackReport(JSON.stringify({ features: [], tiers: { py: { digest: 'latest' } } })), /the report's tier 'py' names no manifest digest/);
  assert.throws(() => readRackReport(JSON.stringify({ features: [], tiers: ['py'] })), /the report's tiers are not a JSON object/);
  assert.deepEqual(readRackReport(JSON.stringify({ features: [], tiers: { py: { digest: py.digest, more: 1 } } })).tiers, { py: { digest: py.digest } });

  // The rack's image changes: its next heartbeat names another, and the one
  // no rack reports any more is let go, once the rack that still names it is removed
  const next = tierImage('3.11.9');
  const heartbeat = { healthy: true, freeCapacity: 1n, runningLeases: [], agentVersion: `0.5.0+e3.${E3_RACK_VERSION}`, bootId: agent.bootId, cacheBytes: 0n,
    report: JSON.stringify({ ...composing, tiers: { py: { digest: next.digest, manifest: next.text } } }) };
  assert.equal((await agent.raw('heartbeat', RackHeartbeatRequestType, heartbeat)).status, 200);
  assert.deepEqual((await racks()).get('both'), [{ tier: 'py', manifest: next.digest }]);
  assert.deepEqual(await manifest(science.digest), none);
  assert.deepEqual(await manifest(py.digest), some(py.text), 'the rack that names it without the feature still reports it');
  const unsaid = (await f.status()).capacity.racks.find((rack) => rack.label === 'unsaid')!;
  await socketRequest(f.socket, 'DELETE', `/v1/racks/${unsaid.rackId}`, { responseType: RemoveRackResultType });
  assert.deepEqual(await manifest(py.digest), none);
});

it('asks each rack that names a manifest for its text but the one that sent a text that was not the bytes its digest names, and none for a text whose own bytes were refused', async () => {
  const lines: string[] = [];
  const f = await fixture({ log: (line) => { lines.push(line); } });
  const manifest = (digest: string) => socketRequest(f.socket, 'POST', '/v1/tier-manifests', { requestType: TierManifestRequestType, body: { digest }, responseType: TierManifestResultType });
  const composing = { features: ['environments', RACK_ENVIRONMENTS_OVER_TIER], target: 'x86_64-manylinux_2_28' };
  /** The digests a rack is asked to send the text of, answering a heartbeat that reports `said` of its tier. */
  const wanted = async (rack: TestRackAgent, said: { digest: string; manifest?: string }): Promise<string[]> => {
    const answer = await rack.raw('heartbeat', RackHeartbeatRequestType, { healthy: true, freeCapacity: 1n, runningLeases: [], agentVersion: `0.5.0+e3.${E3_RACK_VERSION}`,
      bootId: rack.bootId, cacheBytes: 0n, report: JSON.stringify({ ...composing, tiers: { py: said } }) });
    assert.equal(answer.status, 200); await answer.arrayBuffer();
    return readRackManifestsWanted(answer.headers.get(RACK_MANIFESTS_WANTED_HEADER));
  };
  const image = tierImage('3.11.2');
  const [wrong, honest] = [await f.agent({ label: 'wrong', report: { features: [] } }), await f.agent({ label: 'honest', report: { features: [] } })];

  // One rack's text is not the bytes the digest names: that rack is not asked for it again, and another that names the digest is
  assert.deepEqual(await wanted(wrong, { digest: image.digest, manifest: `${image.text} ` }), []);
  assert.deepEqual(await wanted(wrong, { digest: image.digest }), [], 'it would send the same text');
  assert.deepEqual(await wanted(honest, { digest: image.digest }), [image.digest]);
  assert.deepEqual(await wanted(honest, { digest: image.digest, manifest: image.text }), []);
  assert.deepEqual(await manifest(image.digest), some(image.text));

  // A text that is the bytes its digest names, but no manifest this e3 reads: every rack's text of it is those bytes, so none is asked
  const unread = `${JSON.stringify({ version: 2 })}\n`;
  const unreadDigest = tierManifestDigest(new TextEncoder().encode(unread));
  assert.deepEqual(await wanted(wrong, { digest: unreadDigest, manifest: unread }), []);
  assert.deepEqual(await wanted(honest, { digest: unreadDigest }), [], 'no rack is asked for it');
  assert.deepEqual(await manifest(unreadDigest), none);
  assert.equal(lines.filter((line) => /was not kept: the tier manifest is not of the form this e3 reads/.test(line)).length, 1);
});

it('leases work that names an environment only to a rack that composes environments for a platform its session says it keeps the layers for, and serves it the manifest built with the lease\'s own e3 release', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const [release, platform] = ['9.9.9', 'x86_64-manylinux_2_28'];
  const envHash = 'e'.repeat(64);
  // What a launching machine keeps of an environment it built: a layer, and the manifests that name it, by release and platform.
  const layer = Buffer.from('a layer of the environment, as its session keeps it');
  const digest = `sha256:${createHash('sha256').update(layer).digest('hex')}`;
  await mkdir(dirname(environmentLayerPath(f.repo, digest)), { recursive: true });
  await writeFile(environmentLayerPath(f.repo, digest), layer);
  const manifestOf = (e3Version: string): EnvLayerManifest => ({ envHash, e3Version, baseImage: 'rack-tier:node', baseTier: 'node',
    layers: [{ digest, sizeBytes: layer.length, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip' }] });
  await mkdir(join(environmentLayersDir(f.repo), 'manifests'), { recursive: true });
  for (const built of [release, E3_RACK_VERSION]) {
    await writeFile(join(environmentLayersDir(f.repo), 'manifests', envManifestName(envManifestKey(envHash, built, platform))!), JSON.stringify(manifestOf(built)));
  }

  const session = await f.session(f.repo, release);
  await assert.rejects(session.create({ ...event(['1'.repeat(64)]), environment: 'not a hash' }), /Invalid environment/);
  // The builds a lease names are of its own environment, and none is of work that declares none
  const kept = envManifestKey(envHash, release, platform);
  await assert.rejects(session.create({ ...event(['1'.repeat(64)]), environment: envHash }, [envManifestKey('d'.repeat(64), release, platform)]), /Invalid environment manifests/);
  await assert.rejects(session.create(event(['1'.repeat(64)]), [kept]), /Invalid environment manifests/);
  await assert.rejects(session.create({ ...event(['1'.repeat(64)]), environment: envHash }, [`env-layers/blobs/${digest.replace(':', '-')}`]), /Invalid environment manifests/);
  const lease = await session.create({ ...event(['1'.repeat(64)]), environment: envHash }, [kept]);
  const version = `0.5.0+e3.${release}`;
  // A rack that composes nothing, one that composes for another platform, and one that names a platform but not the feature.
  const never = [
    await f.agent({ version, report: { features: [] } }),
    await f.agent({ version, report: { features: ['environments'], target: 'aarch64-apple-darwin' } }),
    await f.agent({ version, report: { features: [], target: platform } }),
  ];
  for (const rack of never) assert.equal(await rack.claim(), null, 'never granted the lease');
  const composing = await f.agent({ version, report: { features: ['environments'], target: platform } });
  const grant = await composing.claim();
  assert.equal(grant?.leaseId, lease.leaseId);

  const { env } = await composing.storageRequest(grant!, { envManifest: some(envHash) });
  assert(env.type === 'some');
  assert.deepEqual(JSON.parse(env.value.manifestJson), manifestOf(release), 'the manifest built with the lease\'s release, not the hub\'s own');
  assert.deepEqual(env.value.layers.map((served) => [served.digest, served.sizeBytes]), [[digest, BigInt(layer.length)]]);
  const served = await f.fetch(env.value.layers[0]!.url);
  assert.equal(served.status, 200);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), layer);
  await assert.rejects(composing.storageRequest(grant!, { envManifest: some('f'.repeat(64)) }), /HTTP 403 forbidden/);

  // A lease whose session says it keeps no layers of its environment is granted to no rack.
  const other = await session.create({ ...event(['2'.repeat(64)]), environment: 'd'.repeat(64) });
  await composing.complete(grant!, { taskName: 'task', status: 'failed' });
  assert.equal(await composing.claim(), null);
  assert.equal((await session.cancel(other.leaseId)).status, 'cancelled');
});

it('serves a rack the layers built over the image of the lease\'s tier it names, when its session says it keeps them, and the whole environment\'s otherwise', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const [release, platform] = [E3_RACK_VERSION, 'x86_64-manylinux_2_28'];
  const [mine, theirs] = [tierImage('3.11.2'), tierImage('3.11.9')];
  const layer = Buffer.from('a layer');
  const digest = `sha256:${createHash('sha256').update(layer).digest('hex')}`;
  await mkdir(dirname(environmentLayerPath(f.repo, digest)), { recursive: true });
  await writeFile(environmentLayerPath(f.repo, digest), layer);
  await mkdir(join(environmentLayersDir(f.repo), 'manifests'), { recursive: true });
  /** The key of an environment's manifest: whole, or built over an image of the `node` tier. */
  const keyOf = (envHash: string, image?: { digest: string }): string =>
    envManifestKey(envHash, release, platform, image === undefined ? undefined : { tier: 'node', manifest: image.digest });
  /** Keeps an environment's manifest in the session's repository: whole, or built over an image of the `node` tier. */
  const keep = async (envHash: string, image?: { digest: string }): Promise<EnvLayerManifest> => {
    const over = image === undefined ? undefined : { tier: 'node', manifest: image.digest };
    const manifest: EnvLayerManifest = { envHash, e3Version: release, baseImage: 'rack-tier:node', baseTier: 'node',
      layers: [{ digest, sizeBytes: layer.length, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip' }], ...(over !== undefined && { over }) };
    await writeFile(join(environmentLayersDir(f.repo), 'manifests', envManifestName(keyOf(envHash, image))!), JSON.stringify(manifest));
    return manifest;
  };
  // An image is named by its manifest's whole digest: two whose digests share their first digits are two keys
  assert.equal(keyOf('e'.repeat(64), mine), `env-layers/manifests/${'e'.repeat(64)}-${release}-${platform}-node-${mine.digest.slice('sha256:'.length)}.json`);
  const twin = { digest: `${mine.digest.slice(0, -1)}${mine.digest.endsWith('0') ? '1' : '0'}` };
  assert.notEqual(keyOf('e'.repeat(64), twin), keyOf('e'.repeat(64), mine));

  const session = await f.session();
  const over = { features: ['environments', RACK_ENVIRONMENTS_OVER_TIER], target: platform, tiers: { node: { digest: mine.digest, manifest: mine.text } } };
  const rack = await f.agent({ report: over });
  /** The manifest the rack is served of a lease's environment, its session keeping the builds named, once the rack has claimed it. */
  const served = async (envHash: string, kept: string[]): Promise<EnvLayerManifest> => {
    const lease = await session.create({ ...event([envHash]), environment: envHash }, kept);
    const grant = await rack.claim(); assert.equal(grant?.leaseId, lease.leaseId);
    const { env } = await rack.storageRequest(grant, { envManifest: some(envHash) });
    assert(env.type === 'some');
    const read = await f.fetch(env.value.layers[0]!.url);
    assert.equal(read.status, 200, 'a layer the manifest it was served names'); await read.arrayBuffer();
    await rack.complete(grant, { taskName: 'task', status: 'failed' });
    return JSON.parse(env.value.manifestJson) as EnvLayerManifest;
  };

  // Both kept: the layers built over its image. Built over another image, or whole alone: the whole environment's.
  const both = 'a'.repeat(64);
  await keep(both); const small = await keep(both, mine);
  assert.deepEqual(await served(both, [keyOf(both), keyOf(both, mine)]), small);
  const other = 'b'.repeat(64);
  const whole = await keep(other); await keep(other, theirs);
  assert.deepEqual(await served(other, [keyOf(other), keyOf(other, theirs)]), whole);
  // A build its repository holds, which the session does not say it keeps, is not served
  const unsaid = 'd'.repeat(64);
  const plainly = await keep(unsaid); await keep(unsaid, mine);
  assert.deepEqual(await served(unsaid, [keyOf(unsaid)]), plainly);

  // Layers built over its image alone are a rack's that names the image, and no other's
  const only = 'c'.repeat(64);
  const alone = await keep(only, mine);
  const lease = await session.create({ ...event([only]), environment: only }, [keyOf(only, mine)]);
  const plain = await f.agent({ report: { features: ['environments'], target: platform } });
  assert.equal(await plain.claim(), null, 'a rack that composes whole environments alone is not granted it');
  const grant = await rack.claim(); assert.equal(grant?.leaseId, lease.leaseId);
  const { env } = await rack.storageRequest(grant, { envManifest: some(only) });
  assert(env.type === 'some'); assert.deepEqual(JSON.parse(env.value.manifestJson), alone);
});

it('serves a rack the layers built over its image once a session that says it keeps them joins the lease, and none a session has not said it keeps', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const platform = 'x86_64-manylinux_2_28';
  const image = tierImage('3.11.2');
  const envHash = 'e'.repeat(64);
  const layer = Buffer.from('a layer');
  const digest = `sha256:${createHash('sha256').update(layer).digest('hex')}`;
  await mkdir(dirname(environmentLayerPath(f.repo, digest)), { recursive: true });
  await writeFile(environmentLayerPath(f.repo, digest), layer);
  await mkdir(join(environmentLayersDir(f.repo), 'manifests'), { recursive: true });
  const over = { tier: 'node', manifest: image.digest };
  const built: EnvLayerManifest = { envHash, e3Version: E3_RACK_VERSION, baseImage: 'rack-tier:node', baseTier: 'node',
    layers: [{ digest, sizeBytes: layer.length, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip' }], over };

  const first = await f.session();
  const work = { ...event([envHash]), environment: envHash };
  const lease = await first.create(work);
  const rack = await f.agent({ report: { features: ['environments', RACK_ENVIRONMENTS_OVER_TIER], target: platform, tiers: { node: { digest: image.digest, manifest: image.text } } } });
  assert.equal(await rack.claim(), null, 'its session keeps no layers of the environment for the rack');
  // Layers built over the rack's image since, by a session that has not joined the lease: none of the lease's says it keeps them
  const key = envManifestKey(envHash, E3_RACK_VERSION, platform, over);
  await writeFile(join(environmentLayersDir(f.repo), 'manifests', envManifestName(key)!), JSON.stringify(built));
  assert.equal(await rack.claim(), null);
  // The session joins the lease, having built them; a join names only builds of the lease's environment
  const second = await f.session();
  await assert.rejects(second.attach(work, [envManifestKey('f'.repeat(64), E3_RACK_VERSION, platform, over)]), /Invalid environment manifests/);
  assert.equal((await second.create(work, [key])).attached, true);
  const grant = await rack.claim(); assert.equal(grant?.leaseId, lease.leaseId);
  const { env } = await rack.storageRequest(grant, { envManifest: some(envHash) });
  assert(env.type === 'some'); assert.deepEqual(JSON.parse(env.value.manifestJson), built);
});

it('asks a rack for a tier manifest\'s text only while it holds none: the rack sends it with its first heartbeat, and then with the one after an answer that asks', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  // The hub starts again on another port, below: its rack follows it there
  let origin = '';
  const listening = async () => { const listener = (await f.status()).rackListener; assert(listener.type === 'up'); origin = listener.value.origin; };
  await listening();
  const follow: typeof fetch = (input, init) => { const url = new URL(String(input)); return f.fetch(`${origin}${url.pathname}${url.search}`, init); };
  const image = tierImage('3.11.2');
  const report = { features: ['environments', RACK_ENVIRONMENTS_OVER_TIER], target: 'x86_64-manylinux_2_28', tiers: { py: { digest: image.digest, manifest: image.text } } };
  const mint = await socketRequest(f.socket, 'POST', '/v1/enroll', { requestType: HubEnrollType, body: { label: none, ttlMinutes: none }, responseType: HubEnrollResultType });
  const rack = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { fetch: follow, report });
  cleanup.push(() => rack.close());
  const named = async () => (await f.status()).capacity.racks[0]!.tierManifests;
  const sent = () => rack.lastReport?.tiers?.py;

  // Its first heartbeat, at its enrolment, carries the text; the next its digest alone, by which the hub keeps it
  assert.deepEqual(sent(), { digest: image.digest, manifest: image.text });
  await rack.heartbeat();
  assert.deepEqual(sent(), { digest: image.digest });
  assert.deepEqual(await named(), [{ tier: 'py', manifest: image.digest }]);

  // A hub that starts again holds no manifest's text: told the digest alone, it asks for the text, which the next heartbeat carries
  await f.hub.stop();
  const again = new RackHub({ foreground: true, home: f.home, leaseWindowMs: 40 });
  assert(await again.start()); cleanup.push(() => again.stop());
  await listening();
  const answer = await rack.raw('heartbeat', RackHeartbeatRequestType, { healthy: true, freeCapacity: 1n, runningLeases: [], agentVersion: `0.5.0+e3.${E3_RACK_VERSION}`,
    bootId: rack.bootId, cacheBytes: 0n, report: JSON.stringify({ ...report, tiers: { py: { digest: image.digest } } }) });
  assert.equal(answer.status, 200); await answer.arrayBuffer();
  assert.deepEqual(JSON.parse(answer.headers.get(RACK_MANIFESTS_WANTED_HEADER)!), [image.digest]);
  assert.deepEqual(await named(), [], 'no session builds over an image whose manifest the hub does not hold');
  await rack.heartbeat();
  assert.deepEqual(sent(), { digest: image.digest });
  await rack.heartbeat();
  assert.deepEqual(sent(), { digest: image.digest, manifest: image.text });
  assert.deepEqual(await named(), [{ tier: 'py', manifest: image.digest }]);
  await rack.heartbeat();
  assert.deepEqual(sent(), { digest: image.digest }, 'and asked no more');

  // What a rack reads of the header: the digests of manifests alone
  assert.deepEqual(readRackManifestsWanted(JSON.stringify([image.digest, 'latest', 7, `sha256:${'A'.repeat(64)}`])), [image.digest]);
  for (const unread of [null, 'not json', '{"wanted":[]}']) assert.deepEqual(readRackManifestsWanted(unread), [], String(unread));
});
