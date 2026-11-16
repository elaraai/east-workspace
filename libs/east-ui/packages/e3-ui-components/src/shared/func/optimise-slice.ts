/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A request's `slice` (east-workspace#1622, rule 1): each rail source's
 * narrowing by the source's name, as a read of that source carries it — the
 * viewer's choices under the page's scope (#1621). Read as the run starts, so
 * a request says the narrowing its person was looking at. A fit's request
 * carries the page's scope alone ({@link fitScope}, east-workspace#1624): the
 * rail's own choices are never sent to a fit.
 *
 * @packageDocumentation
 */

import { SortedMap, StringType, compareFor, type ValueTypeOf } from "@elaraai/east";
import { recordSliceBase, recordSliceScoped } from "@elaraai/east-ui/internal";
import type { OptimiseSliceType } from "@elaraai/e3-ui/internal";
import type { SourcesChrome } from "../schedule/visibility.js";

/** A request's `slice`, decoded: each source's narrowing by its name. */
export type OptimiseSlice = ValueTypeOf<OptimiseSliceType>;

const byName = compareFor(StringType);

/**
 * Each rail source's narrowing now, by the source's name.
 *
 * @param chrome - The builder's rail, as its payload carries it; `undefined` for a builder with no rail
 * @returns The narrowings; none with no rail
 */
export function optimiseSlice(chrome: SourcesChrome | undefined): OptimiseSlice {
    const slice: OptimiseSlice = new SortedMap([], byName);
    for (const part of chrome?.slice.parts ?? []) slice.set(part.source, part.slice.read().where);
    return slice;
}

/**
 * Each rail source's scope, by the source's name (east-workspace#1624, rule 1; #1621): the narrowing the page holds
 * and the viewer cannot clear, its fields alone, each a field's exact values as East prints them — what a fit's
 * request carries, typed as an optimiser's `slice` is, read as every reader of the page reads it. The viewer's choices
 * are not among it: a fit answers whatever the rail shows.
 *
 * @param chrome - The builder's rail, as its payload carries it; `undefined` for a builder with no rail
 * @returns The scopes, a source with none left out; none for a page with no scope
 */
export function fitScope(chrome: SourcesChrome | undefined): OptimiseSlice {
    const scope: OptimiseSlice = new SortedMap([], byName);
    for (const part of chrome?.slice.parts ?? []) {
        if (recordSliceScoped(part.slice)) scope.set(part.source, recordSliceBase(part.slice));
    }
    return scope;
}
