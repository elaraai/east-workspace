/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A tracked read without React (#815) — the framework-free twin of
 * `useTrackedEvaluation`, for state that lives in a plain store rather than in
 * a component.
 *
 * A run records which keys the closure read in every registered tracker, then
 * subscribes to exactly those keys, replacing the previous run's
 * subscriptions. A later run can discover keys the earlier one did not read (a
 * paged reader walks one window further each time a window lands), and those
 * are covered from that run on (#580). The tracker REGISTRY is watched too,
 * so a tracker that registers after the first run (the Data tracker, when its
 * provider mounts) invalidates it.
 *
 * Tracking uses the trackers' module-level recording state, so a run must not
 * overlap another tracked evaluation. Runs happen in event handlers, store
 * notifications and effects, never inside a component's render.
 *
 * @packageDocumentation
 */

import type { option } from "@elaraai/east";
import { getReactiveTrackers, subscribeTrackers } from "./tracker.js";
import { ReadScope } from "./read-scope.js";

/** The outcome of one tracked run — the value, or what the closure threw. */
export type TrackedReadResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** A tracked read's handle — run a closure under tracking; release the subscriptions. */
export interface TrackedRead {
    /**
     * Run `fn` with every registered tracker recording, and subscribe to the
     * keys it read (replacing the previous run's subscriptions). A run after
     * {@link TrackedRead.release} subscribes afresh.
     *
     * @param fn - The closure to evaluate
     * @returns Its value, or the error it threw (the keys it read up to the
     *   throw are subscribed either way, so a retry follows them)
     */
    run<T>(fn: () => T): TrackedReadResult<T>;
    /**
     * Drop every subscription, the registry watch included, until the next
     * run. A notification already on its way when this is called reaches
     * nobody.
     */
    release(): void;
}

/**
 * Create a tracked read.
 *
 * @param onInvalidate - Called when a key the last run read changes, or when
 *   the tracker registry does. It typically runs the read again.
 * @returns The handle
 */
export function createTrackedRead(onInvalidate: () => void): TrackedRead {
    const scope = new ReadScope();
    let keyUnsubs: (() => void)[] = [];
    let registryUnsub: (() => void) | undefined;
    let released = false;
    // A notification can arrive after `release` (a landing already queued):
    // it must not reach a store that stopped listening.
    const notify = () => { if (!released) onInvalidate(); };
    const clearKeys = () => {
        for (const unsub of keyUnsubs) unsub();
        keyUnsubs = [];
    };
    return {
        run<T>(fn: () => T): TrackedReadResult<T> {
            released = false;
            const trackers = getReactiveTrackers();
            for (const t of trackers) t.enableTracking();
            let outcome: TrackedReadResult<T>;
            try {
                outcome = { ok: true, value: scope.run(fn) };
            } catch (error) {
                outcome = { ok: false, error };
            }
            // Always disarm every tracker, whatever `fn` did — a tracker left
            // recording would attribute the next component's reads to us.
            const read = trackers.map((t) => ({ t, keys: t.disableTracking() }));
            clearKeys();
            for (const { t, keys } of read) {
                const store = t.getStore();
                if (store === null) continue;
                for (const key of keys) keyUnsubs.push(store.subscribe(key, notify));
            }
            registryUnsub ??= subscribeTrackers(notify);
            return outcome;
        },
        release() {
            released = true;
            scope.clear();
            clearKeys();
            registryUnsub?.();
            registryUnsub = undefined;
        },
    };
}

/** Wait on exactly the dependencies a bounded read discovered, never poll. */
export function awaitTracked<T>(read: () => option<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        let done = false;
        let queued = false;
        const enqueue = () => {
            if (done || queued) return;
            queued = true;
            queueMicrotask(run);
        };
        const tracked = createTrackedRead(enqueue);
        const run = () => {
            queued = false;
            if (done) return;
            const result = tracked.run(read);
            if (!result.ok || result.value.type === "some") {
                done = true;
                tracked.release();
                if (!result.ok) reject(result.error);
                else if (result.value.type === "some") resolve(result.value.value);
            }
        };
        enqueue();
    });
}
