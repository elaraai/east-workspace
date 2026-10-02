/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { TestContext } from 'node:test';
import type { ExecutionStateStore } from '../dataflow/state-store/interfaces.js';
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
   * The store a dataflow run's state is kept in beside the backend's, which
   * the dataflow loop's cases run their orchestrators over: a backend that
   * keeps run state its own way gives it, so the loop runs over both. Unless
   * given, the runs keep their state in memory.
   */
  readonly stateStore?: ExecutionStateStore;
  /**
   * Leaves what the backend holds in bytes of a test's choosing, as a crash,
   * a failing disk, a hand edit or an earlier release leaves them: what the
   * cases of a record that does not decode need, and those of a record an
   * upgrade carries forward. A backend whose records can be left so gives it,
   * since those cases are what hold it to answering such a record with
   * `ExecutionCorruptError`, and to carrying an earlier release's records into
   * the current form. One that cannot omits it, and they are skipped.
   */
  readonly damage?: BackendDamage;
}

/**
 * The records a {@link BackendContext} can leave in bytes of a test's choosing.
 */
export interface BackendDamage {
  /**
   * Leaves an execution attempt's record there, in bytes that do not decode
   * as one, or in the bytes given: a record in the form an earlier release
   * wrote, say.
   *
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - The attempt's id, a UUIDv7
   * @param bytes - The record's bytes; bytes that are no record unless given
   */
  execution(taskHash: string, inputsHash: string, executionId: string, bytes?: Uint8Array): Promise<void>;
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
