/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The e3 worker the bridge specs' page starts: it serves `e3.fetch` through
 * `serveBridge` from a dedicated worker, answering with the contract's plain
 * handler, booted as its URL's `boot` names (`persist`, `memory` or
 * `refused`). A refused boot opens a persisted storage with `FileSystemFileHandle`'s
 * `move` taken away, which `openWebStorage` refuses, naming it.
 *
 * The harness bundles it for Chromium; `bridge.page.ts` starts it.
 *
 * @packageDocumentation
 */

import { serveBridge, type BridgeEndpoint } from '../bridge/worker.js';
import { openWebStorage } from '../storage/WebStorage.js';
import { contractBoot, contractWorker } from '../testing/bridge-handler.js';

/** Takes `move` from this worker's file handles, as a browser whose OPFS
 *  cannot move a file lacks it. */
function takeMoveAway(): void {
  // The prototype that defines it: FileSystemFileHandle's in Chromium
  let owner: object | null = FileSystemFileHandle.prototype;
  while (owner !== null && !Object.prototype.hasOwnProperty.call(owner, 'move')) owner = Object.getPrototypeOf(owner) as object | null;
  if (owner === null) throw new Error('this browser\'s file handles have no move to take away');
  Reflect.deleteProperty(owner, 'move');
}

const worker = contractWorker(globalThis as unknown as BridgeEndpoint);
serveBridge(contractBoot(new URL(self.location.href).searchParams.get('boot'), worker, async () => {
  takeMoveAway();
  await (await openWebStorage({ name: `e3-web-bridge-${crypto.randomUUID()}` })).close();
}), worker.endpoint);
