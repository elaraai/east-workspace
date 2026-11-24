/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DictType, East, IntegerType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, encodeEastIR, equalFor, printFor, variant,
} from '@elaraai/east';
import { FileSystem } from '@elaraai/east-node-std';
import e3 from '@elaraai/e3';
import { LocalStorage, hostEnvironmentPlatform, packageImport, packageRead, repoInit, workspaceCreate, workspaceDeploy } from '@elaraai/e3-core';
import { encodeInSegmentsOf } from '@elaraai/e3-core/test';
import { createDraftsPackageZip } from '@elaraai/e3-api-tests';
import { E3_RACK_VERSION, HubClient } from '@elaraai/e3-rack';
import { RACK_PROTOCOL, RackEnrollRequestType, RackEnrollResponseType, RackHeartbeatRequestType, RackHeartbeatResponseType } from '@elaraai/e3-rack/protocol';
import { TestRackAgent, sameLeaseRefs, type TestRackAgentOptions } from '@elaraai/e3-rack/testing';
import { runE3Command, spawnE3Command, waitFor, type CliResult } from './helpers.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function ok(result: CliResult) { assert.equal(result.exitCode, 0, result.stderr + result.stdout); return result.stdout; }

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'e3r-'));
  cleanup.push(() => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const repo = join(home, 'repo'); assert(repoInit(repo).success);
  const env = { E3_RACK_HOME: home };
  const cli = (...args: string[]) => runE3Command(args, repo, { env });
  cleanup.push(() => cli('rack', 'stop'));
  const input = e3.input('cli_text', StringType, variant('value', 'four'));
  const task = e3.task('train_a', [input], East.function([StringType], IntegerType, (_$, text) => text.length()));
  const zip = join(home, 'package.zip'); await e3.export(e3.package('cli_rack', '1.0.0', task), zip);
  const storage = new LocalStorage(); await packageImport(storage, repo, zip);
  for (const workspace of ['ws1', 'ws2']) {
    await workspaceCreate(storage, repo, workspace);
    await workspaceDeploy(storage, repo, workspace, 'cli_rack', '1.0.0');
  }
  return { home, repo, env, cli };
}

async function enrolled(as: Pick<TestRackAgentOptions, 'resources'> = {}) {
  const f = await fixture();
  ok(await f.cli('rack', 'config', '--listen', '127.0.0.1:0'));
  const status = ok(await f.cli('rack', 'status'));
  const listener = /Listener: up (https:\/\/\S+) \(certificate SHA-256 ((?:[0-9A-F]{2}:){31}[0-9A-F]{2})\)/.exec(status); assert(listener, status);
  const [, origin, pin] = listener as unknown as [string, string, string];
  const handoff = ok(await f.cli('rack', 'enroll', '--label', 't', '--no-wait'));
  assert(handoff.includes(`Matching e3-rack release: ${E3_RACK_VERSION}`));
  assert(handoff.includes(`\nCertificate SHA-256: ${pin}\n`), handoff);
  assert.match(handoff, /configure --allocation '[^']+'\n/);
  assert.match(handoff, /enroll --allocation '[^']+'\n/);
  assert.doesNotMatch(handoff, /--allow-vpn-http/);
  const token = /^Enrollment token: (e3rk_enroll_\S+)$/m.exec(handoff)?.[1]; assert(token, handoff);
  assert(handoff.includes(`Source origin: ${origin}`));
  for (const command of handoff.split('\n').filter((line) => line.startsWith('  sudo '))) {
    assert(!command.includes(token)); assert(!command.includes(origin)); assert(!command.includes(pin));
    assert.doesNotMatch(command, /--token|--api-url| install /);
  }
  const agent = await TestRackAgent.enroll(origin, token, { label: 't', certificateSha256: pin, ...as }); cleanup.push(() => agent.close());
  assert.match(ok(await f.cli('rack', 'list')), /t\s+.*ready/);
  return { ...f, agent, pin, client: new HubClient(f.home) };
}

const TableType = DictType(IntegerType, StringType);

/** Lays a project's packages beside the fixture's repository, as a project
 *  holds them: where work that runs here finds its runner and its platform. */
async function asProject(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(f.home, 'node_modules'), 'junction');
}

/** Imports a package of functions, and of a task split over its input, into
 *  the fixture's repository, deployed to the workspace `calls`. */
async function withCalls(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  const text = e3.input('text', StringType, variant('value', 'four'));
  const measure = e3.function('measure', East.function([StringType], IntegerType, (_$, value) => value.length()));
  const readConfig = e3.function('read_config', East.function([StringType], StringType, (_$, path) => FileSystem.readFile(path)));
  const rows = e3.streamTask('rows_p', { inputs: [e3.partition(e3.input('table', TableType))], output: e3.output.dict(IntegerType, StringType) },
    ($, table, emit) => { $.for(table, ($, value, key) => { $(emit(key, value)); }); });
  const zip = join(f.home, 'calls.zip'); await e3.export(e3.package('cli_calls', '1.0.0', text, measure, readConfig, rows), zip);
  const storage = new LocalStorage(); await packageImport(storage, f.repo, zip);
  await workspaceCreate(storage, f.repo, 'calls');
  await workspaceDeploy(storage, f.repo, 'calls', 'cli_calls', '1.0.0');
}

