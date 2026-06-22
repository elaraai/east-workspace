/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * In-process async mutex keyed by an arbitrary string.
 *
 * `withKeyedLock(key, fn)` runs `fn` only after every previously-enqueued task
 * for the same `key` has settled, so same-process callers sharing a key execute
 * strictly one-at-a-time. Distinct keys never contend.
 *
 * **This is a per-process, in-memory coordination primitive with ZERO
 * cross-process semantics.** It must never be relied on for correctness across
 * processes — a filesystem (or database) lock remains the sole cross-process
 * serializer. Its only job is to stop same-process concurrency from stampeding
 * that lower-level lock: e.g. the local dataset-ref store layers it above the
 * exclusive `.lock` file so K concurrent same-process writers serialize in memory
 * and never turn into a Windows rename / lock-file thundering herd. Two separate
 * OS processes have disjoint maps, so between them this is a no-op.
 *
 * @remarks The tail map is keyed-and-drained per key (an entry is removed once
 * its chain settles and no later caller has replaced it), so a long-lived
 * process that touches many distinct keys does not accumulate map entries.
 */

/** Per-key promise tail: the settlement of the last-enqueued task for that key. */
const tails = new Map<string, Promise<void>>();

/**
 * Run `fn` exclusively with respect to other callers sharing `key`.
 *
 * @param key - The serialization key; only tasks with an equal key are ordered.
 * @param fn - The work to run once the key is free.
 * @returns A promise for `fn`'s result (it rejects iff `fn` rejects; a prior
 *   task's failure never blocks or fails a later one).
 */
export function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  // Chain on the prior tail regardless of how it settled (run `fn` on both
  // resolve and reject of `prev`), so one caller's failure can't wedge the key.
  const run = prev.then(fn, fn);
  // The next caller waits on this tail, which never rejects (so it can't become
  // an unhandled rejection nor block the queue).
  const tail = run.then(() => undefined, () => undefined);
  tails.set(key, tail);
  // Drop the entry once this tail drains, unless a later caller already replaced
  // it — the identity check keeps the map bounded without orphaning a live chain.
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

/**
 * Number of keys with an in-flight or queued task. Exposed for tests to assert
 * the map drains to empty (no leak); not part of the coordination contract.
 *
 * @internal
 */
export function pendingKeyCount(): number {
  return tails.size;
}
