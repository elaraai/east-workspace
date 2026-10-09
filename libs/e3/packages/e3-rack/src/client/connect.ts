/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { IntegerType, compareFor, printFor } from '@elaraai/east';
import { ensureRackHome, rackHome, HUB_LOG_FILE } from '../paths.js';
import { HUB_PROTOCOL } from '../version.js';
import { HubClient } from './hub-client.js';
import { RackHubError } from './local-http.js';

/** Reports a running hub whose protocol cannot serve this e3 release. */
export class RackHubOutdatedError extends RackHubError {
  /** @param message - The mismatch and how to replace the hub */
  constructor(message: string) { super('protocol_mismatch', message); this.name = 'RackHubOutdatedError'; }
}
/** Reports unavailable rack service; a task runner may safely run locally. */
export class RackHubUnavailableError extends RackHubError {
  /** @param message - Transport failure and diagnostic log path */
  constructor(message: string) { super('unavailable', message); this.name = 'RackHubUnavailableError'; }
}

/** Configures discovery and automatic background startup. */
export interface ConnectHubOptions {
  /** Starts a missing hub; defaults to true. */
  spawn?: boolean;
  /** Absolute startup deadline in milliseconds; defaults to ten seconds. */
  timeoutMs?: number;
  /** Emits progress lines such as "starting rack hub…". */
  log?: (line: string) => void;
  /** Uses a specific private home, useful for isolated hosts/tests. */
  home?: string;
}

/**
 * Spawns a detached hub through this package's published entry point.
 * Several callers may spawn concurrently; the hub lock elects one winner.
 * @param home - Private state home and log destination
 * @returns After the child was spawned and its inherited log descriptor closed
 */
export async function spawnHub(home = rackHome()): Promise<void> {
  ensureRackHome(home);
  const file = await open(join(home, HUB_LOG_FILE), 'a', 0o600);
  try {
    const main = createRequire(import.meta.url).resolve('@elaraai/e3-rack/hub-main');
    const child = spawn(process.execPath, [main, '--background'], { detached: true, windowsHide: true,
      stdio: ['ignore', file.fd, file.fd], env: { ...process.env, E3_RACK_HOME: home } });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } finally { await file.close(); }
}

/**
 * Finds or starts the shared hub and negotiates its exact control protocol.
 *
 * @remarks
 * This wire has no cross-protocol decoder. A newer protocol is refused too,
 * without draining it. An older hub is asked to drain and the caller runs
 * locally this time. A dead hub is never silently reattached mid-session.
 * @param options - Startup policy, deadline and progress sink
 * @returns A ready typed client
 * @throws {RackHubOutdatedError} On an incompatible control protocol
 * @throws {RackHubUnavailableError} On startup, connection or drain timeout
 * @example
 * const hub = await connectHub({ log: console.log });
 */
export async function connectHub(options: ConnectHubOptions = {}): Promise<HubClient> {
  const home = ensureRackHome(options.home ?? rackHome());
  const timeout = options.timeoutMs ?? 10000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError('Rack hub timeout must be positive');
  const deadline = Date.now() + timeout;
  const client = new HubClient(home);
  let spawned = false;
  let last = 'hub did not answer';
  while (Date.now() < deadline) {
    try {
      const hello = await client.hello(Math.max(1, Math.min(1000, deadline - Date.now())));
      const order = compareFor(IntegerType)(hello.protocol, BigInt(HUB_PROTOCOL));
      if (order !== 0) {
        if (order < 0) await client.drain();
        throw new RackHubOutdatedError(`The running rack hub (e3 ${hello.version}, protocol ${printFor(IntegerType)(hello.protocol)}) is ${order < 0 ? 'older' : 'newer'} than this e3 (protocol ${HUB_PROTOCOL}). ` +
          (order < 0 ? 'It will exit once idle — run `e3 rack stop` to replace it now.' : 'Use a matching e3 release or stop the hub before replacing it.'));
      }
      if (!hello.draining) return client;
      if (options.spawn === false) throw new RackHubUnavailableError('The running rack hub is draining');
      last = 'the running rack hub is draining';
      spawned = false;
    } catch (err) {
      if (err instanceof RackHubOutdatedError || err instanceof RackHubUnavailableError) throw err;
      last = err instanceof Error ? err.message : String(err);
      const absent = err instanceof RackHubError && ['ENOENT', 'ECONNREFUSED', 'EPIPE', 'ECONNRESET'].includes(err.code);
      if (!absent) break;
      if (options.spawn === false) break;
      if (!spawned) {
        options.log?.('starting rack hub…');
        try { await spawnHub(home); } catch (error) { last = error instanceof Error ? error.message : String(error); break; }
        spawned = true;
      }
    }
    await delay(Math.max(1, Math.min(100, deadline - Date.now())));
  }
  throw new RackHubUnavailableError(`Rack hub unavailable: ${last}. See ${join(home, HUB_LOG_FILE)}`);
}
