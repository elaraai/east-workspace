/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Which rack wrote each object of a scope's leases, as a hub sees their
 * completions: what a later lease of the scope finds kept on that rack.
 *
 * @remarks
 * A rack that keeps a scope's objects (`split-scopes`) keeps what a lease of
 * the scope that feeds it wrote — its output, and every object its output
 * names — for the scope's later leases. The hub sees each such lease complete,
 * with the output it committed and the objects it was given targets for, so
 * it knows which rack holds which of them, without asking the rack. A unit
 * then waits a little for the rack that holds some of what it reads
 * (`SCOPE_AFFINITY_MS`), and is weighed as fetching none of it there
 * (`fetch-costs`): placement by input, not by scope, so a session's work is
 * not piled onto one rack.
 *
 * It is what the hub saw, and no more: a rack's own bound on what it keeps,
 * its idle time and its restart may have let an object go, and its later
 * lease then fetches it as any does. At most {@link SCOPE_WRITES_MAX} objects
 * are kept, of every scope, the least recently written going first; a scope's
 * are let go as it ends, and a rack's as it is removed.
 *
 * @example
 * ```ts
 * const writes = new ScopeWrites();
 * writes.wrote('scope-1', 'rack-1', [outputHash]);
 * writes.writer('scope-1', outputHash); // 'rack-1'
 * writes.end('scope-1');
 * ```
 */

/** The most objects a hub keeps the writer of, of every scope: as many as a
 *  rack's link is remembered to hold (`LINK_HELD_MAX`). */
export const SCOPE_WRITES_MAX = 200_000;

/** See the module's documentation. */
export class ScopeWrites {
  /** `scope\0hash` to the rack that wrote it, least recently written first */
  private readonly writers = new Map<string, string>();
  /** By scope, the keys of its objects */
  private readonly byScope = new Map<string, Set<string>>();

  /** @param max - The most objects kept; {@link SCOPE_WRITES_MAX} unless given */
  constructor(private readonly max: number = SCOPE_WRITES_MAX) {}

  /** How many objects it knows the writer of. */
  get size(): number { return this.writers.size; }

  /**
   * Notes that a lease of a scope, which feeds it, wrote these objects on a
   * rack: the rack holds them for the scope's later leases.
   * @param scope - The scope's id
   * @param rackId - The rack the lease ran on
   * @param hashes - Its output, and the objects it wrote
   */
  wrote(scope: string, rackId: string, hashes: Iterable<string>): void {
    let keys = this.byScope.get(scope);
    if (keys === undefined) { keys = new Set(); this.byScope.set(scope, keys); }
    for (const hash of hashes) {
      const key = `${scope}\0${hash}`;
      this.writers.delete(key);
      this.writers.set(key, rackId);
      keys.add(key);
      if (this.writers.size > this.max) this.evict();
    }
  }

  /**
   * The rack a lease of the scope wrote an object on, the latest of them.
   * @param scope - The scope's id
   * @param hash - The object
   * @returns The rack's id; undefined when no lease of the scope wrote it, or
   *   the hub let it go
   */
  writer(scope: string, hash: string): string | undefined {
    return this.writers.get(`${scope}\0${hash}`);
  }

  /**
   * The racks that hold any of these objects for the scope.
   * @param scope - The scope's id
   * @param hashes - What a lease reads
   * @returns Their ids, in the order the objects are given
   */
  writersOf(scope: string, hashes: Iterable<string>): Set<string> {
    const racks = new Set<string>();
    for (const hash of hashes) {
      const rackId = this.writer(scope, hash);
      if (rackId !== undefined) racks.add(rackId);
    }
    return racks;
  }

  /**
   * The scope ended: its racks keep nothing of it.
   * @param scope - The scope's id
   */
  end(scope: string): void {
    for (const key of this.byScope.get(scope) ?? []) this.writers.delete(key);
    this.byScope.delete(scope);
  }

  /**
   * A rack is removed: it holds nothing of any scope.
   * @param rackId - The rack
   */
  forget(rackId: string): void {
    for (const [key, writer] of this.writers) {
      if (writer !== rackId) continue;
      this.writers.delete(key);
      this.unindex(key);
    }
  }

  private evict(): void {
    const oldest = this.writers.keys().next();
    if (oldest.done === true) return;
    this.writers.delete(oldest.value);
    this.unindex(oldest.value);
  }

  /** Its scope's index lets go of a key: the scope's set stays until it
   *  ends, however few it holds. */
  private unindex(key: string): void {
    this.byScope.get(key.slice(0, key.indexOf('\0')))?.delete(key);
  }
}
