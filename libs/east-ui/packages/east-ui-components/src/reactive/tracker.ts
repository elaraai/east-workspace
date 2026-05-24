/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Reactive tracker registry — pluggable dependency tracking for EastReactiveComponent.
 *
 * Each platform implementation (State, Data, etc.) registers a tracker.
 * The reactive component iterates over all registered trackers without
 * knowing what they are.
 *
 * Concurrency constraint: tracking uses module-level mutable state.
 * Only one render may be tracked at a time. This is safe under React's
 * synchronous rendering model. React 18 concurrent mode interleaves
 * commits, not individual component render calls, so a single
 * EastReactiveComponent's render function runs atomically.
 *
 * @packageDocumentation
 */

/**
 * A reactive tracker collects dependency keys during render
 * and provides a subscribable store for those keys.
 */
export interface ReactiveTracker {
    /** A short identifier for snapshot keys (e.g. "s" for state, "d" for data) */
    readonly id: string;

    /** Start recording which keys are accessed */
    enableTracking(): void;

    /** Stop recording, return the list of accessed keys */
    disableTracking(): string[];

    /**
     * Get the backing store for subscriptions.
     * Returns null if the tracker is not active (e.g. provider not mounted).
     */
    getStore(): ReactiveTrackerStore | null;
}

export interface ReactiveTrackerStore {
    /** Subscribe to a specific key, returns unsubscribe function */
    subscribe(key: string, callback: () => void): () => void;
    /** Get the version of a specific key (for snapshot comparison) */
    getKeyVersion(key: string): number;
}

// =============================================================================
// Observable Registry
// =============================================================================

let trackers: readonly ReactiveTracker[] = [];
let version = 0;
const subscribers = new Set<() => void>();

/**
 * Register a reactive tracker. Returns an unregister function.
 */
export function registerReactiveTracker(tracker: ReactiveTracker): () => void {
    trackers = [...trackers, tracker];
    version++;
    for (const cb of subscribers) cb();
    return () => {
        trackers = trackers.filter(t => t !== tracker);
        version++;
        for (const cb of subscribers) cb();
    };
}

/** Subscribe to tracker list changes (for useSyncExternalStore). */
export function subscribeTrackers(callback: () => void): () => void {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
}

/** Returns the current tracker list. Stable reference until registration changes. */
export function getReactiveTrackers(): readonly ReactiveTracker[] {
    return trackers;
}

/** Returns the current version (for useSyncExternalStore snapshot). */
export function getTrackersVersion(): number {
    return version;
}
