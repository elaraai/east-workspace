/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The event a pick in Search Records gives the keyboard to (#1398), as the
 * Allocation's bin is given it (`allocation/bin-focus.ts`). The Calendar
 * selects the event and brings it into view, and the element that stands for
 * it where its ring is drawn — a time grid's or a timeline's block, a month's
 * chip, an agenda card's head — takes the focus as it is drawn, so the
 * selection's ring and the focus are on the same event. An event drawn twice —
 * one that runs across midnight, in a day's column each — takes it in the
 * first of its elements drawn. The frame lets it go once taken, once the event
 * is no longer selected, or once the viewer does something else.
 *
 * @packageDocumentation
 */

import { createContext, useContext, useLayoutEffect, type RefObject } from "react";
import { StringType, equalFor } from "@elaraai/east";

const keyEqual = equalFor(StringType);

/** The event given the keyboard, as the Calendar's views read it. */
export interface EventFocus {
    /** The event's key, as `eventKey` prints it, while it waits for its element; `undefined` while no pick waits. */
    readonly id: string | undefined;
    /**
     * Takes the keyboard for an element of the event: `true` for the first that asks, once — the frame lets the event
     * go as it does.
     */
    readonly take: () => boolean;
}

/** No event waits for the keyboard. */
const NO_EVENT: EventFocus = { id: undefined, take: () => false };

/** The event a pick gave the keyboard to, for the Calendar's views. */
export const EventFocusContext = createContext<EventFocus>(NO_EVENT);

/**
 * An element that stands for an event where its ring is drawn: drawn while its event is the one a pick gave the keyboard
 * to, it takes the focus — the first such element drawn.
 *
 * @param id - The event it stands for, as `eventKey` prints it
 * @param element - The element
 */
export function useEventFocus(id: string, element: RefObject<HTMLElement | null>): void {
    const focus = useContext(EventFocusContext);
    const given = focus.id !== undefined && keyEqual(focus.id, id);
    useLayoutEffect(() => {
        if (!given || element.current === null || !focus.take()) return;
        element.current.focus({ preventScroll: true });
    }, [given, focus, element]);
}
