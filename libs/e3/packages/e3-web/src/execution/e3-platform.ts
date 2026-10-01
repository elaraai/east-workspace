/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3's own platform functions in a unit worker: e3-api-client's `Platform`,
 * bound to a fetch into the e3 worker that started the unit worker, so an
 * East program that calls `Platform.workspaceList` lists the workspaces of the
 * e3 in its page, and nothing it calls reaches the network.
 *
 * @packageDocumentation
 */

import type { PlatformFunction } from '@elaraai/east/internal';
import { Platform } from '@elaraai/e3-api-client';
import { connectWebE3, type WebE3 } from '../bridge/page.js';
import type { UnitPlatformContext } from './unit-server.js';

/**
 * The name a runner lists e3's platform functions under: the package whose
 * `Platform` they are. A task lists it as a custom platform package:
 * `platforms: ['@elaraai/east-node-std', { custom: '@elaraai/e3-api-client' }]`.
 */
export const E3_PLATFORM = '@elaraai/e3-api-client';

/** Each unit worker's connection to its e3 worker, by the port it was
 *  handed: its units share it. */
const connections = new WeakMap<MessagePort, Promise<WebE3>>();

/**
 * e3's platform functions for a unit, bound to the e3 worker that started its
 * unit worker.
 *
 * @remarks
 * Every request they make goes through `e3.fetch` over the port the e3 worker
 * handed the unit worker as it started it, and the e3 worker answers it with
 * its own app: the URL a program passes is `https://e3-web.invalid`, the
 * in-page e3's `apiUrl`, and one on any other origin is refused rather than
 * fetched. The token a program passes is sent as the request's bearer token,
 * as it is sent to a server. A unit worker connects once, at the first unit
 * that lists the package, and its units share the connection.
 *
 * @param context - The unit's context: the port of the e3 worker's services
 * @returns The platform functions
 * @throws {Error} When the unit worker was handed no port — its host is not an
 *   e3 worker's pool — or the e3 worker does not answer on it: the unit fails,
 *   naming why.
 */
export async function e3Platform(context: UnitPlatformContext): Promise<readonly PlatformFunction[]> {
  const { port } = context;
  if (port === null) {
    throw new Error(
      `e3's platform functions (${E3_PLATFORM}) answer through the e3 worker that started this unit worker, and it handed none: ` +
      'unit workers that run them are started by serveE3 from @elaraai/e3-web/worker',
    );
  }
  let connection = connections.get(port);
  if (connection === undefined) {
    // A unit worker cannot ask the browser to keep the storage: only a page
    // can, and the e3 worker's page has asked. It holds no lifeline: the pool
    // that started it ends the e3 worker's side as it lets it go.
    connection = connectWebE3(port, { requestPersistence: false, lifeline: false });
    connections.set(port, connection);
  }
  const e3 = await connection;
  return Platform.implementation({ fetch: e3.fetch });
}
