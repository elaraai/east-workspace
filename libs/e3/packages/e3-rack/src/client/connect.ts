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
  /** Ends the wait for the hub when the caller's run is aborted. */
  signal?: AbortSignal;
  /** Asks the hub in place of the home's own client (injectable for tests). */
  asks?: HubAsks;
}

/** What connecting asks of a hub: its hello, and that it drain. */
export type HubAsks = Pick<HubClient, 'hello' | 'answersInEnvelope' | 'drain' | 'drainUnread'>;

/**
 * How long a hub is given to answer one ask, in ms. The last asks of a
 * connection are given what is left of its deadline, which is less.
 */
export const HUB_ASK_MS = 1000;

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
 * hub does not answer in time is asked again until the deadline too: one slow
 * answer is no reason to run without a hub that is there. One cut short by the
 * deadline says nothing new of the hub, so what it last said of itself stands;
 * one given its whole time ({@link HUB_ASK_MS}) and not answered is a hub that
 * has stopped answering, which the error then says beside what it last said.
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
  const deadline = Date.now() + timeout;
  const client = new HubClient(home);
  const asks = options.asks ?? client;
  let spawned = false;
  let last = 'hub did not answer';
  // What the hub's last answer said of it: that it is draining, or that its
  // hello does not read
  let said: string | undefined;
  // Whether an ask given its whole time has gone unanswered since that answer
  let silent = false;
  while (Date.now() < deadline) {
    if (options.signal?.aborted === true) throw new RackHubUnavailableError('Rack hub connection was abandoned: the run was aborted');
    const given = Math.max(1, Math.min(HUB_ASK_MS, deadline - Date.now()));
    try {
      const hello = await asks.hello(given);
      silent = false;
      const order = compareFor(IntegerType)(hello.protocol, BigInt(HUB_PROTOCOL));
      if (order !== 0) {
        if (order < 0) await asks.drain();
        throw new RackHubOutdatedError(`The running rack hub (e3 ${hello.version}, protocol ${printFor(IntegerType)(hello.protocol)}) is ${order < 0 ? 'older' : 'newer'} than this e3 (protocol ${HUB_PROTOCOL}). ` +
          (order < 0 ? 'It will exit once idle — run `e3 rack stop` to replace it now.' : 'Use a matching e3 release or stop the hub before replacing it.'));
      }
      if (!hello.draining) return client;
      if (options.spawn === false) throw new RackHubUnavailableError('The running rack hub is draining');
      last = said = 'the running rack hub is draining';
      spawned = false;
    } catch (err) {
      if (err instanceof RackHubOutdatedError || err instanceof RackHubUnavailableError) throw err;
      // A hello in the envelope replies had is a hub from before they lost
      // it, started by an e3 of another release: older than this one,
      // whatever its protocol's number says. Any other that does not read is
      // asked again, and no hub is drained for it.
      if (err instanceof RackHubError && err.code === 'undecodable') {
        silent = false;
        if (await asks.answersInEnvelope(Math.max(1, Math.min(HUB_ASK_MS, deadline - Date.now()))).catch(() => false)) {
          await asks.drainUnread().catch(() => {});
          throw new RackHubOutdatedError(`The running rack hub was started by an e3 from before control protocol ${HUB_PROTOCOL}, and this e3 cannot read its replies. ` +
            'It will exit once idle — run `e3 rack stop` with that e3, or end its process, to replace it now.');
        }
        last = said = `the running rack hub's hello does not read as this e3's (${err.message}); it was not asked to drain`;
        await delay(Math.max(1, Math.min(100, deadline - Date.now())), undefined, { signal: options.signal }).catch(() => {});
        continue;
      }
      if (err instanceof RackHubError && err.code === 'timeout') {
        // The hub is there, and did not answer in time: it is asked again
        // until the deadline. An ask cut short by the deadline says nothing
        // new of it, and what it last said stands. One given its whole time
        // is a hub that has stopped answering, said beside what it last said.
        if (given >= HUB_ASK_MS) silent = true;
        last = said === undefined ? err.message : silent ? `${said}; it has not answered since` : said;
      } else {
        last = err instanceof Error ? err.message : String(err);
        const absent = err instanceof RackHubError && ['ENOENT', 'ECONNREFUSED', 'EPIPE', 'ECONNRESET'].includes(err.code);
        if (!absent) break;
        // It has gone: what it said is of no hub that is there
        said = undefined;
        silent = false;
        if (options.spawn === false) break;
        if (!spawned) {
          options.log?.('starting rack hub…');
          try { await spawnHub(home); } catch (error) { last = error instanceof Error ? error.message : String(error); break; }
          spawned = true;
        }
      }
    }
    await delay(Math.max(1, Math.min(100, deadline - Date.now())), undefined, { signal: options.signal }).catch(() => {});
  }
  throw new RackHubUnavailableError(`Rack hub unavailable: ${last}. See ${join(home, HUB_LOG_FILE)}`);
}
