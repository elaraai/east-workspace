/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A page's stand-in, in a worker of its own, which the specs' e3 page can
 * stop as a tab closes: it connects to an e3 served over the port it is sent
 * (`createWebE3`), holding the lifeline the e3 waits on, says so, and holds
 * the connection until it is terminated.
 *
 * The harness bundles it for Chromium; `e3.page.ts` starts it.
 *
 * @packageDocumentation
 */

import { createWebE3 } from '../bridge/page.js';

self.onmessage = (event: MessageEvent<MessagePort>) => {
  void createWebE3(event.data, { requestPersistence: false }).then(
    () => self.postMessage('connected'),
    (err: unknown) => self.postMessage(`refused: ${err instanceof Error ? err.message : String(err)}`),
  );
};
