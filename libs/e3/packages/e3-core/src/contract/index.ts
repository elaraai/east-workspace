/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The contract suites every storage backend runs: each registers its cases
 * over a backend its caller sets up. e3-core runs them over its local and
 * in-memory backends; another backend runs them over its own.
 */

export type { BackendContext, BackendSetup } from './setup.js';
export { gcTests } from './gc.js';
export { repositoryRecordTests } from './repository-record.js';
export { workspaceStatusTests } from './workspace-status.js';
