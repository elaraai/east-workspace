/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A lease's closure (#214): every object its guest's execution reads, which
 * the cloud computes when it grants the lease. The agent fetches exactly
 * these into its cache and links them into the guest's scratch, and
 * `/rack/storage` admits exactly these: a rack reaches no other object of the
 * repository.
 *
 * What e3-core's execution reads over a staged store:
 * - a task or a unit: its task object; its program, or its command IR; what
 *   its output kind folds with (a dict's merge, a fold's zero and combine);
 *   its environment's spec and the files that names; and each object it
 *   stages (a task's inputs, a piece's inputs, a merge's range and parts);
 * - a function call: its program, its environment, and each stored dataset
 *   argument;
 * - a staged dataset: the object, and, for a record state, its primary; for a
 *   manifest, its header and its segments.
 *
 * A closure larger than {@link INLINE_CLOSURE_MAX} hashes is recorded as an
 * object in the repository's store, whose hash the lease carries.
 */

import { ArrayType, StringType, decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import { openDatasetObject, type DetachedArg, type SplitUnit, type StorageBackend } from '@elaraai/e3-core';
import { EnvironmentSpecType, environmentSpecObjectHashes, type TaskObject } from '@elaraai/e3-types';
import type { RackLeaseClosure } from '../protocol/task-envelope.js';

/** The most hashes a lease's event carries inline: past it, the closure is an object. */
export const INLINE_CLOSURE_MAX = 512;

/** A closure object: the hashes, as a beast2 `Array<String>`. */
const ClosureListType = ArrayType(StringType);
const encodeList = encodeBeast2For(ClosureListType);
const decodeList = decodeBeast2For(ClosureListType);
const decodeEnvironmentSpec = decodeBeast2For(EnvironmentSpecType);

/**
 * A closure object's bytes.
 *
 * @param hashes - The closure's hashes
 * @returns The object's bytes
 */
export function encodeClosure(hashes: readonly string[]): Uint8Array {
  return encodeList([...hashes]);
}

/**
 * The hashes a closure object lists.
 *
 * @param bytes - The object's bytes
 * @returns The hashes
 * @throws {Error} When the bytes are not a closure object
 */
export function decodeClosure(bytes: Uint8Array): string[] {
  return decodeList(bytes);
}

/**
 * What a unit's execution stages: a piece's inputs, or a merge's key range
 * and its parts (e3-core's `taskExecuteBody`).
 *
 * @param inputs - The unit's inputs, as its record names them
 * @param merge - What a merge unit merges, or null for a piece
 * @returns The staged objects' hashes
 */
export function stagedObjects(inputs: readonly string[], merge: SplitUnit['merge']): string[] {
  return merge === null ? [...inputs] : [...(merge.range === null ? [] : [merge.range]), ...merge.parts];
}

/**
 * The closure of a task's or a unit's execution.
 *
 * @param storage - The repository's storage
 * @param repo - Repository identifier
 * @param taskHash - The task object's hash
 * @param task - The task object
 * @param staged - What the execution stages ({@link stagedObjects})
 * @param parts - Collects the closure's collection parts (each staged
 *   manifest's entries): what a unit fetches only as it reads them
 * @returns The objects it reads, sorted
 * @throws {Error} When an object it names cannot be read
 */
export async function taskClosure(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  task: TaskObject,
  staged: readonly string[],
  parts?: Set<string>,
): Promise<string[]> {
  const into = new Set<string>([taskHash]);
  into.add(task.body.type === 'east' ? task.body.value.program : task.body.value.commandIr);
  const kind = task.output.kind;
  if (kind.type === 'dict' && kind.value.merge.type === 'some') into.add(kind.value.merge.value);
  if (kind.type === 'fold') {
    into.add(kind.value.zero);
    into.add(kind.value.combine);
  }
  if (task.environment.type === 'some') await addEnvironment(storage, repo, task.environment.value, into);
  for (const hash of new Set(staged)) await addValue(storage, repo, hash, into, parts);
  return [...into].sort();
}

/**
 * The closure of a function call's execution.
 *
 * @param storage - The repository's storage
 * @param repo - Repository identifier
 * @param program - The program's object hash
 * @param args - The call's arguments: a stored dataset's objects are staged
 * @param environment - The environment the call declares
 * @returns The objects it reads, sorted
 * @throws {Error} When an object it names cannot be read
 */
export async function detachedClosure(
  storage: StorageBackend,
  repo: string,
  program: string,
  args: readonly DetachedArg[],
  environment?: string,
): Promise<string[]> {
  return [...new Set([program, ...await callClosure(storage, repo, args, environment)])].sort();
}

/**
 * The closure of a function call whose program travels with it, not as an
 * object: its environment, and each stored dataset argument (#225, a
 * sandbox's call).
 *
 * @param storage - The repository's storage
 * @param repo - Repository identifier
 * @param args - The call's arguments: a stored dataset's objects are staged
 * @param environment - The environment the call declares
 * @param parts - Collects the closure's collection parts, as {@link taskClosure}'s
 * @returns The objects it reads, sorted
 * @throws {Error} When an object it names cannot be read
 */
export async function callClosure(
  storage: StorageBackend,
  repo: string,
  args: readonly DetachedArg[],
  environment?: string,
  parts?: Set<string>,
): Promise<string[]> {
  const into = new Set<string>();
  if (environment !== undefined) await addEnvironment(storage, repo, environment, into);
  for (const arg of args) {
    if (!(arg instanceof Uint8Array)) await addValue(storage, repo, arg.dataset, into, parts);
  }
  return [...into].sort();
}

/**
 * Records a closure on a lease: its hashes inline, or, when there are more
 * than {@link INLINE_CLOSURE_MAX}, an object in the repository's store that
 * lists them.
 *
 * @param storage - The repository's storage
 * @param repo - Repository identifier
 * @param hashes - The closure
 * @returns What the lease's event carries
 */
export async function recordClosure(storage: StorageBackend, repo: string, hashes: readonly string[]): Promise<RackLeaseClosure> {
  if (hashes.length <= INLINE_CLOSURE_MAX) return { hashes: [...hashes] };
  const object = await storage.objects.write(repo, encodeClosure(hashes));
  return { object, count: hashes.length };
}

/**
 * Every object a lease may read, as its closure names them: the hashes, and,
 * for a closure recorded as an object, that object too.
 *
 * @param closure - The lease's closure
 * @param read - Reads the closure object, for one recorded as an object
 * @returns The hashes
 * @throws {Error} When the closure object cannot be read, or lists another
 *   number of hashes than the lease says
 */
export async function closureHashes(closure: RackLeaseClosure, read: (hash: string) => Promise<Uint8Array>): Promise<string[]> {
  if ('hashes' in closure) return [...closure.hashes];
  const hashes = decodeClosure(await read(closure.object));
  if (hashes.length !== closure.count) {
    throw new Error(`closure object ${closure.object} lists ${hashes.length} hashes, and its lease ${closure.count}`);
  }
  return [closure.object, ...hashes];
}

/** A staged dataset's objects: the object, a record state's primary, a manifest's header and segments (its parts). */
async function addValue(storage: StorageBackend, repo: string, hash: string, into: Set<string>, parts: Set<string> | undefined): Promise<void> {
  if (into.has(hash)) return;
  into.add(hash);
  const opened = await openDatasetObject(storage, repo, hash);
  into.add(opened.hash);
  if (opened.manifest === null) return;
  into.add(opened.manifest.header);
  for (const entry of opened.manifest.entries) {
    if (opened.manifest.level === 0n) {
      into.add(entry.hash);
      parts?.add(entry.hash);
    } else await addValue(storage, repo, entry.hash, into, parts);
  }
}

/** An environment's spec and the files it names. */
async function addEnvironment(storage: StorageBackend, repo: string, hash: string, into: Set<string>): Promise<void> {
  into.add(hash);
  const spec = decodeEnvironmentSpec(await storage.objects.read(repo, hash));
  for (const file of environmentSpecObjectHashes(spec)) into.add(file);
}
