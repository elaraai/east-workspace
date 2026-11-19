/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a reader is handed of an input, given what it read of the input's
 * dataset: the one place that decides whether a task's or a function's input
 * can be read now.
 *
 * A run, a workspace's status, the history a collection keeps and a function's
 * call each read a task's or a function's inputs from the workspace's refs.
 * Each asks here, handing over what it read — the hash, and what the record
 * waits for — so each one waits, or refuses, where the others do, and none
 * computes over an input another would not read.
 *
 * @packageDocumentation
 */

import { indexNotHeld, inputObject } from './dataset-open.js';
import { pendingWaitWords } from './record-slots.js';
import type { StorageBackend } from './storage/interfaces.js';

/** What a reader read of an input's dataset. */
export interface InputHeld {
  /** The hash it reads: for a record, a state's. */
  readonly hash: string;
  /** The external sources the dataset's record waits for a first delivery
   *  of, as the reader read its ref (`pendingSources`): none for a record that
   *  waits for nothing, and for any other dataset. */
  readonly pending: readonly string[];
}

/**
 * What a reader is handed of an input ({@link taskInputRead}): the object, or
 * why the input cannot be read now, in the words a status gives. `pending`
 * names the external sources a composite record waits for, when that is why.
 */
export type TaskInputRead =
  | { readonly object: string }
  | { readonly waiting: string; readonly pending?: readonly string[] };

/**
 * What a task or a function reads of one of its inputs, given what its
 * reader read of the dataset: the object it is handed ({@link inputObject}),
 * or why it waits, in the words its status gives.
 *
 * @remarks
 * An input waits for one of two reasons, asked in this order:
 *
 * - its dataset is a composite record that waits for an external source's
 *   first delivery. The record holds a state — the solution's own entries
 *   alone — so its ref says it waits, and that is asked before its state, or
 *   an index of it, is looked for;
 * - it is an index its record's state does not hold.
 *
 * Each reader of a task's or a function's current inputs decides here, so a
 * run leaves a task waiting where its status says it waits, a function that
 * declares the input ends its call refused, and the history a collection keeps
 * holds no execution over it. The bundle and the current execution, which
 * need no reason, ask for the object alone (`inputObject`) and fall back to
 * the task's last run. Every door that writes a state — a deploy, `$init`, a
 * restore, a rollback — writes one holding every index its record declares,
 * so a state that holds none was written outside them.
 *
 * The reader says what the record waits for, since which reading of the ref
 * decides is the reader's: a status and a call ask the ref as it stands, and
 * a run asks it as it stood when the run took the version it reads.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param path - The input's keypath, as a status names it: `.records.jobs`
 * @param held - What the reader read of the input's dataset: the hash it
 *   reads, and the sources its record waits for
 * @param index - The index of the record the input reads, by name; `null` for
 *   the dataset itself
 * @returns The object the reader is handed, or why it waits for the input
 *
 * @example
 * ```ts
 * const held = { hash: ref.value.hash, pending: pendingSources(ref.value.versions) };
 * const read = await taskInputRead(storage, repo, '.records.jobs', held, 'jobs_by_press');
 * if ('waiting' in read) console.log(read.waiting);
 * // record 'jobs' waits for the first delivery of erp
 * // Input '.records.jobs': the record .records.jobs holds no index …
 * ```
 */
export async function taskInputRead(
  storage: StorageBackend,
  repo: string,
  path: string,
  held: InputHeld,
  index: string | null,
): Promise<TaskInputRead> {
  if (held.pending.length > 0) return { waiting: pendingWaitWords(path, held.pending), pending: held.pending };
  const object = await inputObject(storage, repo, held.hash, index);
  return object === null ? { waiting: `Input '${path}': ${indexNotHeld(path, index!)}` } : { object };
}
