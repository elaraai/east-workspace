/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Pages>` content-switcher renderer.
 *
 * `Pages` is a `ReactiveComponent` whose `render()` reads `nav.current()` and
 * `match`es the active route to its page body, so the switcher re-renders on
 * navigation (#114).
 *
 * The reactive subtree is keyed by the **route blob's store version** at the
 * nav key. Navigation is the only thing that bumps it, so the active page (and
 * its subscriptions) remounts exactly on route change — and not on unrelated
 * data churn. Without the key React would reconcile the new page into the old
 * page's component instances wherever the two trees share a shape, and the new
 * page would open with the old one's local state.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useSyncExternalStore } from "react";
import { equivalentFor, FunctionType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import { EastReactiveComponent, type ReactiveValue } from "../reactive/index.js";
import { getStore } from "../platform/state-runtime.js";

/** The `render` closure's memo comparer — a rebuilt switcher whose closure
 *  captured new data must re-evaluate with it (#809). */
const renderEqual = equivalentFor(FunctionType([], UIComponentType));

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

    // `key` forces a fresh mount of the Pages reactive node on route change: the
    // new page mounts with fresh local state and fresh dependency subscriptions.
    return <EastReactiveComponent key={`route:${routeVersion}`} value={value} storageKey={storageKey} />;
}, (prev, next) => prev.value.navKey === next.value.navKey
    && renderEqual(prev.value.render, next.value.render)
    && prev.storageKey === next.storageKey);
