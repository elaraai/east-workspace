/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * One formatter (#850) in e3-ui-components — a decision constraint's chip
 * prints in the app's locale, and every date its UTC day. Each runs under timezones either side
 * of UTC, where a local reading would move an instant to another day.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
    DateTimeType, DictType, FloatType, IntegerType, StringType, StructType, VariantType,
    toEastTypeValue, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { judgementInputType } from "@elaraai/e3-ui/internal";
import { formatters } from "@elaraai/east-ui-components";
import { formatConstraint } from "./decision/constraint-format.js";
import { constraintContractOf, type ConstraintContract } from "./decision/contract.js";

/** 01:30 on Monday 29 June, UTC — west of UTC, still Sunday the 28th. */
const EARLY = new Date(Date.UTC(2026, 5, 29, 1, 30));
/** 23:30 on Monday 29 June, UTC — east of UTC, already Tuesday the 30th. */
const LATE = new Date(Date.UTC(2026, 5, 29, 23, 30));
const en = formatters("en-US");
const de = formatters("de-DE");

/** A solution's contract as the chips read it: off a judgements dataset's type. */
function contractOf(contract: EastType): ConstraintContract {
    return constraintContractOf(toEastTypeValue(DictType(StringType, judgementInputType(contract))))!;
}

/** A contract whose levers carry a bare date, an op over a Float, a bare
 *  Integer, and a range. */
const Levers = VariantType({
    deadline: DateTimeType,
    budget: VariantType({ atMost: FloatType }),
    year: IntegerType,
    load: VariantType({ between: StructType({ min: FloatType, max: FloatType }) }),
});
const levers = contractOf(Levers);

/** The day of the month in the process's timezone — what a local reading prints. */
const localDay = (d: Date): string => new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(d);

describe.each([
    { tz: "America/Los_Angeles", moved: EARLY, localDayOf: "28" },
    { tz: "Pacific/Kiritimati", moved: LATE, localDayOf: "30" },
])("dates are UTC — TZ=$tz (#850)", ({ tz, moved, localDayOf }) => {
    beforeEach(() => { vi.stubEnv("TZ", tz); });
    afterEach(() => { vi.unstubAllEnvs(); });

    test("the process really is in that timezone (a local reading would move the day)", () => {
        expect(localDay(moved)).toBe(localDayOf);
    });

    test("a constraint's date prints its UTC month and day, in the app's locale", () => {
        const deadline: ValueTypeOf<typeof Levers> = variant("deadline", moved);
        expect(formatConstraint(deadline, levers, undefined, en)).toEqual({ lever: "deadline", op: "·", value: "Jun 29" });
        expect(formatConstraint(deadline, levers, undefined, de).value).toBe("29. Juni");
    });
});

describe("numbers (#850)", () => {
    test("a constraint's number is data: every digit, never grouped, the locale's decimal separator", () => {
        const budget: ValueTypeOf<typeof Levers> = variant("budget", variant("atMost", 12000.5));
        expect(formatConstraint(budget, levers, undefined, en)).toEqual({ lever: "budget", op: "at most", value: "12000.5" });
        expect(formatConstraint(budget, levers, undefined, de).value).toBe("12000,5");
        const year: ValueTypeOf<typeof Levers> = variant("year", 2026n);
        expect(formatConstraint(year, levers, undefined, de).value).toBe("2026");
        const load: ValueTypeOf<typeof Levers> = variant("load", variant("between", { min: 0.5, max: 1.25 }));
        expect(formatConstraint(load, levers, undefined, de)).toEqual({ lever: "load", op: "between", value: "0,5 – 1,25" });
    });
});
