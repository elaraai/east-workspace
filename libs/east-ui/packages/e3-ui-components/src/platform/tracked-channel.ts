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

    // Reactive tracking — read closures record their channel keys here while a
    // Reactive.Root render is being tracked, each with its version as first read.
    private trackingContext: Map<string, number> | null = null;

    /** Build a fresh channel entry in its initial (idle) state. */
    protected abstract createEntry(): E;

    // ----- reactive tracking ----------------------------------------------

    /**
     * Start recording the channels an evaluation reads.
     *
     * @returns What it records: each channel read, with its version as first read
     */
    enableTracking(): ReadonlyMap<string, number> {
        this.trackingContext = new Map();
        return this.trackingContext;
    }

    /**
     * Stop recording.
     *
     * @returns Each channel the evaluation read, with its version as it first read it — a channel a launch it made
     *   notified since stands at another
     */
    disableTracking(): ReadonlyMap<string, number> {
        const keys = this.trackingContext ?? new Map<string, number>();
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

    /** Record a channel-key dependency for the current render, at its version
     *  as it is read now unless the render read it before (no-op when not
     *  tracking). */
    protected track(key: string): void {
        if (this.trackingContext !== null && !this.trackingContext.has(key)) this.trackingContext.set(key, this.getKeyVersion(key));
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
                this.unsubscribed(key);
            }
        };
    }

    getKeyVersion(key: string): number {
        return this.keyVersions.get(key) ?? 0;
    }

    /** How many channels' versions the store keeps: what a spec holds its bounds to, beside its channels. */
    protected versionsKept(): number {
        return this.keyVersions.size;
    }

    /**
     * Let a channel's version go, once nothing subscribes to it: a channel a
     * subclass let go is versioned no longer, so the versions kept are those
     * of the channels it holds and those a reader subscribes to. A reader
     * still subscribed keeps the version it read until it lets the channel go.
     *
     * @param key - The channel
     */
    protected forgetVersion(key: string): void {
        if (!this.keySubscribers.has(key)) this.keyVersions.delete(key);
    }

    /** Whether anything is subscribed to a channel. */
    protected isSubscribed(key: string): boolean {
        return this.keySubscribers.has(key);
    }

    /**
     * Called as a channel's last subscriber leaves, synchronously — a
     * subclass that holds something for the channel's readers can let it go.
     * A reader re-subscribing drops its subscriptions first (a tracked read's
     * run, React's), so what is let go should be let go only if the channel
     * is still unsubscribed once that is done.
     *
     * @param _key - The channel
     */
    protected unsubscribed(_key: string): void {}

    protected notify(key: string): void {
        this.keyVersions.set(key, (this.keyVersions.get(key) ?? 0) + 1);
        const subs = this.keySubscribers.get(key);
        if (subs) for (const cb of [...subs]) cb();
    }

    /**
     * Notify several channels as one (#1360): every channel's version moves
     * first, then each subscriber is called once, however many of the
     * channels it reads — a reader of a window's fifty-five searches runs
     * again once as they land together, not once a search.
     *
     * @param keys - The channels
     */
    protected notifyAll(keys: Iterable<string>): void {
        const subscribers = new Set<() => void>();
        for (const key of keys) {
            this.keyVersions.set(key, (this.keyVersions.get(key) ?? 0) + 1);
            const subs = this.keySubscribers.get(key);
            if (subs) for (const cb of subs) subscribers.add(cb);
        }
        for (const cb of subscribers) cb();
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
