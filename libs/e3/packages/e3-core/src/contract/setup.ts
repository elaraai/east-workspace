/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { TestContext } from 'node:test';
import type { StorageBackend } from '../storage/interfaces.js';

/**
 * A backend under test, and a repository in it.
 */
export interface BackendContext {
  /** The backend under test */
  readonly storage: StorageBackend;
  /** A repository the backend created, as it creates one, by the identifier
   *  its stores take */
  readonly repo: string;
}

/**
 * Makes a fresh backend and a repository in it for one test, and registers
 * their cleanup with `t.after`.
 *
 * @remarks
 * A contract suite calls it once per test, so no test sees another's state.
 * e3-core runs each suite over its local and in-memory backends, and another
 * backend runs it over its own by giving its own setup.
 */
export type BackendSetup = (t: TestContext) => Promise<BackendContext>;
