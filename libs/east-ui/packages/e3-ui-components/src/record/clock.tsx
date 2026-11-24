/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record's clock (`Record - DX Proposal.md` §2.3, C7) and its day: the
 * instant its ages count hours to — the browser's, read as the Record mounts
 * and again at each whole minute — and the day its cells from data are read
 * and written at (#1559) and its ages count days and weeks to — the day its
 * page sets (`day`, #1746), as the page gives it, else the viewer's own. An
 * age column's count of a row's moment is taken against them. Every part that
 * counts reads the one time, so a day that turns over where the viewer is, or
 * a day the page sets, moves the age cells, their stale dots, the footer's
 * count, the inspector's facts and the cells from data together.
 *
 * @packageDocumentation
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { IntegerType, lessFor } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { useNow } from "../shared/time/now-line.js";
import { SheetDayProvider, sheetDayOf } from "../sheet/day.js";
import type { SheetColumnMeta } from "../sheet/model.js";
import type { SheetCellValue } from "../sheet/values.js";

/** The Record's time: the instant an age counts hours to, and the day everything else that counts reads. */
export interface RecordTime {
    /** Now, as the Record's clock last read it: what an age in hours counts to. */
    now: Date;
    /** The Record's day — the page's, as it gives it, else the viewer's own ({@link sheetDayOf}): what its cells from data are read and written at, and an age in days or weeks counts to. */
    day: Date;
}

const RecordClockContext = createContext<RecordTime | undefined>(undefined);

/**
 * Provides the Record's time to the parts under it, and its day to the sheet's. The day is decided here alone: the
 * page's, as it gives it — never rounded — else the viewer's own, which turns over at their midnight. As the clock
 * moves, only the parts that read it draw again — the sheet's, only as the day changes.
 *
 * @param props - The day the page sets, where it sets one, and the parts under it
 * @returns The provider
 */
export function RecordClock({ day: given, children }: { day: Date | undefined; children: ReactNode }) {
    const now = useNow(undefined);
    // One Date while the day holds, however often the clock moves or the page hands its day again.
    const ms = (given ?? sheetDayOf(now)).getTime();
    const day = useMemo(() => new Date(ms), [ms]);
    const time = useMemo((): RecordTime => ({ now, day }), [now, day]);
    return <RecordClockContext.Provider value={time}><SheetDayProvider day={day}>{children}</SheetDayProvider></RecordClockContext.Provider>;
}

/**
 * Reads the Record's time; a part outside a {@link RecordClock} is a mistake of the frame's, and throws.
 *
 * @returns Now, as the Record's clock last read it, and the Record's day
 */
export function useRecordTime(): RecordTime {
    const time = useContext(RecordClockContext);
    if (time === undefined) throw new Error("A Record part reads the clock outside a RecordClock");
    return time;
}

/** An age column's count at a row: the hours since the row's moment, or the days or weeks since its date, against the column's threshold. */
export interface RecordAge {
    /** Whole units since the moment. */
    n: bigint;
    /** What one counts. */
    unit: "hours" | "days" | "weeks";
    /** At or past this many, the row is stale. */
    threshold: bigint | undefined;
    /** Whether the count has reached the threshold. */
    stale: boolean;
}

const integerLess = lessFor(IntegerType);

/**
 * An age column's count at a row — its `elapsed`, from the row's moment: its hours to the Record's now, its days and
 * weeks to the Record's day — the page's, else the viewer's own ({@link sheetDayOf}), turning over at their midnight —
 * as the columns read at the day do.
 *
 * @param meta - The column
 * @param cell - The row's moment: a DateTime, else none
 * @param time - The Record's time
 * @returns The count; `undefined` for a column that counts nothing, a row with no moment, or an `elapsed` that fails
 */
export function ageOf(meta: SheetColumnMeta, cell: SheetCellValue | undefined, time: RecordTime): RecordAge | undefined {
    const kind = meta.raw.kind;
    if (kind.type !== "age" || cell?.type !== "DateTime") return undefined;
    let n: bigint;
    try {
        n = kind.value.elapsed(cell.value, kind.value.unit.type === "hours" ? time.now : time.day);
    } catch (err) {
        console.error(`[Record] elapsed failed on column "${meta.key}":`, err);
        return undefined;
    }
    const threshold = getSomeorUndefined(kind.value.stale);
    return { n, unit: kind.value.unit.type, threshold, stale: threshold !== undefined && !integerLess(n, threshold) };
}