it('observes a new enrollment before the managed worker starts or advertises capacity', async () => {
  const f = await enrolled(); // The old same-label registration must not finish the new wait.
  const initial = await f.client.status(); assert.equal(initial.racks.length, 1);
  assert(initial.rackListener.type === 'up');
  const enrolling = spawnE3Command(['rack', 'enroll', '--label', 't'], f.repo, { env: f.env });
  cleanup.push(async () => { enrolling.kill('SIGKILL'); await enrolling.result; });
  await waitFor(() => enrolling.getStdout().includes('Enrollment token: '));
  const token = /^Enrollment token: (e3rk_enroll_\S+)$/m.exec(enrolling.getStdout())?.[1]; assert(token);
  const peer = new TestRackAgent({ apiUrl: initial.rackListener.value.origin, workDir: join(f.home, 'enrollment-peer'), certificateSha256: f.pin });
  cleanup.push(() => peer.close());
  const registration = await peer.post('enroll', RackEnrollRequestType, { enrollmentToken: token,
    hostInfo: { label: 't', tiers: [], capacity: 0n, agentVersion: `${E3_RACK_VERSION}+e3.${E3_RACK_VERSION}` } }, RackEnrollResponseType);
  let result: CliResult | undefined;
  const finished = enrolling.result.then((value) => { result = value; });
  await waitFor(() => result !== undefined);
  await finished;
  const output = ok(result!);
  assert(output.includes(`New registration observed: t (${registration.rackId})`));
  assert.match(output, /does not confirm activation or task readiness/);
  const row = output.split('\n').find((line) => line.includes(registration.rackId.slice(0, 12)) && line.includes('0/0'));
  assert(row, output); assert.match(row, /enrolled-not-started$/);
  assert((await f.client.status()).racks.some((rack) => rack.rackId === registration.rackId && rack.lastBootId.type === 'none'));
});

