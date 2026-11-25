/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Which racks hold each object of a scope, as a hub sees its leases: what a
 * later lease of the scope finds kept on those racks.
 *
 * @remarks
 * A rack that keeps a split scope's objects (`split-scopes`) keeps what a
 * lease of the scope that feeds it wrote — its output, and every object its
 * output names — for the scope's later leases. A rack that keeps the hub's
 * own scope (`hub-keyed-scopes`) keeps that too, and what it was served whole
 * for a lease that feeds it, for later leases of any session of the same
 * repository. The hub sees each such lease complete, with the output it
 * committed and the objects it was given targets for, and each object it
 * serves whole, so it knows which racks hold which of them, without asking
 * them. A lease then waits a little for a rack that holds some of what it
 * reads (`SCOPE_AFFINITY_MS`): placement by input, not by scope, so a
 * session's work is not piled onto one rack.
 *
 * Several racks may hold one object — each that fetched it, and the one that
 * made it — and each is kept, at most {@link SCOPE_HOLDERS_MAX} of an object,
 * the least recently noted going first. It is what the hub saw, and no more:
 * a rack's own bound on what it keeps may have let an object go, and its
 * later lease then fetches it as any does; the hub lets a rack's go when it
 * learns the rack keeps nothing of a scope any more (`forget`). At most
 * {@link SCOPE_WRITES_MAX} objects are kept, of every scope, the least
 * recently noted going first; a split scope's are let go as it ends.
 *
 * @example
 * ```ts
 * const writes = new ScopeWrites();
 * writes.wrote('scope-1', 'rack-1', [outputHash]);
 * writes.writer('scope-1', outputHash); // 'rack-1'
 * writes.end('scope-1');
 * ```
 */

/** The most objects a hub keeps the holders of, of every scope. */
export const SCOPE_WRITES_MAX = 200_000;

/** The most racks a hub keeps as holding one object of a scope. */
export const SCOPE_HOLDERS_MAX = 8;

/**
 * Which racks hold each object of each scope, as a hub saw its leases: what a
 * later lease of the scope finds kept on those racks.
 *
 * @remarks
 * Kept in memory, for as long as the hub runs, at most its bound of objects
 * of every scope, the least recently noted going first, and of each object at
 * most {@link SCOPE_HOLDERS_MAX} racks. A scope's are let go as it ends; a
 * rack's, of a scope or of all, as it stops keeping them. See the module's
 * documentation for what it is used for.
 *
 * @example
 * ```ts
 * const writes = new ScopeWrites();
 * writes.wrote('scope-1', 'rack-1', [outputHash, partHash]);
 * writes.writersOf('scope-1', [outputHash]); // Set { 'rack-1' }
 * writes.forget('rack-1');
 * writes.writer('scope-1', outputHash); // undefined
 * ```
 */
export class ScopeWrites {
  /** `scope\0hash` to the racks that hold it, the latest last; keys least recently noted first */
  private readonly holders = new Map<string, string[]>();
  /** By scope, the keys of its objects */
  private readonly byScope = new Map<string, Set<string>>();

  /**
   * @param max - The most objects kept; {@link SCOPE_WRITES_MAX} unless given
   * @example
   * ```ts
   * const writes = new ScopeWrites(1000);
   * ```
   */
  constructor(private readonly max: number = SCOPE_WRITES_MAX) {}

  /**
   * How many objects it keeps the holders of.
   * @returns The count, of every scope
   */
  get size(): number { return this.holders.size; }

  /**
   * Notes that a rack holds these objects for the scope: a lease of it wrote
   * them there, or the rack was served them whole for one.
   * @param scope - The scope's id
   * @param rackId - The rack
   * @param hashes - The objects
   * @example
   * ```ts
   * writes.wrote(scope, lease.claimedBy, [outputHash, ...lease.targets]);
   * ```
   */
  wrote(scope: string, rackId: string, hashes: Iterable<string>): void {
    let keys = this.byScope.get(scope);
    if (keys === undefined) { keys = new Set(); this.byScope.set(scope, keys); }
    for (const hash of hashes) {
      const key = `${scope}\0${hash}`;
      const racks = (this.holders.get(key) ?? []).filter((held) => held !== rackId);
      racks.push(rackId);
      if (racks.length > SCOPE_HOLDERS_MAX) racks.splice(0, racks.length - SCOPE_HOLDERS_MAX);
      this.holders.delete(key);
      this.holders.set(key, racks);
      keys.add(key);
      if (this.holders.size > this.max) this.evict();
    }
  }

  /**
   * The rack last noted to hold an object of the scope.
   * @param scope - The scope's id
   * @param hash - The object
   * @returns The rack's id; undefined when no rack is noted to hold it
   * @example
   * ```ts
   * const held = writes.writer(scope, hash) === rackId;
   * ```
   */
  writer(scope: string, hash: string): string | undefined {
    return this.holders.get(`${scope}\0${hash}`)?.at(-1);
  }

  /**
   * The racks that hold any of these objects for the scope.
   * @param scope - The scope's id
   * @param hashes - What a lease reads
   * @returns Their ids
   * @example
   * ```ts
   * const holders = writes.writersOf(scope, leaseReads(event));
   * ```
   */
  writersOf(scope: string, hashes: Iterable<string>): Set<string> {
    const racks = new Set<string>();
    for (const hash of hashes) for (const rackId of this.holders.get(`${scope}\0${hash}`) ?? []) racks.add(rackId);
    return racks;
  }

  /**
   * The scope ended: its racks keep nothing of it.
   * @param scope - The scope's id
   * @example
   * ```ts
   * writes.end(scope);
   * ```
   */
  end(scope: string): void {
    for (const key of this.byScope.get(scope) ?? []) this.holders.delete(key);
    this.byScope.delete(scope);
  }

  /**
   * A rack keeps nothing it kept: of the scopes given, or, given none, of any
   * — it was removed, rebooted, or stopped keeping them.
   * @param rackId - The rack
   * @param scopes - The scopes it keeps nothing of now; every scope unless given
   * @example
   * ```ts
   * writes.forget(rackId);
   * ```
   */
  forget(rackId: string, scopes?: Iterable<string>): void {
    const keys = scopes === undefined ? [...this.holders.keys()] : [...scopes].flatMap((scope) => [...this.byScope.get(scope) ?? []]);
    for (const key of keys) {
      const racks = this.holders.get(key);
      if (racks === undefined || !racks.includes(rackId)) continue;
      const left = racks.filter((held) => held !== rackId);
      if (left.length > 0) { this.holders.set(key, left); continue; }
      this.holders.delete(key);
      this.unindex(key);
    }
  }

  private evict(): void {
    const oldest = this.holders.keys().next();
    if (oldest.done === true) return;
    this.holders.delete(oldest.value);
    this.unindex(oldest.value);
  }

  /** Its scope's index lets go of a key: the scope's set stays until it
   *  ends, however few it holds. */
  private unindex(key: string): void {
    this.byScope.get(key.slice(0, key.indexOf('\0')))?.delete(key);
  }
}
