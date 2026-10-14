/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A bounded memo of what an object decodes to, by the repository that holds
 * it and its hash.
 *
 * @remarks
 * An object's hash fixes its bytes, so what the bytes decode to never goes
 * stale: a package object or a task object read once is the same however
 * often it is read again. A repository's objects are kept apart from
 * another's ({@link memoKey}), so an object one repository holds is read from
 * the store when another first names it, and refused there when that one does
 * not hold it. The memo holds at most `kept` entries, the oldest going first,
 * so a process that reads many packages holds a bounded few. What it holds is
 * shared by every reader, so a reader never changes what it is given.
 *
 * @packageDocumentation
 */

/**
 * A bounded memo by key.
 *
 * @typeParam T - What an object decodes to
 */
export interface HashMemo<T> {
  /**
   * What the object decodes to, if the memo holds it.
   *
   * @param key - The object's key ({@link memoKey})
   * @returns The decoded object, or `undefined` when the memo does not hold it
   */
  get(key: string): T | undefined;
  /**
   * Keeps what an object decodes to, the oldest entry going once the memo is
   * full.
   *
   * @param key - The object's key ({@link memoKey})
   * @param value - What it decodes to
   */
  set(key: string, value: T): void;
  /** Forgets everything: for a test that counts reads. */
  clear(): void;
}

/**
 * The key an object is kept under: its repository and its hash, so a
 * repository that does not hold an object another does is never answered it.
 *
 * @param repo - Repository identifier
 * @param hash - The object's hash
 * @returns The key
 */
export function memoKey(repo: string, hash: string): string {
  return `${repo}\n${hash}`;
}

/**
 * Makes a memo that keeps at most `kept` decoded objects.
 *
 * @param kept - How many entries it keeps; past that the oldest goes first
 * @returns The memo
 */
export function hashMemo<T>(kept: number): HashMemo<T> {
  const held = new Map<string, T>();
  return {
    get(key) {
      return held.get(key);
    },
    set(key, value) {
      if (held.has(key)) return;
      if (held.size >= kept) held.delete(held.keys().next().value!);
      held.set(key, value);
    },
    clear() {
      held.clear();
    },
  };
}
