/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Calendar's one date window (#1343): every event kind narrowed through
 * its source of the slice reads the window the Calendar shows, and each such
 * source's range holds it, so its counts, its Save notice and the window agree.
 * The first event source holding a range leads; navigation writes every one,
 * and a range written to one — the range editor's — is written to the others.
 * With no slice, the view alone is the window.
 */
import { useLayoutEffect, useMemo, useState } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType, RecordSlicesChromeType } from "@elaraai/east-ui/internal";
import { usePersistedState, useSlicesReactivity } from "@elaraai/east-ui-components";
import { recordSliceWindow, setRecordSliceWindow } from "@elaraai/east-ui-components/internal";
import { sourcePart } from "../shared/schedule/visibility.js";
import { calendarRange, DAY, dayStart, type CalendarKind, type CalendarRange, type CalendarValue, type CalendarView } from "./model.js";
import { timelineRange } from "./timeline.js";

/** One record Slice's controls. */
type Bind = ValueTypeOf<RecordSliceBindType>;

/** An event kind narrowed through its source of the slice: the kind, and its part. */
export interface CalendarEventPart {
    /** The event kind. */
    readonly kind: CalendarKind;
    /** Its source's part of the slice: the Slice its reads, its counts and its Save notice go through. */
    readonly part: Bind;
}

/** The window and the slice that every Calendar layout consumes. */
export interface CalendarWindow {
    view: CalendarView; setView: (next: CalendarView) => void; range: CalendarRange;
    /** The rail; `undefined` with no slice. */
    chrome: ValueTypeOf<RecordSlicesChromeType> | undefined;
    /** Each event kind narrowed through its source, in the kinds' order. */
    eventParts: readonly CalendarEventPart[];
    /** The event sources that hold the window: each with a range, in the kinds' order. */
    windowParts: readonly CalendarEventPart[];
    /** The rail's affordances. */
    affordances: readonly string[];
    /** Why the window could not be written to a source's range — its indexes answer none alone. */
    error: string | undefined;
}

/**
 * Each event kind narrowed through its source of the slice: the source named
 * after its slot, as the tag hands it the kind (#1343).
 *
 * @param value - The payload
 * @returns Each such kind and its part, in the kinds' order
 */
export function calendarEventParts(value: CalendarValue): CalendarEventPart[] {
    const chrome = value.slice.type === "some" ? value.slice.value : undefined;
    return value.events.flatMap(kind => {
        const part = sourcePart(chrome, kind.key);
        return part === undefined ? [] : [{ kind, part }];
    });
}

/** The window as one range's bounds: the part's half-open range, in epoch milliseconds. */
function sameWindow(part: Bind, from: number, to: number): boolean {
    const window = recordSliceWindow(part);
    return window?.kind === "datetime" && window.min === from && window.max === to;
}

/** The slice is the window's owner when it narrows an event kind; layout and period remain viewer preferences. */
export function useCalendarWindow(value: CalendarValue, key: string, now: Date): CalendarWindow {
    const chrome = value.slice.type === "some" ? value.slice.value : undefined;
    const eventParts = useMemo(() => calendarEventParts(value), [value]);
    const windowParts = useMemo(() => eventParts.filter(({ part }) => part.config.range.type === "some"), [eventParts]);
    const version = useSlicesReactivity(eventParts.map(({ part }) => part.key));
    const affordances = useMemo(() => chrome?.affordances.map(a => a.type) ?? [], [chrome]);
    const [error, setError] = useState<string>();
    const { state, setState } = usePersistedState<CalendarView>(`${key}.view`, {
        layout: value.settings.layout.type, period: value.settings.period.type,
        date: dayStart(value.settings.date.type === "some" ? value.settings.date.value : now).getTime(),
    });
    // The first event source holding a range leads; the others follow it.
    const lead = windowParts.map(({ part }) => recordSliceWindow(part)).find(window => window?.kind === "datetime");
    const from = lead?.min;
    const to = lead?.max;
    const view = useMemo(() => from === undefined || (state.date >= from && state.date < (to ?? from)) ? state : { ...state, date: from }, [state, from, to]);
    const range = useMemo((): CalendarRange => {
        if (from === undefined || to === undefined || to <= from) return view.layout === "timeline" ? timelineRange(view) : calendarRange(view, value.settings);
        const days: Date[] = [];
        for (let at = dayStart(from).getTime(); at < to; at += DAY) {
            const day = new Date(at);
            if (value.settings.weekends || (day.getUTCDay() !== 0 && day.getUTCDay() !== 6)) days.push(day);
        }
        return { from: new Date(from), to: new Date(to), days };
    }, [from, to, view, value.settings]);
    // Every event source that does not hold the window yet takes it: a first mount, a range cleared, or another
    // source's range written by the range editor.
    const write = (min: number, max: number, only: (part: Bind) => boolean) => {
        try {
            for (const { part } of windowParts) if (only(part)) setRecordSliceWindow(part, min, max);
            setError(undefined);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "The dates could not be applied");
        }
    };
    useLayoutEffect(() => {
        const min = range.from.getTime(), max = range.to.getTime();
        if (windowParts.some(({ part }) => !sameWindow(part, min, max))) write(min, max, part => !sameWindow(part, min, max));
        // `version` moves with every source's state: a range cleared or written there is followed here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [windowParts, range.from, range.to, version]);
    const setView = (next: CalendarView) => {
        setState(next);
        const window = next.layout === "timeline" ? timelineRange(next) : calendarRange(next, value.settings);
        write(window.from.getTime(), window.to.getTime(), () => true);
    };
    return { view, setView, range, chrome, eventParts, windowParts, affordances, error };
}
