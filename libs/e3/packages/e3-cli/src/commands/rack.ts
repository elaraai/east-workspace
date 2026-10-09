/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { hostname } from 'node:os';
import { unlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Command } from 'commander';
import { DateTimeType, none, printFor, some, variant } from '@elaraai/east';
import { E3_RACK_VERSION, HubClient, RackHubUnavailableError, agentVersionAtLeast, bundledE3Version, connectHub,
  loadPolicy, policyPath, readHubLock, removeRule, savePolicy, setEnabled, setMode, setRule,
  type HubConfig, type RackComputeSize, type RackPolicy } from '@elaraai/e3-rack';
import { runHub } from '@elaraai/e3-rack/hub-main';
import { defaultRepoArg, openRepo, formatError, exitError } from '../utils.js';

type Status = Awaited<ReturnType<HubClient['status']>>;
interface ConfigFlags { listen?: string | boolean; allow?: string | boolean; idleExit?: string; advertiseUrl?: string }
interface PolicyFlags { size?: string; timeout?: string; allowHostAccess?: boolean; spill?: boolean; claimTimeout?: string; retryTaskFailuresLocally?: boolean }
const sizes = ['serverless', 'small', 'medium', 'large', 'xlarge'] as const;
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
function instanceName(): string {
  let name = hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!/^[a-z]/.test(name)) name = `host-${name}`;
  return name.slice(0, 24).replace(/-+$/, '') || 'local';
}

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
  return Object.values(flags).some((value) => value !== undefined) ? client.setConfig(config) : config;
}

