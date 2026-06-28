/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Pages>` content-switcher renderer.
 *
 * `Pages` is a `ReactiveComponent` whose `render()` reads `nav.current()` and
 * `match`es the active route to its page body. That makes the switcher re-render
 * on navigation (#114) — but the **bodies it produces** are themselves
 * `ReactiveComponent` values (each `<Reactive>` page), differing only by a
 * `render` closure. East's `equalFor` treats every function value as equal
 * (`comparison.ts` — `"Function" → return true`), so the memo on the generic
 * `EastChakraComponent` that renders the active body sees overview-body ===
 * detail-body and **bails the swap** — the page never changes until a full
 * remount (e.g. a task re-decode).
 *
 * The fix: key the reactive subtree by the **route blob's store version** at the
 * nav key. Navigation is the only thing that bumps it, so the active page (and
 * its subscriptions) remount exactly on route change — and not on unrelated data
 * churn. This sidesteps the function-blind memo entirely.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useSyncExternalStore } from "react";
import { EastReactiveComponent, type ReactiveValue } from "../reactive/index.js";
import { getStore } from "../platform/state-runtime.js";

/** The `Pages` variant payload: the reactive `render` plus the nav store key. */
interface PagesValue extends ReactiveValue {
    /** The store key the nav path-stack is persisted under (`nav.key`). */
    navKey: string;
}

export const EastChakraPages = memo(function EastChakraPages({ value, storageKey }: { value: PagesValue; storageKey: string }) {
    const navKey = value.navKey;
    // Re-render (and thus recompute the key) whenever the route blob at navKey
    // changes — i.e. on every navigation, and only then.
    const subscribe = useCallback((cb: () => void) => getStore().subscribe(navKey, cb), [navKey]);
    const getVersion = useCallback(() => getStore().getKeyVersion(navKey), [navKey]);
    const routeVersion = useSyncExternalStore(subscribe, getVersion);

    // `key` forces a fresh mount of the Pages reactive node on route change, so the
    // active page swaps (bypassing the function-blind memo) AND mounts with fresh
    // dependency subscriptions for the new route.
    return <EastReactiveComponent key={`route:${routeVersion}`} value={value} storageKey={storageKey} />;
}, (prev, next) => prev.value.navKey === next.value.navKey && prev.storageKey === next.storageKey);
