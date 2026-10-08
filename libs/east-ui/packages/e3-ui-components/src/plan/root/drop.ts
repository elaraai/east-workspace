/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The canvas as a drag TARGET: library cards land on a row at an instant, and
 * the canvas's own runs, chips, tiles and marks move and resize on it (#825).
 * Rows register their own cells (`RowShell`); this registers the surface
 * those cells name and hands every completed drag to the editing session,
 * which drafts it into the entry its row came from (#880).
 *
 * A target is a named surface (cells are addressed `surface × row × slot`).
 * The cards of the Plan's own library panel — its author's tabs — reach the
 * canvas whether or not it declares an `id` (#1259): the Plan takes its own
 * panel's cards without `sources`. A Library beside the Plan reaches it by the
 * root's `id`, so its cards land only on a canvas that declares one and lists
 * the Library in `sources` (the root's `id` is `none` otherwise, #824). The
 * canvas's own runs, chips, tiles and marks move with or without it (#825):
 * with no `id` the canvas names a surface of its own, which only its panel's
 * cards reach. Either way the editing session must be able to take the
 * gesture — a drop with nowhere to go is a gesture that silently loses work —
 * or nothing registers, so no row lights up and no drag can complete against
 * a canvas that cannot act on it. `canDrop` still vets every drop — at the
 * pointer, and once more before it is delivered — before it becomes a draft.
 *
 * Beside a Plan's event kinds (#1196) the canvas takes their drags too: the
 * Events and Backlog tabs' cards and an author's tab's cards with a `drop`, a
 * card dropped on an event kind's row; the kinds' elements moved and resized
 * on their rows; and an element returned to the Backlog tab, which the
 * surface names as the one library its elements return to — with no trash
 * zone, since nothing of the canvas's is thrown away by a drag. The event
 * kinds judge each and say why not on the ghost (`edit/event-drag.ts`).
 *
 * @packageDocumentation
 */

import { useId, useMemo } from "react";
import { getSomeorUndefined, useDragTarget, type DragEventValue, type DragMeta, type DragTargetConfig } from "@elaraai/east-ui-components";
import { useIRCanDrop, type CanDropFn } from "@elaraai/east-ui-components/internal";
import type { PlanEventDrop } from "../edit/event-drag.js";
import type { PlanRootValue } from "../model.js";
import type { PlanRowDrop } from "../rows/RowShell.js";

/** No library: `data`'s rows take no card. */
const NO_LIBRARIES: readonly string[] = [];

/**
 * Register the canvas as a drop target while `data`'s editing session or its
 * event kinds take a gesture — named by its `id`, or by a surface of its own
 * when it declares none.
 *
 * @param value - The latest root (its `id`, `canDrop`)
 * @param sources - The library ids beside the Plan accepted for `add` drags (data-stable)
 * @param panel - The library ids of the Plan's own panel tabs whose cards land on its rows (data-stable)
 * @param onDrop - Where a completed drag goes — a card's drop, an element's move or resize, an element's return — answering whether it was taken (stable)
 * @param data - Whether `data`'s editing session takes a gesture now
 * @param events - The event kinds' drag and drop (#1196), for a Plan of event kinds
 * @returns The per-row drop registration every droppable row shares, or
 *   `undefined` when the canvas is not a target
 */
export function usePlanDropTarget(
    value: PlanRootValue,
    sources: readonly string[],
    panel: readonly string[],
    onDrop: (event: DragEventValue, meta?: DragMeta) => boolean,
    data: boolean,
    events?: PlanEventDrop,
): PlanRowDrop | undefined {
    const own = useId();
    const enabled = data || events !== undefined;
    const declared = enabled ? getSomeorUndefined(value.id) : undefined;
    const id = enabled ? declared ?? `plan-canvas${own}` : undefined;
    // The libraries whose cards land on `data`'s rows, while its session takes
    // them: the panel's own tabs, always (#1259); a Library beside the Plan, by
    // the canvas's declared id alone.
    const dataLibraries = useMemo(
        () => (!data ? NO_LIBRARIES : declared !== undefined ? [...panel, ...sources] : [...panel]),
        [data, declared, panel, sources]);
    // Every library whose cards the canvas takes: `data`'s, and the event kinds' (#1196).
    const accepted = useMemo(
        () => [...new Set([...dataLibraries, ...(events?.libraries ?? NO_LIBRARIES)])],
        [dataLibraries, events]);
    const cards = dataLibraries.length > 0;
    const libraries = useMemo(() => new Set(dataLibraries), [dataLibraries]);
    const canDropFn = useMemo(
        () => getSomeorUndefined(value.canDrop) as CanDropFn | undefined,
        [value.canDrop],
    );
    // The canvas's veto — the verdict-caching bridge every target shares, so
    // a drag resting over a bucket asks the predicate once, not per move.
    const veto = useIRCanDrop(canDropFn);
    const targetConfig = useMemo((): DragTargetConfig | null => (id !== undefined ? {
        id,
        sources: accepted,
        // A card lands (`add`); the canvas's own elements move and resize on
        // it (#825) — each row says which it takes (`RowShell`'s `accepts`).
        // An event kind's element returns to the Backlog tab (#1196), and to
        // nowhere else: no trash zone shows.
        kinds: { add: accepted.length > 0, move: true, resize: true, remove: events !== undefined, trash: false },
        ...(events !== undefined ? {
            returns: {
                libraries: [events.backlog],
                canDrop: (event: DragEventValue, library: string) => events.returning(event, library).allowed,
                caption: (event: DragEventValue, library: string) => events.returning(event, library).caption,
            },
        } : {}),
        onDrag: onDrop,
    } : null), [id, accepted, events, onDrop]);
    useDragTarget(targetConfig);
    // One registration shared by every droppable row — the per-row part of
    // the coordinate is the row itself, which `RowShell` already knows.
    return useMemo<PlanRowDrop | undefined>(
        () => (id !== undefined ? { surface: id, cards, libraries, data, canDrop: veto, events } : undefined),
        [id, cards, libraries, data, veto, events],
    );
}