function printFleet(status: Status): void {
  if (status.racks.length === 0) { console.log('No enrolled racks. Run: e3 rack enroll --listen <vpn-ip>:7331'); return; }
  console.log('LABEL  ID  RUNTIMES  BUSY/CAPACITY  AGENT  E3  LAST SEEN  STATE');
  for (const rack of status.racks) {
    const capacity = status.capacity.racks.find((entry) => entry.rackId === rack.rackId);
    const bundled = bundledE3Version(rack.agentVersion);
    const state = capacity?.pendingApproval ? 'pending-approval' : !capacity?.healthy ? 'stale'
      : bundled === null ? 'incompatible: bundled e3 unknown'
        : !agentVersionAtLeast(bundled, E3_RACK_VERSION) ? `incompatible: agent e3 ${bundled} < project e3 ${E3_RACK_VERSION}` : 'ready';
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
    const client = new HubClient();
    let status: Status;
    try { status = await client.status(); } catch (error) {
      try { await connectHub({ spawn: false, timeoutMs: 1000 }); } catch (connectError) {
        if (connectError instanceof RackHubUnavailableError) { console.log('no rack hub running'); return; }
        throw connectError;
      }
      throw error;
    }
    const lock = await readHubLock(); const config = await client.getConfig();
    console.log(`Hub: pid ${Number(status.hello.pid)}, e3 ${status.hello.version}, protocol ${Number(status.hello.protocol)}, uptime ${lock === null ? '?' : Math.round((Date.now() - lock.startedAt.getTime()) / 1000)}s, idle-exit ${Number(config.idleExitMinutes)} min`);
    console.log(`Listener: ${status.rackListener.type === 'up' ? `up ${status.rackListener.value.origin}` : status.rackListener.type === 'down' ? `down ${status.rackListener.value.reason}` : 'off — run e3 rack config --listen <vpn-ip>:7331'}`);
    printFleet(status);
    console.log(`Sessions: ${status.sessions.length}`);
    for (const session of status.sessions) console.log(`  ${session.label}  ${session.repoAlias}  ${session.workspace}  ${Number(session.pending)} pending / ${Number(session.claimed)} claimed  e3 ${session.e3Version}`);
    console.log(`Queue: ${Number(status.capacity.queued)} pending`);
  }));
  rack.command('list').description('List enrolled racks and compatible capacity').action(guarded(async () => printFleet(await (await connectHub()).status())));
  rack.command('remove').argument('<rackId|label>').description('Revoke a rack; its active work falls back locally').action(guarded(async (name: string) => {
    const client = await connectHub(); const status = await client.status();
    const exact = status.racks.find((rack) => rack.rackId === name);
    const matches = exact === undefined ? status.racks.filter((rack) => rack.label === name || rack.rackId.startsWith(name)) : [exact];
    if (matches.length !== 1) throw new Error(matches.length === 0 ? `No rack '${name}'` : `Ambiguous rack '${name}': ${matches.map((rack) => rack.rackId).join(', ')}`);
    await client.removeRack(matches[0]!.rackId);
    console.log(`Removed ${matches[0]!.label}; its active leases fall back locally.`);
  }));
  rack.command('stop').description('Stop the shared hub and cancel its leases').action(guarded(async () => {
    // Stop is the remedy for a control-protocol mismatch. Its stable empty
    // request must remain usable without negotiating a compatible session.
    const client = new HubClient();
    try { await client.stop(); } catch (error) {
      if (error instanceof Error && 'code' in error && ['ENOENT', 'ECONNREFUSED'].includes(String(error.code))) {
        console.log('no rack hub running'); return;
      }
      throw error;
    }
    // A stop reply precedes listener shutdown. Wait until the owned process
    // has removed its lock so an immediate status sees the completed stop.
    for (let n = 0; n < 250 && await readHubLock() !== null; n++) await delay(20);
    if (await readHubLock() !== null) throw new Error('Rack hub is still stopping; inspect e3 rack status');
    console.log('rack hub stopped');
  }));
  rack.command('hub').description('Run the shared hub in the foreground').option('--idle-exit <min>', 'Exit after this many idle minutes; 0 disables idle exit')
    .action(guarded((flags: ConfigFlags) => runHub(['--foreground', ...(flags.idleExit === undefined ? [] : ['--idle-exit', flags.idleExit])])));
  rack.command('config').description('Show or update the shared hub configuration')
    .option('--listen <host:port>', 'Bind the rack listener on a VPN/LAN address').option('--no-listen', 'Disable the rack listener')
    .option('--allow <ip,...>', 'Restrict rack requests to these IP addresses').option('--no-allow', 'Remove the IP restriction')
    .option('--idle-exit <min>', 'Idle lifetime; 0 disables idle exit').option('--advertise-url <url>', 'Reachable HTTP(S) origin for storage URLs')
    .action(guarded(async (flags: ConfigFlags) => {
      const config = await configured(await connectHub(), flags);
      console.log(`Listen: ${config.listen.type === 'some' ? `${config.listen.value.host}:${Number(config.listen.value.port)}` : 'off'}`);
      console.log(`Allow: ${config.allow.join(', ') || 'all'}\nIdle-exit: ${Number(config.idleExitMinutes)} min\nAdvertise URL: ${config.advertiseUrl.type === 'some' ? config.advertiseUrl.value : 'listener origin'}`);
    }));
  rack.command('enroll').description('Print an install command enrolling a separate rack-agent instance against this machine')
    .option('--label <label>', 'Rack label').option('--listen <host:port>', 'VPN/LAN listener address')
    .option('--allow <ip,...>', 'Allowed rack IP addresses').option('--instance <name>', 'Separate rack-agent instance (default: this hostname)')
    .option('--tiers <list>', 'Stock runtime images', 'node,py').option('--ttl <min>', 'Single-use enrollment lifetime', '15')
    .option('--max-vms <n>', 'Concurrent VMs for this instance (not a CPU/memory reservation)', '2')
    .option('--gpus <selection>', 'GPU selection for this instance', 'none').option('--no-wait', 'Print the command and return')
    .action(guarded(async (flags: ConfigFlags & { label?: string; instance?: string; tiers: string; ttl: string; wait: boolean; maxVms: string; gpus: string }) => {
      const instance = flags.instance ?? instanceName();
      if (!/^[a-z][a-z0-9-]{0,23}$/.test(instance)) throw new Error('--instance must start with a lowercase letter and use up to 24 lowercase letters, digits or hyphens');
      const tiers = flags.tiers.split(',');
      if (tiers.length === 0 || tiers.some((tier) => !['node', 'py', 'py-datascience', 'c', 'full'].includes(tier))) throw new Error('Unknown --tiers runtime');
      const maxVms = integer(flags.maxVms, '--max-vms');
      const client = await connectHub({ log: console.log });
      const config = await configured(client, flags);
      if (config.listen.type === 'none') throw new Error('Configure a reachable address: e3 rack enroll --listen <vpn-ip>:7331');
      const before = new Set((await client.status()).racks.map((rack) => rack.rackId));
      const mint = await client.enroll({ label: flags.label === undefined ? none : some(flags.label), ttlMinutes: some(BigInt(integer(flags.ttl, '--ttl', 1, 1440))) });
      const args = ['--instance', instance, '--api-url', mint.apiUrl, '--token', mint.enrollmentToken, '--e3-version', mint.e3Version,
        '--tiers', flags.tiers, '--max-vms', String(maxVms), '--gpus', flags.gpus, ...(flags.label === undefined ? [] : ['--label', flags.label])];
      console.log(`Enrollment token for this machine (single use, expires ${printFor(DateTimeType)(mint.expiresAt)}).\nOn the rack host run:\n\n  sudo ./e3-rack install ${args.map(shellArg).join(' ')}\n`);
      if (!flags.wait) return;
      while (Date.now() < mint.expiresAt.getTime()) {
        const status = await client.status();
        const enrolled = status.racks.find((rack) => !before.has(rack.rackId) && rack.healthy && rack.lastBootId.type === 'some' && (flags.label === undefined || rack.label === flags.label));
        if (enrolled !== undefined) { console.log(`✓ ${enrolled.label} enrolled — runtimes ${enrolled.tiers.join(',')} · ${Number(enrolled.capacity)} slots · agent ${enrolled.agentVersion}`); printFleet(status); return; }
        await delay(Math.min(2000, Math.max(1, mint.expiresAt.getTime() - Date.now())));
      }
      throw new Error('Enrollment token expired; run e3 rack enroll again');
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
      const verbs = ['show', 'set', 'unset', 'enable', 'disable', 'mode', 'defaults', 'reset'];
      const words = [...args]; const repoArg = defaultRepoArg(words[0] !== undefined && !verbs.includes(words[0]) ? words.shift() : undefined);
      if (/^https?:\/\//.test(repoArg)) throw new Error('The rack policy belongs to a local repository');
      const repo = await openRepo(repoArg); const action = words.shift() ?? 'show';
      const arity = action === 'set' ? 2 : action === 'unset' || action === 'mode' ? 1 : 0;
      if (!verbs.includes(action) || words.length !== arity) throw new Error('Use e3 rack policy --help for policy actions and arguments');
      if (action === 'reset') {
        await unlink(policyPath(repo)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
        console.log('Rack policy reset.'); return;
      }
      let policy = await loadPolicy(repo);
      if (action === 'set') {
        if (words[1] !== 'rack' && words[1] !== 'local') throw new Error('Target must be rack or local');
        policy = setRule(policy, words[0]!, words[1], { size: flags.size === undefined ? undefined : sizeOf(flags.size),
          timeoutMinutes: flags.timeout === undefined ? undefined : integer(flags.timeout, '--timeout'), allowHostCoupled: flags.allowHostAccess });
      } else if (action === 'unset') policy = removeRule(policy, words[0]!);
      else if (action === 'enable' || action === 'disable') policy = setEnabled(policy, action === 'enable');
      else if (action === 'mode') {
        if (words[0] !== 'auto' && words[0] !== 'opt-in') throw new Error('Mode must be opt-in or auto');
        policy = setMode(policy, words[0] === 'auto' ? 'auto' : 'optIn');
      } else if (action === 'defaults') {
        policy = { ...policy,
          ...(flags.size === undefined ? {} : { defaultSize: variant(sizeOf(flags.size), null) }),
          ...(flags.timeout === undefined ? {} : { defaultTimeoutMinutes: BigInt(integer(flags.timeout, '--timeout')) }),
          ...(flags.claimTimeout === undefined ? {} : { claimTimeoutSeconds: BigInt(integer(flags.claimTimeout, '--claim-timeout')) }),
          ...(flags.spill === undefined ? {} : { spill: flags.spill }),
          ...(flags.retryTaskFailuresLocally === undefined ? {} : { retryTaskFailuresLocally: flags.retryTaskFailuresLocally }),
        };
      }
      if (action !== 'show') await savePolicy(repo, policy);
      printPolicy(policy);
    }));
  return rack;
}
