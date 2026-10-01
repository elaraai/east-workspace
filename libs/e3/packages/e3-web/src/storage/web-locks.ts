/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Locks through Web Locks (`navigator.locks`), taken by the tab's session.
 *
 * A tab opens one session: an id it holds a Web Lock of its own under for as
 * long as it lives. Every lock the tab takes is a Web Lock too, so when the
 * tab closes, or crashes, the browser frees all of them, the session's among
 * them. A lock holder another tab recorded names the session as its `bootId`,
 * with pid 0, and a tab asks whether that holder is alive by asking Web Locks
 * whether the session's lock is still held. So two tabs over one origin take
 * locks as two processes over one directory do, and a closed tab's locks are
 * free.
 *
 * @packageDocumentation
 */

import { AdapterClosedError, checkLockRequest, type LockHold, type LockMode, type LockRequest, type LocksAdapter } from './adapters.js';

/**
 * How {@link openWebLocks} opens a session.
 */
export interface WebLocksOptions {
  /** What the name of every Web Lock the session takes begins with, so sets
   *  of locks over one origin keep apart: `e3:` unless given */
  readonly prefix?: string;
  /** The lock manager to take them from: the global `navigator.locks` unless
   *  given */
  readonly manager?: LockManager;
}

/**
 * The name of the Web Lock a session holds for as long as it lives: another
 * tab that waits for it learns when the session has ended.
 *
 * @param prefix - What the session's lock names begin with
 * @param session - The session's id
 * @returns The Web Lock's name
 */
export function sessionLockName(prefix: string, session: string): string {
  return `${prefix}session:${session}`;
}

/** The Web Lock a name given to {@link WebLocks.acquire} is. */
function namedLockName(prefix: string, name: string): string {
  return `${prefix}lock:${name}`;
}

/**
 * Opens the tab's session: takes the session's own Web Lock, which the tab
 * holds until the session closes or the tab does.
 *
 * @param options - What the session's lock names begin with, and the lock
 *   manager
 * @returns The session's locks
 * @throws {Error} When the page has no Web Locks: it is not a secure context
 *
 * @example
 * ```ts
 * const locks = await openWebLocks();
 * const hold = await locks.acquire('main', 'exclusive', { wait: true, timeout: 30_000 });
 * // another tab: await locks.isAlive(session) is true until this tab closes
 * ```
 */
export async function openWebLocks(options: WebLocksOptions = {}): Promise<WebLocks> {
  const manager = options.manager ?? (globalThis.navigator as Navigator | undefined)?.locks;
  if (manager === undefined) {
    throw new Error('Web Locks are not available: e3-web needs a secure context — https:, or http://localhost');
  }
  const prefix = options.prefix ?? 'e3:';
  // Web Locks keeps the names that begin with '-' to itself.
  if (prefix.startsWith('-')) throw new TypeError(`a Web Locks prefix does not begin with '-': ${JSON.stringify(prefix)}`);
  const session = crypto.randomUUID();
  const held = await take(manager, sessionLockName(prefix, session), 'exclusive', { ifAvailable: true });
  if (held === null) throw new Error(`the session ${session} is open already`);
  return new WebLocks(manager, prefix, session, held);
}

/** A Web Lock held: its release, which resolves once the lock is free. */
interface Held {
  release(): Promise<void>;
}

/**
 * Asks the lock manager for a lock, and answers once it has been granted, or
 * refused.
 *
 * @param manager - The lock manager
 * @param name - The Web Lock's name
 * @param mode - How to hold it
 * @param how - `ifAvailable`: refuse at once when it cannot be granted;
 *   `signal`: wait until it is granted or the signal aborts
 * @returns The lock held, or `null` when it was refused
 */
