/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ensureRackHome, rackHome, HUB_LOG_FILE } from '../paths.js';
import { HubClient } from './hub-client.js';
import { negotiateHub } from './hub-negotiation.js';

export { RackHubOutdatedError, RackHubUnavailableError } from './hub-negotiation.js';

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
  /** Ends the wait for the hub when the caller's run is aborted. */
  signal?: AbortSignal;
}

/**
 * Spawns a detached hub through this package's published entry point.
 * Several callers may spawn concurrently; the hub lock elects one winner,
 * and each other one exits once it has lost.
 * @param home - Private state home and log destination
 * @returns After the child was spawned, its pid written to the log — every process holding the home's log as its
 *   output, the losers of an election too, so named before this returns — and its inherited log descriptor closed
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
    await file.write(`${new Date().toISOString()} rack hub spawned (pid ${child.pid}) by pid ${process.pid}\n`);
  } finally { await file.close(); }
}

/**
 * Finds or starts the shared hub and negotiates its exact control protocol.
 *
 * @remarks
 * This wire has no cross-protocol decoder. A newer protocol is refused too,
 * without draining it. An older hub is asked to drain and the caller runs
 * locally this time: one whose hello names a lower protocol, and one whose
 * hello is in the envelope replies had before they lost it, a hub from
 * before the hello's type was fixed. A hello that does not read for another
 * cause, cut short or of a hub this e3 does not know, drains nothing: it is
 * asked again until the deadline, and then the hub is unavailable. An ask the
 * hub does not answer within a second is asked again until the deadline too,
 * whether no reply began or one began and did not end: one slow answer is no
 * reason to run without a hub that is there. One cut short by the deadline
 * says nothing new of the hub, so what it last said of itself stands; one
 * given its whole second and not answered is a hub that has stopped
 * answering, which the error then says beside what it last said.
 * A dead hub is never silently reattached mid-session.
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
  const client = new HubClient(home);
  await negotiateHub(client, { deadline: Date.now() + timeout, logFile: join(home, HUB_LOG_FILE), log: options.log, signal: options.signal,
    ...(options.spawn !== false && { spawn: () => spawnHub(home) }) });
  return client;
}
