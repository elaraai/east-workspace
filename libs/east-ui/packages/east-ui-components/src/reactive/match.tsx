/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Match>` hosting-slot renderer (#333).
 *
 * `Match` is the general form of the `<Pages>` remount mechanism: where Pages
 * keys the reactive subtree by the nav store's version at `navKey`, Match has
 * no store key — the `on` expression may read any State/Data — so it keys by
 * the **active case name**, evaluated through the same dependency tracking a
 * `Reactive` render uses. Tag change ⇒ the mounted case (and its
 * subscriptions) remounts; same-tag payload/data churn re-renders through the
 * inner reactive's own subscriptions without losing mounted state.
 *
 * @packageDocumentation
 */

import { memo, useCallback } from "react";
import { equivalentFor, FunctionType, StringType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import { EastReactiveComponent, useTrackedEvaluation, type ReactiveValue } from "./index.js";
import { EastErrorDisplay, toEastErrorInfo } from "./error-display.js";

/** Memo comparers for the two closures — a rebuilt Match whose `render` or
 *  `tag` captured new data must re-evaluate with it (#809). */
const renderEqual = equivalentFor(FunctionType([], UIComponentType));
const tagEqual = equivalentFor(FunctionType([], StringType));

/** The `Match` variant payload: the reactive `render` plus the active-case probe. */
export interface MatchValue extends ReactiveValue {
    /** Yields the active case name — re-reads the `on` variant (tracked). */
    tag: () => string;
}

export const EastChakraMatch = memo(function EastChakraMatch({ value, storageKey }: { value: MatchValue; storageKey: string }) {
    // Evaluate the active case name with dependency tracking, so any State/Data
    // the `on` variant reads re-evaluates it on change.
    const tagFn = useCallback(() => value.tag(), [value]);
    const { result } = useTrackedEvaluation(tagFn);

    if (!result.ok) {
        const info = toEastErrorInfo(result.error);
        return <EastErrorDisplay title="East Render Error" message={info.message} stack={info.stack} context={storageKey} />;
    }

    // `key` forces a fresh mount of the Match reactive node on tag change: the
    // new case mounts with fresh local state and fresh dependency subscriptions.
    return <EastReactiveComponent key={`case:${result.value}`} value={value} storageKey={storageKey} />;
}, (prev, next) => renderEqual(prev.value.render, next.value.render)
    && tagEqual(prev.value.tag, next.value.tag)
    && prev.storageKey === next.storageKey);