function take(
  manager: LockManager,
  name: string,
  mode: LockMode,
  how: { readonly ifAvailable: true } | { readonly signal: AbortSignal },
): Promise<Held | null> {
  return new Promise<Held | null>((resolve, reject) => {
    let release!: () => void;
    const released = new Promise<void>((resolveRelease) => {
      release = resolveRelease;
    });
    let answered = false;
    const request = manager.request(name, { mode, ...how }, (lock) => {
      answered = true;
      if (lock === null) {
        resolve(null);
        return undefined;
      }
      resolve({
        release: async () => {
          release();
          // The request settles once the manager has let the lock go.
          await request;
        },
      });
      return released;
    });
    request.catch((err: unknown) => {
      if (answered) return;
      // A request aborted while it waited was refused; anything else failed.
      if ('signal' in how && how.signal.aborted) resolve(null);
      else reject(err instanceof Error ? err : new Error(`Web Locks refused ${name}: ${String(err)}`));
    });
  });
}

/**
 * A tab's session over Web Locks: the {@link LocksAdapter} of a browser.
 *
 * @remarks
 * Requests for a name are made of the lock manager in the order they were
 * made of the session: a request that cannot be granted at once is refused,
 * or waits behind the ones before it, as Web Locks queues them. A timeout
 * bounds a wait for a name another holds; a name that can be granted at once
 * is granted whatever the timeout.
 */
export class WebLocks implements LocksAdapter {
  private closed = false;
  /** Aborted as the session closes: every request of it still waiting is
   *  refused */
  private readonly closing = new AbortController();
  /** The holds the session has not released */
  private readonly holds = new Set<LockHold>();
  /** For each name, what the last request for it settles once it has been
   *  made of the lock manager */
  private readonly made = new Map<string, Promise<void>>();

  /**
   * @param manager - The lock manager
   * @param prefix - What the session's lock names begin with
   * @param session - The session's id
   * @param own - The session's own lock
   * @internal
   */
  constructor(
    private readonly manager: LockManager,
    private readonly prefix: string,
    readonly session: string,
    private readonly own: Held,
  ) {}

  private assertOpen(): void {
    if (this.closed) throw new AdapterClosedError('locks');
  }

  async acquire(name: string, mode: LockMode, options: LockRequest = {}): Promise<LockHold | null> {
    this.assertOpen();
    checkLockRequest(mode, options);
    const lock = namedLockName(this.prefix, name);
    const previous = this.made.get(lock) ?? Promise.resolve();
    let madeIt!: () => void;
    const made = new Promise<void>((resolve) => {
      madeIt = resolve;
    });
    this.made.set(lock, made);
    try {
      await previous;
      if (this.closed) return null;
      const tried = await take(this.manager, lock, mode, { ifAvailable: true });
      if (tried !== null) return await this.keep(tried);
      if (options.wait !== true) return null;
      const signal = options.timeout === undefined
        ? this.closing.signal
        : AbortSignal.any([this.closing.signal, AbortSignal.timeout(options.timeout)]);
      // The request that waits is made here, so the next request of the
      // session for this name is made after it, and queues behind it.
      const waiting = take(this.manager, lock, mode, { signal });
      madeIt();
      const held = await waiting;
      return held === null ? null : await this.keep(held);
    } finally {
      madeIt();
      if (this.made.get(lock) === made) this.made.delete(lock);
    }
  }

  /** Keeps a lock granted as a hold of the session, unless the session has
   *  closed meanwhile, when it lets the lock go. */
  private async keep(held: Held): Promise<LockHold | null> {
    if (this.closed) {
      await held.release();
      return null;
    }
    let released = false;
    const hold: LockHold = {
      release: async () => {
        if (released) return;
        released = true;
        this.holds.delete(hold);
        await held.release();
      },
    };
    this.holds.add(hold);
    return hold;
  }

  async held(name: string): Promise<LockMode[]> {
    this.assertOpen();
    const lock = namedLockName(this.prefix, name);
    const { held = [] } = await this.manager.query();
    return held.filter((info) => info.name === lock).map((info) => info.mode ?? 'exclusive').sort();
  }

  async isAlive(session: string): Promise<boolean> {
    this.assertOpen();
    const lock = sessionLockName(this.prefix, session);
    const { held = [] } = await this.manager.query();
    return held.some((info) => info.name === lock);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.closing.abort();
    for (const hold of [...this.holds]) await hold.release();
    await this.own.release();
  }
}
