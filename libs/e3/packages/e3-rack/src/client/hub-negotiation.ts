/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { IntegerType, compareFor, printFor } from '@elaraai/east';
import { HUB_PROTOCOL } from '../version.js';
import type { HubClient } from './hub-client.js';
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

/** What negotiating asks of a hub: its hello, and that it drain. */
export type HubAsks = Pick<HubClient, 'hello' | 'answersInEnvelope' | 'drain' | 'drainUnread'>;

/**
 * How long a hub is given to answer one ask, in ms. The last asks of a
 * negotiation are given what is left of its deadline, which is less.
 */
export const HUB_ASK_MS = 1000;

/** What a negotiation is given beside the hub it asks. */
export interface HubNegotiation {
  /** When the hub is given up on, by `Date.now()` */
  deadline: number;
  /** Where the hub's log is, which an unavailable hub's error names */
  logFile: string;
  /** Starts a hub where none answers, once; absent, none is started */
  spawn?: () => Promise<void>;
  /** Emits progress lines such as "starting rack hub…" */
  log?: (line: string) => void;
  /** Ends the wait for the hub when the caller's run is aborted */
  signal?: AbortSignal;
}

/**
 * Asks a hub until it answers that it is ready and speaks this e3's control
 * protocol, starting one where none answers: all of `connectHub` but the
 * client it returns, over whatever answers the asks.
 *
 * @remarks
 * This wire has no cross-protocol decoder. A newer protocol is refused too,
 * without draining it. An older hub is asked to drain and the caller runs
 * locally this time: one whose hello names a lower protocol, and one whose
 * hello is in the envelope replies had before they lost it, a hub from
 * before the hello's type was fixed. A hello that does not read for another
 * cause, cut short or of a hub this e3 does not know, drains nothing: it is
 * asked again until the deadline, and then the hub is unavailable. An ask the
 * hub does not answer in time is asked again until the deadline too, whether
 * no reply began or one began and did not end: one slow answer is no reason to
 * run without a hub that is there. One cut short by the deadline says nothing
 * new of the hub, so what it last said of itself stands; one given its whole
 * time ({@link HUB_ASK_MS}) and not answered is a hub that has stopped
 * answering, which the error then says beside what it last said.
 *
 * @param asks - The hub's answers: a `HubClient`'s
 * @param options - The deadline, the hub's log, and how a hub is started
 * @returns Once the hub is ready
 * @throws {RackHubOutdatedError} On an incompatible control protocol
 * @throws {RackHubUnavailableError} On startup, connection or drain timeout
 * @example
 * const client = new HubClient(home);
 * await negotiateHub(client, { deadline: Date.now() + 10_000, logFile: join(home, HUB_LOG_FILE), spawn: () => spawnHub(home) });
 */
export async function negotiateHub(asks: HubAsks, options: HubNegotiation): Promise<void> {
  const { deadline } = options;
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
      if (!hello.draining) return;
      if (options.spawn === undefined) throw new RackHubUnavailableError('The running rack hub is draining');
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
        if (options.spawn === undefined) break;
        if (!spawned) {
          options.log?.('starting rack hub…');
          try { await options.spawn(); } catch (error) { last = error instanceof Error ? error.message : String(error); break; }
          spawned = true;
        }
      }
    }
    await delay(Math.max(1, Math.min(100, deadline - Date.now())), undefined, { signal: options.signal }).catch(() => {});
  }
  throw new RackHubUnavailableError(`Rack hub unavailable: ${last}. See ${options.logFile}`);
}
