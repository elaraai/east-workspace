/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record's clock (`Record - DX Proposal.md` §2.3, C7): the instant its
 * age cells count to — the browser's, read as the Record mounts and again at
 * each whole minute — and an age column's count of a row's moment against
 * it. Every part that counts reads the one instant, so a day that turns over
 * moves the age cells, their stale dots, the footer's count, the inspector's
 * facts and the cells from data, read at its day (#1559), together.
 *
 * @packageDocumentation
 */

import { createContext, useContext, type ReactNode } from "react";
import { IntegerType, lessFor } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { useNow } from "../shared/time/now-line.js";
import { SheetDayProvider } from "../sheet/day.js";
import type { SheetColumnMeta } from "../sheet/model.js";
import type { SheetCellValue } from "../sheet/values.js";

const RecordClockContext = createContext<Date | undefined>(undefined);

/**
 * Provides the Record's clock to the parts under it, and its day to the sheet's. As it moves, only the parts that read
 * it draw again — the sheet's, only as the day turns.
 *
 * @param props - The parts under it
 * @returns The provider
 */
export function RecordClock({ children }: { children: ReactNode }) {
    const now = useNow(undefined);
    return <RecordClockContext.Provider value={now}><SheetDayProvider now={now}>{children}</SheetDayProvider></RecordClockContext.Provider>;
}

/**
 * Reads the instant the Record counts to; a part outside a {@link RecordClock} is a mistake of the frame's, and throws.
 *
 * @returns Now, as the Record's clock last read it
 */
export function useRecordNow(): Date {
    const now = useContext(RecordClockContext);
    if (now === undefined) throw new Error("A Record part reads the clock outside a RecordClock");
    return now;
}

/** An age column's count at a row: whole units from the row's moment to now, against the column's threshold. */
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
 * An age column's count at a row — its `elapsed`, from the row's moment to now.
 *
 * @param meta - The column
 * @param cell - The row's moment: a DateTime, else none
 * @param now - The Record's now
 * @returns The count; `undefined` for a column that counts nothing, a row with no moment, or an `elapsed` that fails
 */
export function ageOf(meta: SheetColumnMeta, cell: SheetCellValue | undefined, now: Date): RecordAge | undefined {
    const kind = meta.raw.kind;
    if (kind.type !== "age" || cell?.type !== "DateTime") return undefined;
    let n: bigint;
    try {
        n = kind.value.elapsed(cell.value, now);
    } catch (err) {
        console.error(`[Record] elapsed failed on column "${meta.key}":`, err);
        return undefined;
    }
    const threshold = getSomeorUndefined(kind.value.stale);
    return { n, unit: kind.value.unit.type, threshold, stale: threshold !== undefined && !integerLess(n, threshold) };
}
