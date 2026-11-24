/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The day a sheet reads and writes its columns from data at (#1559): the
 * `day` an app's `read`, `write` and `mark` are given. A host gives its own
 * ({@link SheetDayProvider}) — the Record's: the day its page sets, as the
 * page gives it, else its clock's, so its cells from data turn over with its
 * age cells (#1746). A sheet under none keeps its own: the browser's local
 * calendar date, at UTC midnight, so a column keyed by date reads the day the
 * viewer is in, wherever they are — read again at each whole minute while it
 * reads anything at the day, and drawn again only when the day turns.
 *
 * An edit is made against the day its editor opened on ({@link useEditDay}):
 * the day a sheet reads and writes at holds while an editor is open, and moves
 * on only once it has closed.
 *
 * @packageDocumentation
 */

import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { DateTimeType, equalFor } from "@elaraai/east";

const SheetDayContext = createContext<Date | undefined>(undefined);
const dayEqual = equalFor(DateTimeType);
const MINUTE_MS = 60_000;

/**
 * The viewer's day an instant falls on, as a sheet's columns from data are given it where no page sets one: its local
 * calendar date, at UTC midnight.
 *
 * @param now - The instant
 * @returns Its day
 */
export function sheetDayOf(now: Date): Date {
    // The one place the viewer's timezone is read on purpose: the day is the date on their own calendar — the instant
    // moved by their offset then, read in UTC as every East DateTime is.
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/**
 * Gives the sheets under it a host's day — one `Date` while the day holds, as the host keeps it, so a sheet reads its
 * columns from data again only as the day changes, however often the host's clock moves.
 *
 * @param props - The host's day, and the parts under it
 * @returns The provider
 */
export function SheetDayProvider({ day, children }: { day: Date; children: ReactNode }) {
    return <SheetDayContext.Provider value={day}>{children}</SheetDayContext.Provider>;
}

/**
 * The day a sheet's columns from data are read and written at: its host's, else its own — read again at each whole
 * minute while it `reads`, the sheet drawn again only as the day turns.
 *
 * @param reads - Whether the sheet reads anything at the day: a column from data, or a mark
 * @returns The day
 */
export function useSheetDay(reads: boolean): Date {
    const given = useContext(SheetDayContext);
    const [own, setOwn] = useState(() => sheetDayOf(new Date()));
    useEffect(() => {
        if (given !== undefined || !reads) return undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const read = (): void => {
            const now = new Date();
            const day = sheetDayOf(now);
            setOwn((was) => (dayEqual(was, day) ? was : day));
            timer = setTimeout(read, MINUTE_MS - (now.getTime() % MINUTE_MS));
        };
        read();
        return () => { if (timer !== undefined) clearTimeout(timer); };
    }, [given, reads]);
    return given ?? own;
}

/**
 * The day a sheet reads and writes at, held while an edit is open on it (east-workspace#1746). An editor's text is
 * typed against the cells as its day read them, and a write decodes a row's cells from data against what that day
 * read: written at another, the typed cell lands on that day's entry, and every cell that differs between the two days
 * with it. So from an edit's opening the day holds — under a cell's editor or a phone's bottom editor, and while the
 * inspector has the keyboard, a field of whose form keeps its text until the keyboard leaves the field for another
 * part — through the commit that closes it, which the sheet writes in the render it closes in; a render later the
 * sheet reads at the day now. The parts that count time — a Record's ages — follow their clock meanwhile.
 *
 * @param now - The day now: the host's, else the viewer's own ({@link useSheetDay})
 * @param editing - Whether an editor of the grid is open
 * @param frame - The frame the sheet is laid in, its inspector with it
 * @returns The day the sheet reads and writes at
 */
export function useEditDay(now: Date, editing: boolean, frame: RefObject<HTMLElement | null>): Date {
    const [typing, setTyping] = useState(false);
    useEffect(() => {
        let leaving: ReturnType<typeof setTimeout> | undefined;
        // In the sheet's own inspector: a field's box, its steppers, its choices.
        const ours = (at: EventTarget | null): boolean =>
            at instanceof Element && frame.current?.contains(at) === true && at.closest("[data-sheet-inspector]") !== null;
        const entered = (event: FocusEvent): void => {
            if (!ours(event.target)) return;
            if (leaving !== undefined) clearTimeout(leaving);
            leaving = undefined;
            setTyping(true);
        };
        // A field commits its text in a microtask of the keyboard's leaving it: the day holds until a task after the
        // keyboard has left the inspector, which its going to another of the inspector's parts takes back.
        const left = (event: FocusEvent): void => {
            if (!ours(event.target)) return;
            if (leaving !== undefined) clearTimeout(leaving);
            leaving = setTimeout(() => { leaving = undefined; setTyping(false); }, 0);
        };
        document.addEventListener("focusin", entered);
        document.addEventListener("focusout", left);
        return () => {
            document.removeEventListener("focusin", entered);
            document.removeEventListener("focusout", left);
            if (leaving !== undefined) clearTimeout(leaving);
        };
    }, [frame]);
    const open = editing || typing;
    const [held, setHeld] = useState(now);
    // Let go a render after the edit closes: the render it closes in writes its commit, at the day it holds.
    useLayoutEffect(() => {
        if (!open) setHeld((was) => (dayEqual(was, now) ? was : now));
    }, [open, now]);
    return held;
}
