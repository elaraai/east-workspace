/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The showcase's e3 worker (#849): e3 itself — its storage, its orchestrator,
 * its runner and its API — which `showcase-e3.ts` starts the first time an e3
 * example renders. Its repositories are kept in memory, so each page load
 * starts from the showcase's package afresh, and its unit workers run
 * `unit.worker.ts`.
 *
 * @packageDocumentation
 */

import { serveE3 } from "@elaraai/e3-web/worker";

serveE3({
    units: () => new Worker(new URL("./unit.worker.ts", import.meta.url), { type: "module" }),
    persist: false,
});
