/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { unlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Command } from 'commander';
import { DateTimeType, IntegerType, StringType, compareFor, equalFor, none, printFor, some, variant } from '@elaraai/east';
import type { HubClient, HubConfig, RackComputeSize, RackPolicy, RackSecurityPolicy } from '@elaraai/e3-rack';
import { defaultRepoArg, openRepo, formatError, exitError } from '../utils.js';

// The rack package, with its hub, routes and TLS, is loaded by the command
// that needs it: every other e3 command, and shell completion, starts
// without it.
type RackLib = typeof import('@elaraai/e3-rack');
const rackLib = (): Promise<RackLib> => import('@elaraai/e3-rack');

type Status = Awaited<ReturnType<HubClient['status']>>;
interface ConfigFlags { listen?: string | boolean; allow?: string | boolean; idleExit?: string; advertiseUrl?: string; tls?: boolean; requireApproval?: boolean }
interface PolicyFlags { size?: string; timeout?: string; allowHostAccess?: boolean; spill?: boolean; claimTimeout?: string; retryTaskFailuresLocally?: boolean }
const sizes = ['serverless', 'small', 'medium', 'large', 'xlarge'] as const;
const equalString = equalFor(StringType);
const compareInteger = compareFor(IntegerType);
function sizeOf(text: string): RackComputeSize {
  if (!sizes.some((size) => size === text)) throw new Error(`Unknown compute size '${text}'; choose ${sizes.join(', ')}`);
  return text as RackComputeSize;
}
function integer(text: string, name: string, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
function guarded<A extends unknown[]>(action: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  return async (...args) => { try { await action(...args); } catch (error) { exitError(formatError(error)); } };
}
function shellArg(value: string): string { return /^[a-zA-Z0-9_:/.,@+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`; }

async function configured(client: HubClient, flags: ConfigFlags): Promise<HubConfig> {
  const config = { ...await client.getConfig() };
  if (flags.listen === false) config.listen = none;
  else if (typeof flags.listen === 'string') {
    const match = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(flags.listen);
    if (match === null) throw new Error('--listen requires host:port (IPv6: [address]:port)');
    config.listen = some({ host: match[1] ?? match[2]!, port: BigInt(integer(match[3]!, 'port', 0, 65535)) });
  }
  if (flags.allow === false) config.allow = [];
  else if (typeof flags.allow === 'string') config.allow = flags.allow.split(',').map((ip) => ip.trim()).filter(Boolean);
  if (flags.idleExit !== undefined) config.idleExitMinutes = BigInt(integer(flags.idleExit, '--idle-exit', 0, 35000));
  if (flags.advertiseUrl !== undefined) config.advertiseUrl = some(flags.advertiseUrl);
  if (flags.tls !== undefined) config.tls = flags.tls;
  const changed = [flags.listen, flags.allow, flags.idleExit, flags.advertiseUrl, flags.tls].some((value) => value !== undefined);
  return changed ? client.setConfig(config) : config;
}

/** Whether a rack's boots after its first need approval, as the hub applies it, set when the flag says. */
function security(client: HubClient, flags: ConfigFlags): Promise<RackSecurityPolicy> {
  return flags.requireApproval === undefined ? client.getSecurityPolicy() : client.setSecurityPolicy({ requireStartApproval: flags.requireApproval });
}

function listenerLine(listener: Status['rackListener']): string {
  if (listener.type === 'disabled') return 'off — run e3 rack config --listen <address>:7331';
  if (listener.type === 'down') return `down ${listener.value.reason}`;
  const pin = listener.value.certificateSha256;
  return `up ${listener.value.origin}${pin.type === 'some' ? ` (certificate SHA-256 ${pin.value})` : ''}`;
}

function approvalLine(policy: RackSecurityPolicy): string {
  return `Boot approval: ${policy.requireStartApproval ? 'required after each reboot (e3 rack approve <rack>)' : 'not required'}`;
}

/** The one rack a name picks out: its id, its label, or an unambiguous id prefix. */
function findRack(status: Status, name: string): Status['racks'][number] {
  const exact = status.racks.find((rack) => equalString(rack.rackId, name));
  const matches = exact === undefined ? status.racks.filter((rack) => equalString(rack.label, name) || rack.rackId.startsWith(name)) : [exact];
  if (matches.length !== 1) throw new Error(matches.length === 0 ? `No rack '${name}'` : `Ambiguous rack '${name}': ${matches.map((rack) => rack.rackId).join(', ')}`);
  return matches[0]!;
}

function printFleet(lib: RackLib, status: Status): void {
  if (status.racks.length === 0) { console.log('No enrolled racks. Run: e3 rack enroll --listen <address>:7331'); return; }
  console.log('LABEL  ID  RUNTIMES  BUSY/CAPACITY  AGENT  E3  LAST SEEN  STATE');
  for (const rack of status.racks) {
    const capacity = status.capacity.racks.find((entry) => equalString(entry.rackId, rack.rackId));
    const bundled = lib.bundledE3Version(rack.agentVersion);
    const state = rack.lastBootId.type === 'none' ? 'enrolled-not-started'
      : capacity?.pendingApproval ? 'pending-approval'
      : !rack.healthy || compareInteger(rack.capacity, 0n) <= 0 ? 'unavailable' : !capacity?.healthy ? 'stale'
      : rack.tiers.length === 0 ? 'no-runtimes'
      : bundled === null ? 'incompatible: bundled e3 unknown'
        : !lib.agentVersionAtLeast(bundled, lib.E3_RACK_VERSION) ? `incompatible: agent e3 ${bundled} < project e3 ${lib.E3_RACK_VERSION}` : 'ready';
    console.log(`${rack.label}  ${rack.rackId.slice(0, 12)}  ${rack.tiers.join(',')}  ${Number(capacity?.busy ?? 0n)}/${Number(rack.capacity)}  ${rack.agentVersion}  ${bundled ?? '?'}  ${printFor(DateTimeType)(rack.lastSeenAt)}  ${state}`);
  }
}

function printPolicy(policy: RackPolicy): void {
  console.log(`Enabled: ${policy.enabled}\nMode: ${policy.mode.type === 'optIn' ? 'opt-in' : 'auto'}`);
  console.log(`Defaults: size=${policy.defaultSize.type}, timeout=${Number(policy.defaultTimeoutMinutes)} min, spill=${policy.spill}, claim-timeout=${Number(policy.claimTimeoutSeconds)} s, retry-task-failures-locally=${policy.retryTaskFailuresLocally}`);
  policy.rules.forEach((rule, index) => console.log(`${index + 1}. ${rule.tasks} → ${rule.target.type}, size=${rule.size.type === 'some' ? rule.size.value.type : 'default'}, timeout=${rule.timeoutMinutes.type === 'some' ? Number(rule.timeoutMinutes.value) : 'default'}, allow-host-access=${rule.allowHostCoupled}`));
}

/** Creates the rack management and repository policy command group. */
export function createRackCommand(): Command {
  const rack = new Command('rack').description('Manage this machine\'s rack hub and task routing');
  rack.command('status').description('Show the running hub, fleet, sessions and queue without starting it').action(guarded(async () => {
    const lib = await rackLib();
    const client = new lib.HubClient();
    let status: Status;
    try { status = await client.status(); } catch (error) {
      try { await lib.connectHub({ spawn: false, timeoutMs: 1000 }); } catch (connectError) {
        if (connectError instanceof lib.RackHubUnavailableError) { console.log('no rack hub running'); return; }
        throw connectError;
      }
      throw error;
    }
    const lock = await lib.readHubLock(); const config = await client.getConfig();
    console.log(`Hub: pid ${Number(status.hello.pid)}, e3 ${status.hello.version}, protocol ${Number(status.hello.protocol)}, uptime ${lock === null ? '?' : Math.round((Date.now() - lock.startedAt.getTime()) / 1000)}s, idle-exit ${Number(config.idleExitMinutes)} min`);
    console.log(`Listener: ${listenerLine(status.rackListener)}`);
    console.log(approvalLine(await client.getSecurityPolicy()));
    printFleet(lib, status);
    console.log(`Sessions: ${status.sessions.length}`);
    for (const session of status.sessions) console.log(`  ${session.label}  ${session.repoAlias}  ${session.workspace}  ${Number(session.pending)} pending / ${Number(session.claimed)} claimed  e3 ${session.e3Version}`);
    console.log(`Queue: ${Number(status.capacity.queued)} pending`);
  }));
  rack.command('list').description('List enrolled racks and compatible capacity').action(guarded(async () => {
    const lib = await rackLib();
    printFleet(lib, await (await lib.connectHub()).status());
  }));
  rack.command('remove').argument('<rackId|label>').description('Revoke a rack; its active work falls back locally').action(guarded(async (name: string) => {
    const lib = await rackLib();
    const client = await lib.connectHub(); const found = findRack(await client.status(), name);
    await client.removeRack(found.rackId);
    console.log(`Removed ${found.label}; its active leases fall back locally.`);
  }));
  rack.command('approve').argument('<rackId|label>').description('Admit the boot a rack last reported, which a reboot under --require-approval quarantines').action(guarded(async (name: string) => {
    const lib = await rackLib();
    const client = await lib.connectHub(); const found = findRack(await client.status(), name);
    if (found.lastBootId.type === 'none') throw new Error(`${found.label} has not started; enrollment admits its first boot`);
    const approved = await client.approveRack(found.rackId, found.lastBootId.value);
    const policy = await client.getSecurityPolicy();
    console.log(`Approved the boot ${approved.label} last reported.${policy.requireStartApproval ? '' : ' Boot approval is not required; e3 rack config --require-approval turns it on.'}`);
  }));
  rack.command('stop').description('Stop the shared hub and cancel its leases').action(guarded(async () => {
    const lib = await rackLib();
    // Stop is the remedy for a control-protocol mismatch. Its stable empty
    // request must remain usable without negotiating a compatible session.
    const client = new lib.HubClient();
    try { await client.stop(); } catch (error) {
      if (error instanceof Error && 'code' in error && ['ENOENT', 'ECONNREFUSED'].includes(String(error.code))) {
        console.log('no rack hub running'); return;
      }
      throw error;
    }
    // A stop reply precedes listener shutdown. Wait until the owned process
    // has removed its lock so an immediate status sees the completed stop.
    for (let n = 0; n < 250 && await lib.readHubLock() !== null; n++) await delay(20);
    if (await lib.readHubLock() !== null) throw new Error('Rack hub is still stopping; inspect e3 rack status');
    console.log('rack hub stopped');
  }));
  rack.command('hub').description('Run the shared hub in the foreground').option('--idle-exit <min>', 'Exit after this many idle minutes; 0 disables idle exit')
    .action(guarded(async (flags: ConfigFlags) => {
      const { runHub } = await import('@elaraai/e3-rack/hub-main');
      await runHub(['--foreground', ...(flags.idleExit === undefined ? [] : ['--idle-exit', flags.idleExit])]);
    }));
  rack.command('config').description('Show or update the shared hub configuration')
    .option('--listen <host:port>', 'Bind the rack listener: the loopback behind a tunnel, or a private address').option('--no-listen', 'Disable the rack listener')
    .option('--allow <ip,...>', 'Admit rack requests only from these IP addresses; required for plain HTTP').option('--no-allow', 'Remove the IP restriction')
    .option('--idle-exit <min>', 'Idle lifetime; 0 disables idle exit')
    .option('--advertise-url <url>', 'The origin racks reach the hub at (a relay, tunnel or TLS terminator); every rack and data URL is built on it')
    .option('--tls', 'Serve the listener over HTTPS with the hub\'s own certificate, which racks pin (the default)')
    .option('--no-tls', 'Serve plain HTTP, for a TLS terminator in front of the hub; loopback or private addresses with --allow only')
    .option('--require-approval', 'Quarantine a rack after each reboot until e3 rack approve admits the boot it reports')
    .option('--no-require-approval', 'Admit every boot of an enrolled rack, the default')
    .action(guarded(async (flags: ConfigFlags) => {
      const lib = await rackLib();
      const client = await lib.connectHub();
      const config = await configured(client, flags);
      const policy = await security(client, flags);
      console.log(`Listen: ${config.listen.type === 'some' ? `${config.listen.value.host}:${Number(config.listen.value.port)}` : 'off'}`);
      console.log(`TLS: ${config.tls ? 'on' : 'off'}\nAllow: ${config.allow.join(', ') || 'all'}\nIdle-exit: ${Number(config.idleExitMinutes)} min\nAdvertise URL: ${config.advertiseUrl.type === 'some' ? config.advertiseUrl.value : 'listener origin'}`);
      console.log(approvalLine(policy));
      console.log(`Listener: ${listenerLine((await client.status()).rackListener)}`);
    }));
  rack.command('enroll').description('Print a single-use token for interactive enrollment inside a prepared rack worker VM')
    .option('--label <label>', 'Wait for a new registration with this worker label').option('--listen <host:port>', 'Listener address, as for e3 rack config')
    .option('--allow <ip,...>', 'Allowed rack IP addresses').option('--advertise-url <url>', 'The origin racks reach the hub at, as for e3 rack config')
    .option('--ttl <min>', 'Single-use enrollment lifetime', '15')
    .option('--no-wait', 'Print the enrollment handoff and return')
    .addHelpText('after', '\nConfigure worker resources, runtime tiers and GPU allocation on the rack host. Enrollment does not start an agent or authorize task execution.')
    .action(guarded(async (flags: ConfigFlags & { label?: string; ttl: string; wait: boolean }) => {
      const lib = await rackLib();
      const client = await lib.connectHub({ log: console.log });
      const config = await configured(client, flags);
      if (config.listen.type === 'none') throw new Error('Configure a reachable address: e3 rack enroll --listen <address>:7331');
      const before = new Set((await client.status()).racks.map((rack) => rack.rackId));
      const mint = await client.enroll({ label: flags.label === undefined ? none : some(flags.label), ttlMinutes: some(BigInt(integer(flags.ttl, '--ttl', 1, 1440))) });
      const executable = shellArg(`/opt/e3-rack/releases/${mint.e3Version}/e3-rack`);
      const allocation = "'/var/lib/e3-rack/<agent-uuid>/allocation.json'";
      const vpnHttp = mint.apiUrl.startsWith('http:') ? ' --allow-vpn-http' : '';
      const pin = mint.certificateSha256.type === 'some' ? mint.certificateSha256.value : undefined;
      console.log(`Single-use enrollment (expires ${printFor(DateTimeType)(mint.expiresAt)} UTC).\nSource origin: ${mint.apiUrl}${pin === undefined ? '' : `\nCertificate SHA-256: ${pin}`}\nMatching e3-rack release: ${mint.e3Version}\nEnrollment token: ${mint.enrollmentToken}\n\nInside the prepared worker VM, using the verified matching release:\n  sudo ${executable} configure --allocation ${allocation}${vpnHttp}\n  sudo ${executable} enroll --allocation ${allocation}${vpnHttp}\n\nFor an additional mutually trusted source on an existing worker: drain and stop its services and sockets, add --add-source to configure, then add --source '<printed-source-uuid>' to enroll. Separate client/developer trust domains require separate worker VMs.\n\nUse the host-provisioned allocation path. Enter the source origin${pin === undefined ? '' : ' and certificate SHA-256'} during configure and the token at enroll's hidden prompt; do not put them in shell arguments or plaintext files.${pin === undefined ? '' : ' The worker trusts this hub by that certificate alone; if the hub\'s certificate is ever replaced, pin the new one on every worker.'}${flags.label === undefined ? '' : '\nUse the same worker label in configure as supplied to --label.'}${vpnHttp ? '\nPlain HTTP exposes the rack token and task data to anything on the path: use it only through an SSH tunnel or another path encrypted end to end, never across a VPN hub that decrypts traffic.' : ''}\nEnrollment does not start the agent or enable task claims. Worker provisioning, service activation and capacity admission are separate steps.\n`);
      if (!flags.wait) return;
      while (Date.now() < mint.expiresAt.getTime()) {
        const status = await client.status();
        const enrolled = status.racks.find((rack) => !before.has(rack.rackId) && (flags.label === undefined || equalString(rack.label, flags.label)));
        if (enrolled !== undefined) {
          console.log(`New registration observed: ${enrolled.label} (${enrolled.rackId}). Check the worker's enrollment result; this does not confirm activation or task readiness.`);
          printFleet(lib, status); return;
        }
        await delay(Math.min(2000, Math.max(1, mint.expiresAt.getTime() - Date.now())));
      }
      throw new Error('No matching new registration observed before token expiry; inspect the worker enrollment result and e3 rack list before minting another token');
    }));

  // A repository precedes the verb for consistency with the issue's CLI:
  // `policy . set ...`. Parse this small grammar explicitly; Commander only
  // dispatches nested commands when their verb precedes positional arguments.
  rack.command('policy').description('Edit routing: [repo] show|set|unset|enable|disable|mode|defaults|reset')
    .argument('[args...]', '[repo] <action> [pattern target | mode]')
    .option('--size <size>', sizes.join('|')).option('--timeout <min>', 'Task timeout in minutes')
    .option('--allow-host-access', 'Deliberately allow host-coupled platform calls on the rack')
    .option('--spill', 'Run locally when rack capacity is full').option('--no-spill', 'Wait for rack capacity')
    .option('--claim-timeout <sec>', 'Recheck an unclaimed lease after this many seconds')
    .option('--retry-task-failures-locally', 'Rerun task failures locally').option('--no-retry-task-failures-locally', 'Return rack task failures')
    .addHelpText('after', '\nExamples:\n  e3 rack policy . set "train_*" rack --size large\n  e3 rack policy . enable\n  e3 rack policy . mode auto\n  e3 rack policy . defaults --no-spill\n  e3 rack policy . show')
    .action(guarded(async (args: string[], flags: PolicyFlags) => {
      const lib = await rackLib();
      const verbs = ['show', 'set', 'unset', 'enable', 'disable', 'mode', 'defaults', 'reset'];
      const words = [...args]; const repoArg = defaultRepoArg(words[0] !== undefined && !verbs.includes(words[0]) ? words.shift() : undefined);
      if (/^https?:\/\//.test(repoArg)) throw new Error('The rack policy belongs to a local repository');
      const repo = await openRepo(repoArg); const action = words.shift() ?? 'show';
      const arity = action === 'set' ? 2 : action === 'unset' || action === 'mode' ? 1 : 0;
      if (!verbs.includes(action) || words.length !== arity) throw new Error('Use e3 rack policy --help for policy actions and arguments');
      if (action === 'reset') {
        await unlink(lib.policyPath(repo)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
        console.log('Rack policy reset.'); return;
      }
      let policy = await lib.loadPolicy(repo);
      if (action === 'set') {
        if (words[1] !== 'rack' && words[1] !== 'local') throw new Error('Target must be rack or local');
        policy = lib.setRule(policy, words[0]!, words[1], { size: flags.size === undefined ? undefined : sizeOf(flags.size),
          timeoutMinutes: flags.timeout === undefined ? undefined : integer(flags.timeout, '--timeout'), allowHostCoupled: flags.allowHostAccess });
      } else if (action === 'unset') policy = lib.removeRule(policy, words[0]!);
      else if (action === 'enable' || action === 'disable') policy = lib.setEnabled(policy, action === 'enable');
      else if (action === 'mode') {
        if (words[0] !== 'auto' && words[0] !== 'opt-in') throw new Error('Mode must be opt-in or auto');
        policy = lib.setMode(policy, words[0] === 'auto' ? 'auto' : 'optIn');
      } else if (action === 'defaults') {
        policy = { ...policy,
          ...(flags.size === undefined ? {} : { defaultSize: variant(sizeOf(flags.size), null) }),
          ...(flags.timeout === undefined ? {} : { defaultTimeoutMinutes: BigInt(integer(flags.timeout, '--timeout')) }),
          ...(flags.claimTimeout === undefined ? {} : { claimTimeoutSeconds: BigInt(integer(flags.claimTimeout, '--claim-timeout')) }),
          ...(flags.spill === undefined ? {} : { spill: flags.spill }),
          ...(flags.retryTaskFailuresLocally === undefined ? {} : { retryTaskFailuresLocally: flags.retryTaskFailuresLocally }),
        };
      }
      if (action !== 'show') await lib.savePolicy(repo, policy);
      printPolicy(policy);
    }));
  return rack;
}
