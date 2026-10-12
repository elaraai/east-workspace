/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Selecting events on the canvas (#1197, the Calendar's B15): what a run bar,
 * a tile, a chip or a mark of an event kind's rows does with its click. It
 * selects its event and its row, Shift, ⌘ or Ctrl adding the event to the
 * selection or taking it out, and it draws selected while it is — the
 * inspector shows what is selected. An element of anything else — a series
 * over `data`, a row of the Plan's own — selects its row, as it always has.
 *
 * An event's element is keyed by its event as East prints a
 * `Schedule.Types.EventRef` (#1192): a key that reads back as one, of a kind
 * the Plan has, is an event's.
 *
 * @packageDocumentation
 */

import { createContext, useCallback, useContext, useSyncExternalStore, type MouseEvent } from "react";
import { parseFor } from "@elaraai/east";
import { ScheduleEventRefType } from "@elaraai/e3-ui/internal";
import { usePlanDispatch, usePlanResolvers, type PlanElementRefValue } from "../context.js";
import { PlanControllerContext } from "../controller/react.js";
import type { PlanRowValue } from "../model.js";

/** The elements that may be an event's: a bar, a tile, a chip, a mark — never a cell, which is a bucket's. */
export const PLAN_EVENT_ELEMENT_SELECTOR = "[data-run],[data-event],[data-chip],[data-mark]";

/**
 * Whether a row draws the element of a key — a run, a chip, a tile or a mark:
 * the row an event selected from outside the canvas is shown on (#1198).
 *
 * @param row - The row
 * @param key - The element's key
 * @returns Whether one of its elements has that key
 */
export function holdsElement(row: PlanRowValue, key: string): boolean {
    const kind = row.kind;
    switch (kind.type) {
        case "span": return kind.value.runs.some((run) => run.key === key);
        case "cards": return kind.value.chips.some((chip) => chip.key === key);
        case "buckets": return kind.value.events.some((tile) => tile.key === key);
        case "events": return kind.value.marks.some((mark) => mark.key === key);
        default: return false;
    }
}

/**
 * An element ref's own key — what its element is keyed by on its row.
 *
 * @param ref - The element's ref
 * @returns Its key; `undefined` for a cell or a link, which no event is
 */
export function elementKeyOf(ref: PlanElementRefValue): string | undefined {
    switch (ref.type) {
        case "run": return ref.value.run;
        case "event": return ref.value.event;
        case "chip": return ref.value.chip;
        case "mark": return ref.value.mark;
        case "cell": case "link": return undefined;
    }
}

/** Whether an element's key names an event the canvas selects. */
export type PlanSelectable = (key: string) => boolean;

/** Nothing selects: a Plan with no event kinds. */
const NOTHING: PlanSelectable = () => false;

const parseRef = parseFor(ScheduleEventRefType);

/**
 * What the canvas's elements select by: an element's key that reads back as a
 * `Schedule.Types.EventRef` of one of `kinds`.
 *
 * @param kinds - The Plan's event kinds, by slot
 * @returns Whether a key is an event's — each key read once
 */
export function selectableOf(kinds: readonly string[] | undefined): PlanSelectable {
    if (kinds === undefined || kinds.length === 0) return NOTHING;
    const slots = new Set(kinds);
    const read = new Map<string, boolean>();
    return (key) => {
        let held = read.get(key);
        if (held === undefined) {
            const parsed = parseRef(key);
            held = parsed.success && slots.has(parsed.value.kind);
            read.set(key, held);
        }
        return held;
    };
}

/** What the canvas's elements select by — none outside a Plan of event kinds. */
export const PlanSelectableContext = createContext<PlanSelectable>(NOTHING);

/** An element's selection: whether its event selects, whether it is selected, and its click. */
export interface PlanElementSelect {
    /** Its event can be selected: an event kind's element. */
    selectable: boolean;
    /** It is selected. */
    selected: boolean;
    /** Its click — its event selected, or its row; and the author's `onElementClick`. */
    onClick: (e: MouseEvent) => void;
}

const noSubscribe = () => () => undefined;

/**
 * An element's selection — see the module docs.
 *
 * @param rowKey - Its row's key
 * @param key - Its own key
 * @param ref - Its element ref, for the author's `onElementClick`
 * @returns Whether it selects and is selected, and its click
 */
export function usePlanElementSelect(rowKey: string, key: string, ref: PlanElementRefValue): PlanElementSelect {
    const dispatch = usePlanDispatch();
    const { onElementClick } = usePlanResolvers();
    const selectable = useContext(PlanSelectableContext)(key);
    // Only this element's own fact: a selection elsewhere renders nothing here.
    const controller = useContext(PlanControllerContext);
    const selected = useSyncExternalStore(
        controller?.subscribe ?? noSubscribe,
        () => selectable && controller !== null && controller.getSnapshot().store.ui.elements.includes(key),
    );
    const onClick = useCallback((e: MouseEvent) => {
        e.stopPropagation();
        if (selectable) dispatch({ t: "element.select", key, row: rowKey, additive: e.shiftKey || e.metaKey || e.ctrlKey });
        else dispatch({ t: "row.select", key: rowKey });
        onElementClick?.(ref);
    }, [selectable, dispatch, key, rowKey, onElementClick, ref]);
    return { selectable, selected, onClick };
}
