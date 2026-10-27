/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useRef, useMemo, useState, useSyncExternalStore, useCallback } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { UIComponentType } from "@elaraai/east-ui/internal";
import { EastChakraComponent } from "../component.js";
import {
    getReactiveTrackers,
    subscribeTrackers,
    getTrackersVersion,
} from "./tracker.js";
import { EastErrorBoundary, EastErrorDisplay, toEastErrorInfo } from "./error-display.js";
import { ReadScope } from "./read-scope.js";

/**
 * Value type for ReactiveComponent variant.
 */
export interface ReactiveValue {
    render: () => ValueTypeOf<typeof UIComponentType>;
}

/** The outcome of one tracked evaluation — the value, or the error to display. */
export type TrackedResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** The keys an evaluation read, by tracker id: each key with its version as the evaluation first read it. */
type Reads = ReadonlyMap<string, ReadonlyMap<string, number>>;

/** A tracker's keys where it read none. */
const NO_READS: ReadonlyMap<string, number> = new Map();

/**
 * Evaluates an East closure with dependency tracking and re-evaluates when the
 * State/Data keys it read change.
 *
 * @remarks
 * The shared engine behind {@link EastReactiveComponent} (evaluating a
 * `render()` subtree) and `EastChakraMatch` (evaluating the active-case
 * `tag()`). Trackers are pluggable — State registers at module load, Data
 * registers when ReactiveDatasetProvider mounts; the hook re-evaluates when
 * trackers are added/removed via useSyncExternalStore on the tracker registry.
 * Errors thrown by `fn` are captured (with the dependencies read up to the
 * throw, so the evaluation re-runs when they change) rather than propagated.
 *
 * An evaluation runs once a change of what it read: its result is held while
 * the keys it read stand at the versions it read them at — each tracker
 * reports each key with its version as the evaluation first read it — so the
 * render that re-keys the subscription after it reads a key it had not — a
 * paged reader walking on to its next window — evaluates nothing again. A key
 * that moved after it was read, while the evaluation still ran, holds nothing,
 * whether it had read the key before or reads it for the first time: a render
 * that writes a State key it has read moves the key in the UI store, and runs
 * again, drawing what the key holds now.
 *
 * @param fn - The closure to evaluate — memoise it (`useCallback`) so the
 *   evaluation is not redone every host render.
 * @returns The current {@link TrackedResult} plus the dependency-version
 *   `snapshot` string it was computed at.
 */
