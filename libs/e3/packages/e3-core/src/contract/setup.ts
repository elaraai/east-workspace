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
  /**
   * Leaves what the backend holds in bytes that do not read, as a crash, a
   * failing disk or a hand edit leaves them: what the cases of a record that
   * does not decode need. A backend whose records can be left so gives it,
   * since those cases are what hold it to answering such a record with
   * `ExecutionCorruptError`. One that cannot omits it, and they are skipped.
   */
  readonly damage?: BackendDamage;
}

/**
 * The records a {@link BackendContext} can leave in bytes that do not decode.
 */
export interface BackendDamage {
  /**
   * Leaves an execution attempt's record there, in bytes that do not decode
   * as one.
   *
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - The attempt's id, a UUIDv7
   */
  execution(taskHash: string, inputsHash: string, executionId: string): Promise<void>;
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