it('prints the advertised HTTPS source and its certificate without the plain-HTTP opt-in', async () => {
  const f = await fixture();
  ok(await f.cli('rack', 'config', '--listen', '127.0.0.1:0', '--advertise-url', 'https://rack-source.example.invalid'));
  const output = ok(await f.cli('rack', 'enroll', '--no-wait'));
  assert.match(output, /^Source origin: https:\/\/rack-source.example.invalid$/m);
  assert.match(output, /^Certificate SHA-256: (?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/m);
  assert.doesNotMatch(output, /--allow-vpn-http|--token|--api-url| install /);
  const help = ok(await f.cli('rack', 'enroll', '--help'));
  assert.doesNotMatch(help, /--instance|--tiers|--max-vms|--gpus/);
  assert.match(help, /prepared\s+rack\s+worker\s+VM/);
});

it('configures the data origins a hub spreads its data URLs over, prints them in its config and status, and clears them', async () => {
  const f = await fixture();
  const advertised = 'https://rack-source.example.invalid:7401';
  const extras = ['https://rack-source.example.invalid:7421', 'https://rack-source.example.invalid:7441'];
  const none = /^Data origins: none \(every data URL on the advertised origin\)$/m;
  assert.match(ok(await f.cli('rack', 'config', '--listen', '127.0.0.1:0', '--advertise-url', advertised)), none);
  const set = ok(await f.cli('rack', 'config', '--data-origin', extras[0]!, '--data-origin', extras[1]!));
  assert.match(set, new RegExp(`^Data origins: ${extras.join(', ')}, beside the advertised origin$`, 'm'));
  assert.match(set, new RegExp(`^Advertise URL: ${advertised}$`, 'm'), 'the rest of the configuration is as it was');
  assert.match(ok(await f.cli('rack', 'status')), new RegExp(`^Data origins: ${extras.join(', ')}, beside the advertised origin$`, 'm'));
  assert.deepEqual((await new HubClient(f.home).getConfig()).dataOrigins, extras);
  const refused = async (args: string[], reason: RegExp) => {
    const result = await f.cli('rack', 'config', ...args);
    assert.notEqual(result.exitCode, 0, result.stdout); assert.match(result.stderr, reason);
  };
  await refused(['--data-origin', 'http://rack-source.example.invalid:7421'], /data origins must be https:\/\//);
  await refused(['--data-origin', advertised], /is the advertised origin/);
  await refused(['--data-origin', `${extras[0]!}/path`], /must be an HTTP\(S\) origin/);
  await refused(['--no-data-origins', '--data-origin', extras[0]!], /cannot be given together/);
  assert.match(ok(await f.cli('rack', 'status')), new RegExp(`^Data origins: ${extras.join(', ')}, beside`, 'm'), 'a refused change leaves them as they were');
  assert.match(ok(await f.cli('rack', 'config', '--no-data-origins')), none);
  assert.match(ok(await f.cli('rack', 'status')), none);
});

it('serves plain HTTP only on a loopback or private address it names in --allow, and prints the HTTP opt-in', async () => {
  const f = await fixture();
  const refused = async (args: string[], reason: RegExp) => {
    const result = await f.cli('rack', 'config', ...args);
    assert.notEqual(result.exitCode, 0, result.stdout); assert.match(result.stderr, reason);
  };
  await refused(['--no-tls', '--listen', '127.0.0.1:0'], /must name the addresses it admits/);
  await refused(['--no-tls', '--listen', '0.0.0.0:0', '--allow', '127.0.0.1'], /every address/);
  await refused(['--no-tls', '--listen', '8.8.8.8:7331', '--allow', '127.0.0.1'], /loopback or a private address, not 8\.8\.8\.8/);
  await refused(['--listen', '127.0.0.1:0', '--advertise-url', 'http://relay.example.invalid'], /must advertise an https:\/\/ origin/);
  const config = ok(await f.cli('rack', 'config', '--no-tls', '--listen', '127.0.0.1:0', '--allow', '127.0.0.1'));
  assert.match(config, /^TLS: off$/m); assert.match(config, /^Listener: up http:\/\/127\.0\.0\.1:\d+$/m);
  const handoff = ok(await f.cli('rack', 'enroll', '--no-wait'));
  assert.match(handoff, /^Source origin: http:\/\/127\.0\.0\.1:\d+$/m);
  assert.doesNotMatch(handoff, /Certificate SHA-256/);
  assert.match(handoff, /configure --allocation '[^']+' --allow-vpn-http/);
  assert.match(handoff, /never across a VPN hub that decrypts traffic/);
});

it('shows a fenced worker as unavailable and a resumed worker as ready', async () => {
  const f = await enrolled();
  await f.agent.post('heartbeat', RackHeartbeatRequestType, {
    healthy: false, freeCapacity: 0n, runningLeases: [], agentVersion: `${E3_RACK_VERSION}+e3.${E3_RACK_VERSION}`,
    bootId: 'fenced-fixture', cacheBytes: 0n, report: JSON.stringify({ features: [] }),
  }, RackHeartbeatResponseType);
  assert.match(ok(await f.cli('rack', 'list')), /0\/0\s+.*unavailable/);
  await f.agent.heartbeat();
  assert.match(ok(await f.cli('rack', 'list')), /t\s+.*ready/);
});

it('shows a rack whose agent asks in another rack protocol as incompatible, with what to do, until its agent is updated', async () => {
  const f = await enrolled();
  const heartbeat = { healthy: true, freeCapacity: 1n, runningLeases: [], agentVersion: `${E3_RACK_VERSION}+e3.${E3_RACK_VERSION}`,
    bootId: f.agent.bootId, cacheBytes: 0n, report: JSON.stringify({ features: [] }) };
  const refused = await f.agent.raw('heartbeat', RackHeartbeatRequestType, heartbeat, RACK_PROTOCOL - 1);
  assert.equal(refused.status, 426); await refused.arrayBuffer();
  assert.match(ok(await f.cli('rack', 'list')), new RegExp(`t\\s+.*incompatible: speaks rack protocol ${RACK_PROTOCOL - 1}, not ${RACK_PROTOCOL}; update the rack$`, 'm'));
  await f.agent.heartbeat();
  assert.match(ok(await f.cli('rack', 'list')), /t\s+.*ready/);
});

it('lists a rack that admits by its resources with all it has and what is free, and a run says them', async () => {
  const f = await enrolled({ resources: { cores: 4, memoryBytes: 8 * 1024 ** 3, gpus: 1 } });
  // The test agent composes environments for the platform of the machine it runs on, where e3 installs one for it.
  const platform = hostEnvironmentPlatform();
  const features = platform === null ? 'resources' : 'resources,environments';
  assert.match(ok(await f.cli('rack', 'list')), new RegExp(`^t {2}.* {2}4 cores \\(4 free\\), 8 GB \\(8 GB free\\), 1 GPU \\(1 free\\) {2}${features} {2}ready$`, 'm'));
  // A `small` task asks 2 cores and 4 GiB of it.
  ok(await f.cli('rack', 'policy', '.', 'set', 'train_*', 'rack', '--size', 'small'));
  const running = f.cli('dataflow', 'run', '.', 'ws1', '--rack');
  const grant = await f.agent.claim(); assert(grant);
  assert.match(ok(await f.cli('rack', 'list')), new RegExp(`^t {2}.* {2}4 cores \\(2 free\\), 8 GB \\(4 GB free\\), 1 GPU \\(1 free\\) {2}${features} {2}ready$`, 'm'));
  assert.equal((await f.agent.execute(grant)).status, 'success');
  const output = ok(await running);
  assert.match(output, new RegExp(`^Rack: t \\(4 cores, 8 GB, 1 GPU, e3 \\S+${platform === null ? '' : `, environments for ${platform}`}\\)$`, 'm'));
  assert.match(output, /^ {2}\[RACK\] train_a → t \(cap 4 GB\)$/m);
  assert.match(output, /^Rack summary: 1 task on t · 0 waited for capacity · 0 ran again · 0 transfers retried · 0 ran locally$/m);
});

it('round-trips policy, auto-starts and stops the hub, and delegates an enabled CLI run', async () => {
  const f = await enrolled();
  ok(await f.cli('rack', 'policy', '.', 'set', 'train_*', 'rack', '--size', 'xlarge', '--memory-limit', '8G', '--gpu'));
  assert.match(ok(await f.cli('rack', 'policy', '.', 'show')), /^1\. train_\* → rack, size=xlarge, timeout=default, allow-host-access=false, memory-limit=8 GB, gpu$/m);
  const refused = await f.cli('rack', 'policy', '.', 'set', 'train_*', 'rack', '--memory-limit', 'plenty');
  assert.notEqual(refused.exitCode, 0); assert.match(refused.stderr, /--memory-limit must be a memory size, such as 8G or 512M/);
  // Where a split task's merges run: its rule's, else the policy's default, a rack's unless set
  assert.match(ok(await f.cli('rack', 'policy', '.', 'show')), /^Defaults: .*, merges=rack, keep=split$/m);
  ok(await f.cli('rack', 'policy', '.', 'set', 'train_*', 'rack', '--merges', 'local'));
  assert.match(ok(await f.cli('rack', 'policy', '.', 'show')), /^1\. train_\* → rack, size=default, timeout=default, allow-host-access=false, merges=local$/m);
  const nowhere = await f.cli('rack', 'policy', '.', 'set', 'train_*', 'rack', '--merges', 'elsewhere');
  assert.notEqual(nowhere.exitCode, 0); assert.match(nowhere.stderr, /--merges must be rack or local, not 'elsewhere'/);
  assert.match(ok(await f.cli('rack', 'policy', '.', 'defaults', '--merges', 'local')), /^Defaults: .*, merges=local, keep=split$/m);
  ok(await f.cli('rack', 'policy', '.', 'defaults', '--merges', 'rack'));
  // How long a rack keeps what work wrote there: a split task's, unless the policy keeps it for the session
  assert.match(ok(await f.cli('rack', 'policy', '.', 'defaults', '--keep', 'session')), /^Defaults: .*, merges=rack, keep=session$/m);
  const ruled = await f.cli('rack', 'policy', '.', 'set', 'train_*', 'rack', '--keep', 'session');
  assert.notEqual(ruled.exitCode, 0); assert.match(ruled.stderr, /--keep is the policy's, not a rule's/);
  // Nor is a flag another verb reads ignored: the weighing is the policy's, and merges a rule's or the defaults'
  const weighedRule = await f.cli('rack', 'policy', '.', 'set', 'train_*', 'rack', '--no-weigh-fetch');
  assert.notEqual(weighedRule.exitCode, 0); assert.match(weighedRule.stderr, /--weigh-fetch\/--no-weigh-fetch is the policy's, not a rule's/);
  const enabledMerges = await f.cli('rack', 'policy', '.', 'enable', '--merges', 'local');
  assert.notEqual(enabledMerges.exitCode, 0); assert.match(enabledMerges.stderr, /--merges is taken by e3 rack policy set or defaults, not enable/);
  const forever = await f.cli('rack', 'policy', '.', 'defaults', '--keep', 'forever');
  assert.notEqual(forever.exitCode, 0); assert.match(forever.stderr, /--keep must be split or session, not 'forever'/);
  ok(await f.cli('rack', 'policy', '.', 'defaults', '--keep', 'split'));
  ok(await f.cli('rack', 'policy', '.', 'set', 'train_*', 'rack', '--size', 'large'));
  const policy = ok(await f.cli('rack', 'policy', '.', 'show'));
  assert.match(policy, /1\. train_\* → rack, size=large/); assert(!policy.includes('2. train_'));
  ok(await f.cli('rack', 'policy', '.', 'enable'));
  const running = f.cli('dataflow', 'run', '.', 'ws1');
  const remote = await f.agent.runOne(); assert.equal(remote?.status, 'success');
  const output = ok(await running); assert.match(output, /Rack: t/); assert.match(output, /\[RACK\] train_a → t/);
  assert.match(output, /^Rack summary: 1 task on t · 0 waited for capacity · 0 ran again · 0 transfers retried · 0 ran locally$/m);
  assert.match(ok(await f.cli('rack', 'status')), /^Last outcomes:\n {2}\S+ {2}ws1\.train_a {2}t {2}success$/m);
  const remoteDataset = ok(await f.cli('dataset', 'get', '.', 'ws1.train_a'));
  const logs = ok(await f.cli('task', 'logs', '.', 'ws1.train_a'));
  assert.match(logs, /e3: running on rack t/);
  const local = ok(await f.cli('dataflow', 'run', '.', 'ws2', '--no-rack'));
  assert(!local.includes('Rack:')); assert(!local.includes('[RACK]')); assert(!local.includes('Rack summary'));
  assert.equal(ok(await f.cli('dataset', 'get', '.', 'ws2.train_a')), remoteDataset);
  assert.equal((await f.client.status()).capacity.queued, 0n);
  ok(await f.cli('rack', 'policy', '.', 'unset', 'train_*'));
  assert(!ok(await f.cli('rack', 'policy', '.', 'show')).includes('1. train_'));
  // A policy weighs nothing of what work would fetch unless told to, and is told not to again
  assert.match(ok(await f.cli('rack', 'policy', '.', 'show')), /^Defaults: .*, weigh-fetch=false, merges=rack, keep=split$/m);
  assert.match(ok(await f.cli('rack', 'policy', '.', 'defaults', '--weigh-fetch')), /^Defaults: .*, weigh-fetch=true, merges=rack, keep=split$/m);
  assert.match(ok(await f.cli('rack', 'policy', '.', 'show')), /^Defaults: .*, spill=true, .*, weigh-fetch=true, merges=rack, keep=split$/m);
  assert.match(ok(await f.cli('rack', 'policy', '.', 'defaults', '--no-weigh-fetch')), /^Defaults: .*, weigh-fetch=false, merges=rack, keep=split$/m);
  ok(await f.cli('rack', 'stop'));
  assert.match(ok(await f.cli('rack', 'status')), /no rack hub running/);
});

it('shows concurrent sessions and shares their attempt while one CLI cancellation leaves the other running', async () => {
  const f = await enrolled();
  ok(await f.cli('rack', 'policy', '.', 'mode', 'auto'));
  const a = spawnE3Command(['dataflow', 'run', '.', 'ws1', '--rack'], f.repo, { env: f.env });
  cleanup.push(async () => { a.kill('SIGKILL'); await a.result; });
  const grant = await f.agent.claim(); assert(grant);
  const b = spawnE3Command(['dataflow', 'run', '.', 'ws2', '--rack'], f.repo, { env: f.env });
  cleanup.push(async () => { b.kill('SIGKILL'); await b.result; });
  await waitFor(() => b.getStdout().includes('[RACK]'));
  assert.match(ok(await f.cli('rack', 'status')), /Sessions: 2/);
  // Windows process.kill terminates outright; it cannot deliver Ctrl-C to
  // the handler. Exercise both concurrent runs there, and cancellation on POSIX.
  if (process.platform !== 'win32') { a.kill('SIGINT'); assert.equal((await a.result).exitCode, 130); }
  assert.ok(sameLeaseRefs((await f.agent.heartbeat([grant])).stop, []));
  assert.equal((await f.agent.execute(grant)).status, 'success'); ok(await b.result);
  if (process.platform === 'win32') ok(await a.result);
  await waitFor(async () => (await f.client.status()).sessions.length === 0);
});

it('cancels the final CLI subscriber and tells the rack to stop', {
  skip: process.platform === 'win32' ? 'a test cannot deliver Ctrl-C on Windows: process.kill ends the CLI outright' : false,
}, async () => {
  const f = await enrolled(); ok(await f.cli('rack', 'policy', '.', 'mode', 'auto'));
  const run = spawnE3Command(['dataflow', 'run', '.', 'ws1', '--rack-only'], f.repo, { env: f.env });
  cleanup.push(async () => { run.kill('SIGKILL'); await run.result; });
  const grant = await f.agent.claim(); assert(grant);
  run.kill('SIGINT'); assert.equal((await run.result).exitCode, 130);
  assert.ok(sameLeaseRefs((await f.agent.heartbeat([grant])).stop, [{ repo: grant.repo, leaseId: grant.leaseId }]));
});

it('refuses remote rack flags before authentication and requires watch --start', async () => {
  const f = await fixture();
  const remote = 'https://example.invalid/repos/r';
  for (const args of [...['--rack', '--no-rack', '--rack-only'].map((flag) => ['dataflow', 'run', remote, 'dev', flag]),
    ...['--rack', '--rack-only'].flatMap((flag) => [['run', remote, 'cli_rack.train_a', '-o', 'out.beast2', flag], ['call', remote, '-w', 'dev', 'measure', flag],
      ['call', remote, '-w', 'dev', '--ir', 'add.beast2', '1', flag]])]) {
    const result = await f.cli(...args);
    assert.notEqual(result.exitCode, 0, args.join(' ')); assert.match(result.stderr, /rack delegation applies to local repositories/, args.join(' '));
  }
  const watch = await f.cli('watch', '.', 'ws1', '.', '--rack');
  assert.notEqual(watch.exitCode, 0); assert.match(watch.stderr, /requires --start/);
});

it('reuses the watch session after abort-on-change and closes it on SIGINT', {
  skip: process.platform === 'win32' ? 'a test cannot deliver Ctrl-C on Windows: process.kill ends the CLI outright' : false,
}, async () => {
  const f = await enrolled(); ok(await f.cli('rack', 'policy', '.', 'mode', 'auto'));
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(f.home, 'node_modules'), 'junction');
  const source = join(f.home, 'watch.ts');
  const program = (increment: number) => `
import { East, IntegerType } from '@elaraai/east';
import e3 from '@elaraai/e3';
const task = e3.task('train_watch', [], East.function([], IntegerType, () => ${increment}n));
export default e3.package('watch_rack', '1.0.${increment}', task);
`;
  await writeFile(source, program(1));
  const watch = spawnE3Command(['watch', source, '.', 'watch', '--start', '--rack', '--abort-on-change'], f.repo, { env: f.env });
  cleanup.push(async () => { watch.kill('SIGKILL'); await watch.result; });
  const first = await f.agent.claim(); assert(first, watch.getStdout());
  const before = (await f.client.status()).sessions; assert.equal(before.length, 1);
  await writeFile(source, program(2));
  await waitFor(() => watch.getStdout().includes('Dataflow aborted'));
  assert.ok(sameLeaseRefs((await f.agent.heartbeat([first])).stop, [{ repo: first.repo, leaseId: first.leaseId }]));
  const next = await f.agent.claim(); assert(next, watch.getStdout());
  assert.equal((await f.client.status()).sessions[0]!.sessionId, before[0]!.sessionId);
  assert.equal((await f.agent.execute(next)).status, 'success');
  await waitFor(() => watch.getStdout().includes('Dataflow complete'));
  assert.equal(ok(await f.cli('dataset', 'get', '.', 'watch.train_watch')).trim(), '2');
  watch.kill('SIGINT'); assert.equal((await watch.result).exitCode, 0);
  await waitFor(async () => (await f.client.status()).sessions.length === 0);
});

it('runs an ad-hoc task on a rack with --rack, recorded as a local run is, and leases nothing for a run the cache answers', async () => {
  const f = await enrolled(); await asProject(f);
  const input = join(f.home, 'text.beast2'); await writeFile(input, encodeBeast2For(StringType)('four'));
  const [onRack, here] = [join(f.home, 'rack.beast2'), join(f.home, 'here.beast2')];
  const running = f.cli('run', '.', 'cli_rack.train_a', input, '-o', onRack, '--rack');
  const grant = await f.agent.claim(); assert(grant);
  assert.equal((await f.agent.execute(grant)).status, 'success');
  const output = ok(await running);
  assert.match(output, /^ {2}\[RACK\] train_a → t\b/m);
  assert.match(output, /^Rack summary: 1 task on t · 0 waited for capacity · 0 ran again · 0 transfers retried · 0 ran locally$/m);
  assert.equal(decodeBeast2For(IntegerType)(await readFile(onRack)), 4n);

  // Run here again, it writes the same output, and the task's history holds both runs
  const local = ok(await f.cli('run', '.', 'cli_rack.train_a', input, '-o', here, '--force'));
  assert.doesNotMatch(local, /\[RACK\]|Rack summary/);
  const storage = new LocalStorage();
  const taskHash = (await packageRead(storage, f.repo, 'cli_rack', '1.0.0')).tasks.get('train_a')!;
  const inputs = await storage.refs.executionListForTask(f.repo, taskHash); assert.equal(inputs.length, 1);
  const attempts = await storage.refs.executionListAttempts(f.repo, taskHash, inputs[0]!);
  const outputs = attempts.map(({ status }) => (status?.type === 'success' ? status.value.outputHash : status?.type));
  assert.equal(outputs.length, 2); assert.equal(outputs[0], outputs[1], 'the rack\'s run and the local run wrote the same output');
  assert.equal(decodeBeast2For(IntegerType)(await readFile(here)), 4n);

  // A run the cache answers is no rack's work. Its output file is replaced,
  // never written into: what else names the old file keeps the old file
  const kept = join(f.home, 'kept.beast2'); await link(onRack, kept);
  const cached = ok(await f.cli('run', '.', 'cli_rack.train_a', input, '-o', onRack, '--rack'));
  assert.match(cached, /^Cached /m); assert.doesNotMatch(cached, /\[RACK\]|Rack summary/);
  assert.equal((await f.client.status()).capacity.queued, 0n);
  assert.notEqual((await stat(onRack, { bigint: true })).ino, (await stat(kept, { bigint: true })).ino, 'the output is a new file');

  // The input stays its user's to write again: the store took a copy, so a
  // run of the first bytes after the file was written into reads those bytes
  await writeFile(input, encodeBeast2For(StringType)('seven!!'));
  const first = join(f.home, 'first.beast2'); await writeFile(first, encodeBeast2For(StringType)('four'));
  ok(await f.cli('run', '.', 'cli_rack.train_a', first, '-o', here, '--force'));
  assert.equal(decodeBeast2For(IntegerType)(await readFile(here)), 4n, 'the stored input holds the bytes it was stored under');

  // A run the cache answers opens no rack session: with no hub running, it
  // starts none
  ok(await f.cli('rack', 'stop'));
  const unattended = ok(await f.cli('run', '.', 'cli_rack.train_a', first, '-o', here, '--rack'));
  assert.match(unattended, /^Cached /m); assert.doesNotMatch(unattended, /\[RACK\]|\[LOCAL\]|starting rack hub/);
  assert.match(ok(await f.cli('rack', 'status')), /no rack hub running/);
});

it('leaves an ad-hoc run\'s lease on Ctrl-C and tells its rack to stop, writing no output', {
  skip: process.platform === 'win32' ? 'a test cannot deliver Ctrl-C on Windows: process.kill ends the CLI outright' : false,
}, async () => {
  const f = await enrolled(); await asProject(f);
  const input = join(f.home, 'text.beast2'); await writeFile(input, encodeBeast2For(StringType)('four'));
  const out = join(f.home, 'out.beast2');
  const run = spawnE3Command(['run', '.', 'cli_rack.train_a', input, '-o', out, '--rack'], f.repo, { env: f.env });
  cleanup.push(async () => { run.kill('SIGKILL'); await run.result; });
  const grant = await f.agent.claim(); assert(grant);
  run.kill('SIGINT');
  const result = await run.result;
  assert.equal(result.exitCode, 130, result.stderr);
  assert.match(result.stderr, /Interrupted: the task's racks are told to stop it/);
  assert.ok(sameLeaseRefs((await f.agent.heartbeat([grant])).stop, [{ repo: grant.repo, leaseId: grant.leaseId }]));
  await assert.rejects(() => stat(out), /ENOENT/, 'nothing was written');
});

it('runs a task split over its input on a rack with --rack-only, its pieces and merges leased, and says where they ran', async () => {
  // A rack that holds a whole task's cap (16 GiB for the default size): where
  // this machine's budget has no guard, as on Windows, a split task's first
  // piece runs alone to be measured, capped as a whole task is, and a rack
  // too small for that cap would send it here by name
  const f = await enrolled({ resources: { cores: 4, memoryBytes: 32 * 1024 ** 3, gpus: 0 } }); await withCalls(f);
  f.agent.start();
  // Enough rows for several segments, a piece each at the test's piece size
  const table = new SortedMap(Array.from({ length: 3_600 }, (_, i) => [BigInt(i), `row-${i}`] as [bigint, string]), compareFor(IntegerType));
  const input = join(f.home, 'table.beast2'); await writeFile(input, encodeInSegmentsOf(TableType, 1_000)(table));
  const out = join(f.home, 'rows.beast2');
  const output = ok(await runE3Command(['run', '.', 'cli_calls.rows_p', input, '-o', out, '--rack-only'], f.repo,
    { env: { ...f.env, E3_TEST_PIECE_BYTES: '256' } }));
  const summary = /^Rack summary: (\d+) units on t · .* · 0 ran locally$/m.exec(output); assert(summary, output);
  assert.ok(Number(summary[1]) > 2, `${summary[1]} units ran on the rack`);
  assert.ok(equalFor(TableType)(decodeBeast2For(TableType)(await readFile(out)), table), 'the pieces\' outputs join into the table they were cut from');
});

it('calls a named function and an IR file\'s on a rack with --rack, with a dataset argument and a value past what a lease carries inline', async () => {
  const f = await enrolled(); await withCalls(f);
  const onRack = async (args: string[]): Promise<CliResult> => {
    const calling = f.cli('call', '.', ...args, '--rack');
    const grant = await f.agent.claim(); assert(grant, args.join(' '));
    assert.equal((JSON.parse(grant.eventJson) as { runnerEvent: { mode: string } }).runnerEvent.mode, 'run-detached', 'a call\'s lease');
    assert.equal((await f.agent.execute(grant)).status, 'success');
    const result = await calling; assert.equal(result.exitCode, 0, result.stderr);
    return result;
  };
  // `text` holds 'four'
  const dataset = await onRack(['-w', 'calls', 'measure', '@.inputs.text']);
  assert.equal(dataset.stdout, '4\n');
  assert.match(dataset.stderr, /^ {2}\[RACK\] fn:measure → t\b/m);
  const big = join(f.home, 'big.beast2'); await writeFile(big, encodeBeast2For(StringType)('x'.repeat(300 * 1024)));
  assert.equal((await onRack(['cli_calls.measure', big])).stdout, `${300 * 1024}\n`);
  const ir = join(f.home, 'add.beast2');
  await writeFile(ir, encodeEastIR(East.function([IntegerType, IntegerType], IntegerType, (_$, a, b) => a.add(b)).toIR()));
  const anonymous = await onRack(['--ir', ir, '2', '3']);
  assert.equal(anonymous.stdout, '5\n');
  assert.match(anonymous.stderr, /^ {2}\[RACK\] fn:add → t\b/m);
});

it('lays a call\'s drafts here and runs its function on a rack, with --rack, saving nothing', async () => {
  const f = await enrolled(); await asProject(f);
  // `jobs` holds j1 on P1, j2 on P2 and j3 on P1
  const zip = await createDraftsPackageZip(f.home, 'rack_drafts', '1.0.0');
  await packageImport(new LocalStorage(), f.repo, zip);
  // Deployed as a user deploys it: its record's index is built here
  ok(await f.cli('workspace', 'create', '.', 'drafted'));
  ok(await f.cli('workspace', 'deploy', '.', 'drafted', 'rack_drafts@1.0.0'));
  // A rule that names the call gives it a minute, which its draft and its function share
  ok(await f.cli('rack', 'policy', '.', 'set', 'fn:jobs_on', 'rack', '--timeout', '1'));
  const p = (text: string) => printFor(StringType)(text);
  const calling = f.cli('call', '.', '-w', 'drafted', 'jobs_on', p('P1'), '--rack', '--draft', 'jobs.move', p('j2'), p('P1'));
  // The function's run is the call's one lease: its draft is laid here
  const grant = await f.agent.claim(); assert(grant);
  const event = (JSON.parse(grant.eventJson) as { runnerEvent: { mode: string; timeoutMs: number } }).runnerEvent;
  assert.equal(event.mode, 'run-detached', 'a call\'s lease');
  assert.ok(event.timeoutMs > 0 && event.timeoutMs < 60_000, `the function has what its draft left of the rule's minute: ${event.timeoutMs} ms`);
  assert.equal((await f.agent.execute(grant)).status, 'success');
  const result = await calling; assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /^3$/m, 'the function on the rack read j2 moved to P1');
  assert.match(result.stderr, /^ {2}\[RACK\] fn:jobs_on → t\b/m);
  assert.equal((await f.client.status()).capacity.queued, 0n, 'nothing else was leased');
  assert.match(ok(await f.cli('call', '.', '-w', 'drafted', 'jobs_on', p('P1'))), /^2$/m, 'and the record reads as it was saved');
});

it('runs here at once a call no rack may run, under --rack, says why, and starts no hub for it', async () => {
  const f = await enrolled(); await withCalls(f); await asProject(f);
  // Judged before any rack session is opened: with no hub running, none is started
  ok(await f.cli('rack', 'stop'));
  const config = join(f.home, 'config.txt'); await writeFile(config, 'mode=fast');
  const result = await f.cli('call', '.', 'cli_calls.read_config', printFor(StringType)(config), '--rack');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, `${printFor(StringType)('mode=fast')}\n`);
  assert.match(result.stderr, /^ {2}\[LOCAL\] fn:read_config \(host-coupled:fs_read_file\)$/m);
  assert.doesNotMatch(result.stderr, /starting rack hub|no-rack-session/);
  assert.match(ok(await f.cli('rack', 'status')), /no rack hub running/, 'nothing was leased, and no hub started');
});

it('leaves a call\'s lease on Ctrl-C and tells its rack to stop', {
  skip: process.platform === 'win32' ? 'a test cannot deliver Ctrl-C on Windows: process.kill ends the CLI outright' : false,
}, async () => {
  const f = await enrolled(); await withCalls(f);
  const call = spawnE3Command(['call', '.', '-w', 'calls', 'measure', '@.inputs.text', '--rack'], f.repo, { env: f.env });
  cleanup.push(async () => { call.kill('SIGKILL'); await call.result; });
  const grant = await f.agent.claim(); assert(grant);
  call.kill('SIGINT');
  const result = await call.result;
  assert.equal(result.exitCode, 130, result.stderr);
  assert.match(result.stderr, /Interrupted: the call's rack is told to stop it/);
  assert.ok(sameLeaseRefs((await f.agent.heartbeat([grant])).stop, [{ repo: grant.repo, leaseId: grant.leaseId }]));
});
