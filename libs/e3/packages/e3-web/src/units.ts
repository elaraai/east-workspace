/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The unit worker: where e3 runs East programs in a browser.
 *
 * An app's unit worker script calls {@link serveUnits}, and the e3 worker
 * starts as many of them as its pool is wide. Each runs the units it is sent
 * with east's `executeUnit` — the code east-node's `exec` runs — over the
 * unit's files in memory. east-node-std's platform functions are answered by
 * east-web-std's, so a task written for east-node runs unchanged; e3's own
 * (`@elaraai/e3-api-client`'s `Platform`) reach the e3 worker that started the
 * unit worker; and an app adds its own packages.
 *
 * This entry (`@elaraai/e3-web/units`) reaches nothing of Node, and nothing of
 * the e3 worker's storage, so a unit worker bundles little more than East and
 * e3's client.
 *
 * @example
 * ```ts
 * // unit.worker.ts
 * import { serveUnits } from '@elaraai/e3-web/units';
 * serveUnits();
 * ```
 *
 * @packageDocumentation
 */

import { holdLifeline } from './bridge/protocol.js';
import { STANDARD_PLATFORMS, UnitServer, type UnitPlatforms } from './execution/unit-server.js';
import type { HostMessage, WorkerMessage } from './execution/protocol.js';

export {
  EAST_NODE_STD,
  STANDARD_PLATFORMS,
  type UnitPlatformContext,
  type UnitPlatformPackage,
  type UnitPlatforms,
} from './execution/unit-server.js';
export { E3_PLATFORM } from './execution/e3-platform.js';

/**
 * How {@link serveUnits} serves units.
 */
export interface ServeUnitsOptions {
  /**
   * An app's platform packages, by the name a runner lists each under in a
   * unit: its platform functions, or what makes them for each unit from the
   * unit's console and the port of its host's services. Served beside the
   * standard ones ({@link STANDARD_PLATFORMS}): east-node-std's, which
   * east-web-std answers, and e3's own; a package of one of their names here
   * is served instead.
   */
  readonly platforms?: UnitPlatforms;
}

/** A dedicated worker's global scope, as a unit worker uses it. */
interface WorkerScope {
  postMessage(message: WorkerMessage, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<HostMessage>) => void) | null;
}

/**
 * Serves units in this dedicated Web Worker: what an app's unit worker script
 * calls, once, for the e3 worker to run East programs on it.
 *
 * @remarks
 * Each unit the e3 worker sends is run with east's `executeUnit` over its
 * files in memory, its inputs staged whole: what its console writes goes to
 * the execution's logs as it writes it. The worker holds a Web Lock while it
 * lives, which its pool waits on: a worker that closes itself fails the unit
 * it was running, and its place goes to another. A unit that calls e3's own platform
 * functions reaches the e3 worker that started this one, over the port it
 * handed it, and the e3 worker answers with its own API. A unit that lists a
 * platform package this worker does not serve fails, naming the package; one
 * that calls a platform function its packages do not provide — east-web-std
 * has no FileSystem, Env or large-JSON reader — fails, naming the function.
 *
 * @param options - The app's platform packages, by name
 * @throws {Error} When it is not called in a dedicated Web Worker.
 *
 * @example
 * ```ts
 * // unit.worker.ts — an app's own platform package beside the standard one
 * import { serveUnits } from '@elaraai/e3-web/units';
 * import { PricingPlatform } from './pricing-platform.js';
 *
 * serveUnits({ platforms: { '@acme/pricing': PricingPlatform } });
 * ```
 */
export function serveUnits(options: ServeUnitsOptions = {}): void {
  const DedicatedWorkerScope = (globalThis as Record<string, unknown>).DedicatedWorkerGlobalScope as (abstract new () => unknown) | undefined;
  if (DedicatedWorkerScope === undefined || !(globalThis instanceof DedicatedWorkerScope)) {
    throw new Error('serveUnits serves units in a dedicated Web Worker: call it in the unit worker script the e3 worker starts');
  }
  const scope = globalThis as unknown as WorkerScope;
  // Held while the worker lives: the browser frees it once the worker stops.
  const lifeline = holdLifeline('e3-web:unit', new Promise<void>(() => undefined));
  const server = new UnitServer(
    { postMessage: (message, transfer) => scope.postMessage(message, transfer) },
    { platforms: { ...STANDARD_PLATFORMS, ...options.platforms }, lifeline: () => lifeline },
  );
  scope.onmessage = (event) => {
    void server.receive(event.data);
  };
}
