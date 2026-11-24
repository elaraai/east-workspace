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
 * @packageDocumentation
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
