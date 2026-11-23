/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a hub knows of the link to each of its racks, from the data URLs it
 * serves them: how fast the link carries bytes towards the rack, and which
 * objects the rack was served whole, and so holds in its cache.
 *
 * @remarks
 * Every byte a rack fetches of a local repository streams through the hub
 * (`SessionProxyStorageBridge.dataRoutes`), so the hub measures the link as
 * the rack sees it, whatever lies between them: a LAN, a tunnel, a relay.
 *
 * **The rate** is the bytes the hub sent the rack while at least one of its
 * transfers was in flight, over that time: the link's throughput, however
 * many transfers share it, not one transfer's. It is taken as a sample every
 * {@link LINK_SAMPLE_BYTES}, and when the rack's transfers all end with at
 * least {@link LINK_MIN_SAMPLE_BYTES} counted, and smoothed as an exponentially
 * weighted moving average ({@link LINK_EWMA_WEIGHT}): one slow or fast transfer
 * moves it, and does not set it. Bytes a transfer read from its session but
 * the link has not yet carried count early, so a sample errs fast, never
 * slow. A rate no sample has refreshed for {@link LINK_STALE_MS} is forgotten:
 * a link that once measured slow, and so kept work off the rack, is measured
 * again.
 *
 * **What a rack holds** is each object it was served to the last byte, or
 * sent inline, by its
 * repository's cache namespace (a session's `repoAlias`) and its hash, at most
 * {@link LINK_HELD_MAX} of them, the least recently served going first. It is
 * what the hub saw since it started, and no more: an object the rack fetched
 * from another hub, or an output it wrote, is not known to be held.
 *
 * @example
 * ```ts
 * const meter = new RackLinkMeter();
 * const transfer = meter.begin('rack-1');
 * transfer.add(chunk.length);
 * transfer.end({ repo: 'r-1234', hash });
 * meter.link('rack-1'); // { bytesPerSecond: 1.1e7 | null, holds(repo, hash) }
 * ```
 */

/** The bytes a sample of a link's rate is taken over, while its transfers run. */
export const LINK_SAMPLE_BYTES = 16 * 1024 * 1024;
/** The fewest bytes a sample is taken from when a rack's transfers all end:
 *  fewer are carried over to the next. */
export const LINK_MIN_SAMPLE_BYTES = 1024 * 1024;
/** The weight a new sample has in a link's rate. */
export const LINK_EWMA_WEIGHT = 0.3;
/** How long a rate stands without a sample, in ms: thirty minutes. */
export const LINK_STALE_MS = 30 * 60_000;
/** The most objects a rack is remembered to hold. */
export const LINK_HELD_MAX = 200_000;

/** One transfer to a rack, counted as its bytes leave. */
export interface LinkTransfer {
  /**
   * Counts bytes sent.
   * @param bytes - How many
   */
  add(bytes: number): void;
  /**
   * Ends the transfer, once; a second end is ignored.
   * @param whole - The object the rack now holds, when the transfer sent it to
   *   its last byte; absent for a transfer cut short, or of anything else
   */
  end(whole?: { readonly repo: string; readonly hash: string }): void;
}

/** What a hub knows of one rack's link. */
export interface RackLink {
  /** The link's rate towards the rack, in bytes a second; null when it is not
   *  measured, or no sample has refreshed it for {@link LINK_STALE_MS} */
  readonly bytesPerSecond: number | null;
  /**
   * Whether the rack was served an object whole.
   * @param repo - The repository's cache namespace
   * @param hash - The object's hash
   * @returns Whether it was
   */
  holds(repo: string, hash: string): boolean;
}

interface Link {
  inFlight: number;
  /** When the transfers in flight began to be counted, by the meter's clock */
  busySince: number;
  /** Bytes counted towards the next sample, and the busy time they took */
  bytes: number;
  busyMs: number;
  rate: number | null;
  sampledAt: number;
  /** `repo\0hash`, least recently served first */
  held: Set<string>;
}

/**
 * Measures each rack's link from the transfers a hub serves it, and keeps
 * which objects each was served whole.
 */
export class RackLinkMeter {
  private readonly links = new Map<string, Link>();

  /** @param now - A monotonic clock, in ms; `performance.now` unless given */
  constructor(private readonly now: () => number = () => performance.now()) {}

  private of(rackId: string): Link {
    let link = this.links.get(rackId);
    if (link === undefined) {
      link = { inFlight: 0, busySince: 0, bytes: 0, busyMs: 0, rate: null, sampledAt: 0, held: new Set() };
      this.links.set(rackId, link);
    }
    return link;
  }

  /** Counts the busy time up to now into the next sample. */
  private settle(link: Link): void {
    const at = this.now();
    link.busyMs += Math.max(0, at - link.busySince);
    link.busySince = at;
  }

  private sample(link: Link): void {
    if (link.busyMs <= 0) return;
    const rate = link.bytes * 1000 / link.busyMs;
    link.rate = link.rate === null || this.now() - link.sampledAt > LINK_STALE_MS ? rate : link.rate + LINK_EWMA_WEIGHT * (rate - link.rate);
    link.sampledAt = this.now();
    link.bytes = 0;
    link.busyMs = 0;
  }

  /**
   * Begins counting a transfer to a rack.
   * @param rackId - The rack it is served to
   * @returns The transfer, which the caller counts and ends
   */
  begin(rackId: string): LinkTransfer {
    const link = this.of(rackId);
    if (link.inFlight++ === 0) link.busySince = this.now();
    let ended = false;
    return {
      add: (bytes) => {
        if (ended) return;
        link.bytes += bytes;
        if (link.bytes >= LINK_SAMPLE_BYTES) { this.settle(link); this.sample(link); }
      },
      end: (whole) => {
        if (ended) return;
        ended = true;
        if (whole !== undefined) this.hold(link, `${whole.repo}\0${whole.hash}`);
        if (--link.inFlight > 0) return;
        this.settle(link);
        if (link.bytes >= LINK_MIN_SAMPLE_BYTES) this.sample(link);
      },
    };
  }

  /**
   * Notes that a rack was sent an object whole another way: inline, in the
   * answer to its storage request, which carries no data URL.
   * @param rackId - The rack
   * @param repo - The repository's cache namespace
   * @param hash - The object's hash
   */
  held(rackId: string, repo: string, hash: string): void { this.hold(this.of(rackId), `${repo}\0${hash}`); }

  private hold(link: Link, key: string): void {
    link.held.delete(key);
    link.held.add(key);
    if (link.held.size > LINK_HELD_MAX) link.held.delete(link.held.values().next().value!);
  }

  /**
   * What the hub knows of a rack's link.
   * @param rackId - The rack
   * @returns Its rate, when measured and fresh, and what it was served whole
   */
  link(rackId: string): RackLink {
    const link = this.links.get(rackId);
    const rate = link === undefined || this.now() - link.sampledAt > LINK_STALE_MS ? null : link.rate;
    return { bytesPerSecond: rate, holds: (repo, hash) => link?.held.has(`${repo}\0${hash}`) ?? false };
  }

  /** The racks the hub has served a transfer, in the order it first did. */
  racks(): string[] { return [...this.links.keys()]; }

  /**
   * Forgets a rack: one removed, whose cache another enrollment may not share.
   * @param rackId - The rack
   */
  forget(rackId: string): void { this.links.delete(rackId); }
}