export function useTrackedEvaluation<T>(fn: () => T): { result: TrackedResult<T>; snapshot: string } {
    // Re-render when trackers are added/removed (e.g. DatasetProvider mounts)
    const trackersVersion = useSyncExternalStore(subscribeTrackers, getTrackersVersion);
    const trackers = getReactiveTrackers();
    const scope = useMemo(() => new ReadScope(), []);

    // Track which keys each tracker records, each with its version as it was read
    const depsRef = useRef<Reads>(new Map());
    // ...and a signature of that key SET. An evaluation can discover keys it did
    // not read last time — a paged reader walks one window further each time a
    // window lands — and `useSyncExternalStore` re-subscribes only when
    // `subscribe`'s identity changes. Keeping the keys in a ref alone therefore
    // pinned the subscription to the FIRST evaluation's keys, so the second
    // window's landing notified nobody and the reader stalled (#580). The
    // signature is what re-keys `subscribe` when the set actually moves.
    const depsSigRef = useRef<string>("");
    const [depsSig, setDepsSig] = useState("");
    // The last evaluation: the versions of the keys it read, as it read them, and the snapshot it ran at, which keys its
    // result while the keys stand at those versions.
    const ranRef = useRef<{ readonly read: string; readonly at: string } | undefined>(undefined);

    // A snapshot of the keys an evaluation read, across the trackers: each at its version now, or as it was read.
    const snapshotOf = useCallback((deps: Reads, asRead: boolean): string => {
        const parts: string[] = [];
        for (const t of trackers) {
            const store = t.getStore();
            if (!store) continue;
            const keys: string[] = [];
            for (const [key, read] of deps.get(t.id) ?? NO_READS) keys.push(`${t.id}:${key}:${asRead ? read : store.getKeyVersion(key)}`);
            parts.push(keys.join(","));
        }
        return parts.join("|");
    }, [trackers]);

    // Execute fn with dependency tracking for all registered trackers.
    // Returns either a successful result or an error to display.
    const executeWithTracking = useCallback((): TrackedResult<T> => {
        for (const t of trackers) t.enableTracking();

        try {
            const result = scope.run(fn);
            const deps = new Map<string, ReadonlyMap<string, number>>();
            for (const t of trackers) {
                deps.set(t.id, t.disableTracking());
            }
            depsRef.current = deps;
            depsSigRef.current = depsSignature(deps);
            return { ok: true, value: result };
        } catch (e) {
            // Capture deps even on error so we re-render when they change
            const deps = new Map<string, ReadonlyMap<string, number>>();
            for (const t of trackers) {
                deps.set(t.id, t.disableTracking());
            }
            depsRef.current = deps;
            depsSigRef.current = depsSignature(deps);
            return { ok: false, error: e };
        }
    }, [fn, trackers, scope]);

    // Subscribe to the keys we depend on across all trackers
    const subscribe = useCallback((cb: () => void) => {
        const unsubs: (() => void)[] = [];
        for (const t of trackers) {
            const store = t.getStore();
            if (!store) continue;
            const keys = depsRef.current.get(t.id) ?? NO_READS;
            for (const key of keys.keys()) {
                unsubs.push(store.subscribe(key, cb));
            }
        }
        return () => unsubs.forEach(fn => fn());
        // Re-keyed on the dependency SET, not just `trackers`: a newly-discovered
        // key needs a subscription, and `useSyncExternalStore` only makes one
        // when `subscribe`'s identity changes (#580). `depsSig` is not read in
        // the body — the keys come from the ref, which is always current — so it
        // is a deliberate re-key trigger rather than a value dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- depsSig re-keys the subscription; the keys themselves come from depsRef
    }, [trackers, depsSig]);

    // Snapshot based on our dependencies' versions across all trackers
    const getSnapshot = useCallback(() => snapshotOf(depsRef.current, false), [snapshotOf]);

    const snapshot = useSyncExternalStore(subscribe, getSnapshot);

    // What the result is keyed on: the snapshot the last evaluation ran at, while the keys it read stand at the versions
    // it read them at — the render that re-keys the subscription reads them over a key set of its own, the same
    // versions — else the snapshot now: a key moved since it was read, while the evaluation ran or after it.
    const ran = ranRef.current;
    const at = ran !== undefined && ran.read === snapshot ? ran.at : snapshot;

    // trackersVersion forces re-evaluation when trackers change
    const result = useMemo(() => {
        const next = executeWithTracking();
        ranRef.current = { read: snapshotOf(depsRef.current, true), at };
        return next;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [executeWithTracking, snapshotOf, at, trackersVersion]);

    // Publish the key set the evaluation just read, so `subscribe` re-keys and
    // covers a newly-discovered key. Set DURING RENDER (React's documented
    // adjust-state-while-rendering pattern) rather than from an effect: React
    // re-renders immediately without committing, so the subscription is in place
    // before the browser can paint — no window in which a landing notifies
    // nobody. The guard is what makes it converge: one extra render per
    // dependency-set change, none once the set settles.
    if (depsSigRef.current !== depsSig) setDepsSig(depsSigRef.current);

    return { result, snapshot: at };
}

/** A stable signature of the key set an evaluation read, per tracker. Order is
 *  the tracker registration order, which `executeWithTracking` also walks. */
function depsSignature(deps: Reads): string {
    const parts: string[] = [];
    for (const [id, keys] of deps) parts.push(`${id}:${[...keys.keys()].join(",")}`);
    return parts.join("|");
}

/**
 * Renders a reactive component that re-renders independently when its dependencies change.
 *
 * @remarks
 * This component executes the render function with dependency tracking enabled.
 * It subscribes only to the state and dataset keys that were accessed during rendering,
 * enabling selective re-rendering when those specific keys change.
 */
export function EastReactiveComponent({ value, storageKey }: { value: ReactiveValue; storageKey: string }) {
    const render = useCallback(() => value.render(), [value]);
    const { result, snapshot } = useTrackedEvaluation(render);

    if (!result.ok) {
        const info = toEastErrorInfo(result.error);
        return <EastErrorDisplay title="East Render Error" message={info.message} stack={info.stack} context={storageKey} />;
    }

    if (result.value === undefined || result.value === null) {
        return null;
    }

    return (
        <EastErrorBoundary title="East Render Error" resetKey={snapshot} context={storageKey}>
            <EastChakraComponent value={result.value} storageKey={storageKey} />
        </EastErrorBoundary>
    );
}
