/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { East, IntegerType, StringType, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { LocalStorage, packageImport, repoInit, workspaceCreate, workspaceDeploy } from '@elaraai/e3-core';
import { E3_RACK_VERSION, HubClient } from '@elaraai/e3-rack';
import { RackEnrollRequestType, RackEnrollResponseType } from '@elaraai/e3-rack/protocol';
import { TestRackAgent } from '@elaraai/e3-rack/testing';
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

async function enrolled() {
  const f = await fixture();
  ok(await f.cli('rack', 'config', '--listen', '127.0.0.1:0'));
  const status = ok(await f.cli('rack', 'status'));
  const origin = /Listener: up (http:\/\/\S+)/.exec(status)?.[1]; assert(origin, status);
  const handoff = ok(await f.cli('rack', 'enroll', '--label', 't', '--no-wait'));
  assert(handoff.includes(`Matching e3-rack release: ${E3_RACK_VERSION}`));
  assert.match(handoff, /configure --allocation '[^']+' --allow-vpn-http/);
  assert.match(handoff, /enroll --allocation '[^']+' --allow-vpn-http/);
  const token = /^Enrollment token: (e3rk_enroll_\S+)$/m.exec(handoff)?.[1]; assert(token, handoff);
  assert(handoff.includes(`Source origin: ${origin}`));
  for (const command of handoff.split('\n').filter((line) => line.startsWith('  sudo '))) {
    assert(!command.includes(token)); assert(!command.includes(origin));
    assert.doesNotMatch(command, /--token|--api-url| install /);
  }
  const agent = await TestRackAgent.enroll(origin, token, { label: 't' }); cleanup.push(() => agent.close());
  assert.match(ok(await f.cli('rack', 'list')), /t\s+.*ready/);
  return { ...f, agent, client: new HubClient(f.home) };
}

it('observes a new enrollment before the managed worker starts or advertises capacity', async () => {
  const f = await enrolled(); // The old same-label registration must not finish the new wait.
  const initial = await f.client.status(); assert.equal(initial.racks.length, 1);
  assert(initial.rackListener.type === 'up');
  const enrolling = spawnE3Command(['rack', 'enroll', '--label', 't'], f.repo, { env: f.env });
  cleanup.push(async () => { enrolling.kill('SIGKILL'); await enrolling.result; });
  await waitFor(() => enrolling.getStdout().includes('Enrollment token: '));
  const token = /^Enrollment token: (e3rk_enroll_\S+)$/m.exec(enrolling.getStdout())?.[1]; assert(token);
  const peer = new TestRackAgent({ apiUrl: initial.rackListener.value.origin, workDir: join(f.home, 'enrollment-peer') });
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

it('prints the advertised HTTPS source without the VPN HTTP opt-in', async () => {
  const f = await fixture();
  ok(await f.cli('rack', 'config', '--listen', '127.0.0.1:0', '--advertise-url', 'https://rack-source.example.invalid'));
  const output = ok(await f.cli('rack', 'enroll', '--no-wait'));
  assert.match(output, /^Source origin: https:\/\/rack-source.example.invalid$/m);
  assert.doesNotMatch(output, /--allow-vpn-http|--token|--api-url| install /);
  const help = ok(await f.cli('rack', 'enroll', '--help'));
  assert.doesNotMatch(help, /--instance|--tiers|--max-vms|--gpus/);
  assert.match(help, /prepared\s+rack\s+worker\s+VM/);
});

it('round-trips policy, auto-starts and stops the hub, and delegates an enabled CLI run', async () => {
  const f = await enrolled();
  ok(await f.cli('rack', 'policy', '.', 'set', 'train_*', 'rack', '--size', 'xlarge'));
  assert.match(ok(await f.cli('rack', 'policy', '.', 'show')), /1\. train_\* → rack, size=xlarge/);
  ok(await f.cli('rack', 'policy', '.', 'set', 'train_*', 'rack', '--size', 'large'));
  const policy = ok(await f.cli('rack', 'policy', '.', 'show'));
  assert.match(policy, /1\. train_\* → rack, size=large/); assert(!policy.includes('2. train_'));
  ok(await f.cli('rack', 'policy', '.', 'enable'));
  const running = f.cli('dataflow', 'run', '.', 'ws1');
  const remote = await f.agent.runOne(); assert.equal(remote?.status, 'success');
  const output = ok(await running); assert.match(output, /Rack: t/); assert.match(output, /\[RACK\] train_a → t/);
  const remoteDataset = ok(await f.cli('dataset', 'get', '.', 'ws1.train_a'));
  const logs = ok(await f.cli('task', 'logs', '.', 'ws1.train_a'));
  assert.match(logs, /e3: running on rack t/);
  const local = ok(await f.cli('dataflow', 'run', '.', 'ws2', '--no-rack'));
  assert(!local.includes('Rack:')); assert(!local.includes('[RACK]'));
  assert.equal(ok(await f.cli('dataset', 'get', '.', 'ws2.train_a')), remoteDataset);
  assert.equal((await f.client.status()).capacity.queued, 0n);
  ok(await f.cli('rack', 'policy', '.', 'unset', 'train_*'));
  assert(!ok(await f.cli('rack', 'policy', '.', 'show')).includes('1. train_'));
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
  assert.deepEqual((await f.agent.heartbeat([grant])).stop, []);
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
  assert.deepEqual((await f.agent.heartbeat([grant])).stop, [{ repo: grant.repo, leaseId: grant.leaseId }]);
});

it('refuses remote rack flags before authentication and requires watch --start', async () => {
  const f = await fixture();
  for (const flag of ['--rack', '--no-rack', '--rack-only']) {
    const result = await f.cli('dataflow', 'run', 'https://example.invalid/repos/r', 'dev', flag);
    assert.notEqual(result.exitCode, 0); assert.match(result.stderr, /rack delegation applies to local repositories/);
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
  assert.deepEqual((await f.agent.heartbeat([first])).stop, [{ repo: first.repo, leaseId: first.leaseId }]);
  const next = await f.agent.claim(); assert(next, watch.getStdout());
  assert.equal((await f.client.status()).sessions[0]!.sessionId, before[0]!.sessionId);
  assert.equal((await f.agent.execute(next)).status, 'success');
  await waitFor(() => watch.getStdout().includes('Dataflow complete'));
  assert.equal(ok(await f.cli('dataset', 'get', '.', 'watch.train_watch')).trim(), '2');
  watch.kill('SIGINT'); assert.equal((await watch.result).exitCode, 0);
  await waitFor(async () => (await f.client.status()).sessions.length === 0);
});
