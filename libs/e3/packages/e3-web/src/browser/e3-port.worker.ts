/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * An e3 worker the specs' e3 page starts to serve e3 over a `MessagePort`:
 * `serveE3(options, port)`, over persisted repositories of the name its page
 * sends with the port, its unit workers running `e3-unit.worker.ts`. A
 * browser's port says nothing as it closes, so the e3 learns its page has
 * gone from the page's `close`, or from the lifeline the page holds.
 *
 * The harness bundles it for Chromium; `e3.page.ts` starts it.
 *
 * @packageDocumentation
 */

import { serveE3 } from '../worker.js';

/** What the page sends: the port to serve over, and the storage's name. */
interface Served {
  readonly port: MessagePort;
  readonly name: string;
}

self.onmessage = (event: MessageEvent<Served>) => {
  const { port, name } = event.data;
  serveE3({ units: () => new Worker('/e3-unit-worker.js?hold=0', { type: 'module' }), name }, port);
};
