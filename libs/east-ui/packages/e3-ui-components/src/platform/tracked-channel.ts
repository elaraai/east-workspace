/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * TrackedChannelStore — shared base for the `Func.bind` / `Record.bind`
 * runtimes. Both expose one tracked channel per `(workspace, name)`: a
 * latest-wins async operation whose settling state is gated by a monotonic
 * `launchSeq`, plus a per-key reactive subscription shim that the renderer's
 * `Reactive.Root` machinery reads through (the same contract the dataset
 * cache uses).
 *
 * Subclasses supply their own API seam, per-channel entry shape, and the
 * operation body; the base owns the entries map, the tracking context, the
 * subscription shim, and the launch / settle / cancel latch.
 *
 * @packageDocumentation
 */

/** The minimal per-channel state the base manages. */
export interface ChannelEntry {
    /** Lifecycle tag — at least `"idle"` | `"running"` | `"cancelled"`, plus
     *  whatever terminal states the subclass adds. */
    status: string;
    /** Monotonic launch counter; a settling op whose seq is no longer current
     *  is discarded (latest-wins, and `cancel` orphans by bumping it). */
    launchSeq: number;
}

/**
 * Base for a runtime that manages latest-wins channels keyed by string, with
 * per-key reactive subscriptions.
 *
 * @typeParam E - The per-channel entry type (extends {@link ChannelEntry}).
 */
export abstract class TrackedChannelStore<E extends ChannelEntry> {
    protected readonly entries = new Map<string, E>();

    // Per-key reactive subscription shim.
    private readonly keySubscribers = new Map<string, Set<() => void>>();
    private readonly keyVersions = new Map<string, number>();

    // Reactive tracking — read closures push their channel keys here while a
    // Reactive.Root render is being tracked.
    private trackingContext: Set<string> | null = null;

    /** Build a fresh channel entry in its initial (idle) state. */
    protected abstract createEntry(): E;

    // ----- reactive tracking ----------------------------------------------

    enableTracking(): Set<string> {
        this.trackingContext = new Set();
        return this.trackingContext;
    }

    disableTracking(): string[] {
        const keys = this.trackingContext ? [...this.trackingContext] : [];
        this.trackingContext = null;
        return keys;
    }

    isTracking(): boolean {
        return this.trackingContext !== null;
    }

    /** Whether the CURRENT evaluation has already read this channel. A cache
     *  that evicts by least-recently-read must never drop one of these: a read
     *  pass longer than the cache would otherwise evict its own head, and the
     *  next pass would find it gone (#581). */
    protected isTracked(key: string): boolean {
        return this.trackingContext?.has(key) ?? false;
    }

    /** Record a channel-key dependency for the current render (no-op when not
     *  tracking). */
    protected track(key: string): void {
        this.trackingContext?.add(key);
    }

    // ----- subscription shim ------------------------------------------------

    subscribe(key: string, callback: () => void): () => void {
        let subs = this.keySubscribers.get(key);
        if (!subs) {
            subs = new Set();
            this.keySubscribers.set(key, subs);
        }
        subs.add(callback);
        return () => {
            subs.delete(callback);
            if (subs.size === 0 && this.keySubscribers.get(key) === subs) {
                this.keySubscribers.delete(key);
            }
        };
    }

    getKeyVersion(key: string): number {
        return this.keyVersions.get(key) ?? 0;
    }

    protected notify(key: string): void {
        this.keyVersions.set(key, (this.keyVersions.get(key) ?? 0) + 1);
        const subs = this.keySubscribers.get(key);
        if (subs) for (const cb of [...subs]) cb();
    }

    // ----- channel registry + latest-wins latch ----------------------------

    protected entry(key: string): E {
        let entry = this.entries.get(key);
        if (!entry) {
            entry = this.createEntry();
            this.entries.set(key, entry);
        }
        return entry;
    }

    /**
     * Open a latest-wins launch on a channel: bump the seq, mark the entry
     * `running`, optionally `reset` it (e.g. clear a prior error), notify, and
     * return a `settle` that applies a terminal mutation only if this launch is
     * still the current one (a superseded / cancelled launch settles to a
     * no-op).
     */
    protected beginLaunch(
        key: string,
        reset?: (entry: E) => void,
    ): { entry: E; settle: (mutate: (entry: E) => void) => void } {
        const entry = this.entry(key);
        entry.launchSeq += 1;
        const mySeq = entry.launchSeq;
        entry.status = "running";
        reset?.(entry);
        this.notify(key);

        const settle = (mutate: (entry: E) => void): void => {
            const current = this.entries.get(key);
            if (!current || current.launchSeq !== mySeq) return; // superseded
            mutate(current);
            this.notify(key);
        };
        return { entry, settle };
    }

    /**
     * Client-side cancel: if the channel is running, orphan the in-flight wait
     * (bump the seq) and mark it `cancelled`. `after` runs before the notify,
     * for subclass-specific cleanup (e.g. dropping an in-flight handle).
     */
    protected cancelChannel(key: string, after?: (entry: E) => void): void {
        const entry = this.entries.get(key);
        if (entry && entry.status === "running") {
            entry.launchSeq += 1;
            entry.status = "cancelled";
            after?.(entry);
            this.notify(key);
        }
    }

    /** Drop all channel state (entries + subscriptions + versions). */
    protected clearChannels(): void {
        this.entries.clear();
        this.keySubscribers.clear();
        this.keyVersions.clear();
    }
}
