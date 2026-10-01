/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Unit workers in the e3 worker's own thread: the in-process host, with no
 * Worker, which e3's Node test pass runs `WebTaskRunner` over.
 *
 * Each in-process worker serves units as a unit worker does
 * (`unit-server.ts`), over a `MessageChannel` rather than a worker's scope, so
 * the pool drives it with the messages and transfers it sends a Web Worker,
 * through the same structured clone.
 *
 * It shares its host's thread, so it cannot end a unit as `terminate()` ends a
 * Web Worker: a unit in a synchronous loop runs until the loop ends, whatever
 * stops it. A unit that calls or awaits a platform function is stopped there:
 * once the worker is terminated, every call of a platform function, and every
 * call still awaited, fails, and the unit's program unwinds. What its
 * packages left waiting stops with it — a sleep's timer is cleared — so
 * nothing of the unit's keeps the thread's event loop alive. Its answer is
 * never heard, since its channel is closed.
 *
 * @packageDocumentation
 */

import type { PlatformFunction } from '@elaraai/east/internal';
import type { HostMessage, UnitWorker } from './protocol.js';
import { STANDARD_PLATFORMS, UnitServer, type UnitPlatforms } from './unit-server.js';

/**
 * How {@link inProcessUnits} serves units.
 */
export interface InProcessUnitsOptions {
  /** An app's platform packages, by the name a runner lists each under:
   *  served beside the standard ones — east-node-std's and e3's own — as
   *  `serveUnits({ platforms })` serves them in a Web Worker */
  readonly platforms?: UnitPlatforms;
}

/**
 * Wraps platform functions to refuse every call once a signal has aborted,
 * and to fail every call still awaited when it does.
 *
 * @param functions - The platform functions
 * @param signal - Aborted when the unit's worker is terminated
 * @returns The functions, guarded
 */
function guarded(functions: readonly PlatformFunction[], signal: AbortSignal): PlatformFunction[] {
  const terminated = (): Error => new Error('the unit\'s worker was terminated');
  const stopped = new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(terminated()), { once: true });
  });
  // Nothing else may ever await it.
  stopped.catch(() => undefined);
  const guard = (fn: (...args: unknown[]) => unknown) => (...args: unknown[]): unknown => {
    if (signal.aborted) throw terminated();
    const answer = fn(...args);
    return answer instanceof Promise ? Promise.race([answer, stopped]) : answer;
  };
  return functions.map((platform) => {
    const fn = platform.fn as (...args: unknown[]) => unknown;
    // A generic function's `fn` makes its evaluator from its type parameters.
    const generic = platform.type_parameters !== undefined && platform.type_parameters.length > 0;
    return { ...platform, fn: generic ? (...types: unknown[]) => guard(fn(...types) as (...args: unknown[]) => unknown) : guard(fn) };
  });
}

/**
 * A unit worker in this thread: a {@link UnitServer} at one end of a
 * `MessageChannel`, the pool at the other.
 */
class InProcessUnitWorker implements UnitWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private readonly channel = new MessageChannel();
  private readonly stopped = new AbortController();

  constructor(platforms: UnitPlatforms) {
    const { port1: host, port2: worker } = this.channel;
    const server = new UnitServer(
      {
        // A terminated worker's answers are never heard.
        postMessage: (message, transfer) => {
          if (!this.stopped.signal.aborted) worker.postMessage(message, transfer);
        },
      },
      { platforms, guard: (functions) => guarded(functions, this.stopped.signal), signal: this.stopped.signal },
    );
    worker.onmessage = (event: MessageEvent<HostMessage>) => {
      void server.receive(event.data);
    };
    host.onmessage = (event: MessageEvent) => {
      this.onmessage?.(event);
    };
  }

  postMessage(message: HostMessage, transfer: Transferable[]): void {
    this.channel.port1.postMessage(message, transfer);
  }

  terminate(): void {
    if (this.stopped.signal.aborted) return;
    this.stopped.abort();
    this.channel.port1.close();
    this.channel.port2.close();
  }
}

/**
 * A factory of unit workers in this thread: what `WebTaskRunner`'s pool runs
 * units on in e3's Node test pass, as it runs them on Web Workers in a
 * browser.
 *
 * @param options - The app's platform packages, served beside the standard
 *   ones
 * @returns The factory
 *
 * @example
 * ```ts
 * const pool = new UnitPool({ units: inProcessUnits(), width: 4 });
 * const runner = new WebTaskRunner({ repo: 'default', pool, locks: storage.adapters.locks });
 * ```
 */
export function inProcessUnits(options: InProcessUnitsOptions = {}): () => UnitWorker {
  const platforms: UnitPlatforms = { ...STANDARD_PLATFORMS, ...options.platforms };
  return () => new InProcessUnitWorker(platforms);
}
