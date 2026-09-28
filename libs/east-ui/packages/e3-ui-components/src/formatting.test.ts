/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * One formatter (#850) in e3-ui-components — a decision constraint's chip, a
 * diff leaf, the experiment's numbers and its journal print in the app's
 * locale, and every date its UTC day. Each runs under timezones either side
 * of UTC, where a local reading would move an instant to another day.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
    DateTimeType, DictType, FloatType, IntegerType, StringType, StructType, VariantType,
    decodeBeast2For, encodeBeast2For, none, some, toEastTypeValue, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Experiment, judgementInputType } from "@elaraai/e3-ui/internal";
import { formatters } from "@elaraai/east-ui-components";
import { formatConstraint } from "./decision/constraint-format.js";
import { constraintContractOf, type ConstraintContract } from "./decision/contract.js";
import { formatLeafValue } from "./diff/format.js";
import { deriveView, fmt, signed, type ConfigValue, type JournalRowValue } from "./experiment/derive.js";

/** 01:30 on Monday 29 June, UTC — west of UTC, still Sunday the 28th. */
const EARLY = new Date(Date.UTC(2026, 5, 29, 1, 30));
/** 23:30 on Monday 29 June, UTC — east of UTC, already Tuesday the 30th. */
const LATE = new Date(Date.UTC(2026, 5, 29, 23, 30));
const en = formatters("en-US");
const de = formatters("de-DE");

/** A value as the surface holds it: decoded from East's own encoding. */
function stored<T extends EastType>(type: T, value: ValueTypeOf<T>): ValueTypeOf<T> {
    return decodeBeast2For(type)(encodeBeast2For(type)(value));
}

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
    { tz: "America/Los_Angeles", moved: EARLY, localDayOf: "28", east: "2026-06-29T01:30:00.000" },
    { tz: "Pacific/Kiritimati", moved: LATE, localDayOf: "30", east: "2026-06-29T23:30:00.000" },
])("dates are UTC — TZ=$tz (#850)", ({ tz, moved, localDayOf, east }) => {
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

    test("a diff leaf's DateTime prints its exact UTC instant, as East prints it", () => {
        expect(formatLeafValue(toEastTypeValue(DateTimeType), moved, de)).toBe(east);
    });

    test("a journal row's weekday is its UTC day, and its effect is in the locale", () => {
        const config: ConfigValue = stored(Experiment.Types.Config, {
            treatment: "curing", outcome: "strength", common_causes: [], categorical: none,
            method: none, estimand: none, refute: none, dose_feature: none, min_overlap: none,
            min_treatment_variation: none, bootstrap: none, random_state: none, strong_overlap: none,
            evalue_floor: none, expected_sign: none,
        });
        const [row]: JournalRowValue[] = stored(Experiment.Types.Journal, [{
            config, adjusted: some(5.25), naive: 1.0, verdict: variant("causal", null),
            committed_by: "analyst", committed_at: moved, preset: none,
        }]);
        // Three days on: within the week, so the row says its weekday.
        const now = new Date(Date.UTC(2026, 6, 2, 12, 0));
        const german = deriveView(config, config, [], null, [row!], undefined, 0, now, undefined, de);
        expect(german.journal?.[0]?.when).toBe("Mo");
        expect(german.journal?.[0]?.effect).toBe("+5,3");
        expect(deriveView(config, config, [], null, [row!], undefined, 0, now, undefined, en).journal?.[0]?.when).toBe("Mon");
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

    test("a diff leaf: an integer as East prints it, a float as East prints it in the locale's decimal separator", () => {
        const integer = toEastTypeValue(IntegerType);
        const float = toEastTypeValue(FloatType);
        expect(formatLeafValue(integer, 2026n, de)).toBe("2026");
        expect(formatLeafValue(integer, 1234567n, en)).toBe("1234567");
        expect(formatLeafValue(float, 42, en)).toBe("42.0");
        expect(formatLeafValue(float, 42, de)).toBe("42,0");
        expect(formatLeafValue(float, 1234.567, en)).toBe("1234.567");
        expect(formatLeafValue(float, 1234.567, de)).toBe("1234,567");
        // Every digit: a change past the fourth decimal stays visible.
        expect(formatLeafValue(float, 0.12345, en)).toBe("0.12345");
        expect(formatLeafValue(float, 0.12346, en)).toBe("0.12346");
    });

    test("the experiment speaks a number whole, else to one decimal; a value that rounds to zero is unsigned", () => {
        expect(fmt(1234, en)).toBe("1,234");
        expect(fmt(5.25, de)).toBe("5,3");
        expect(fmt(-0.04, en)).toBe("0.0");
        expect(signed(5.25, en)).toBe("+5.3");
        expect(signed(-5.25, de)).toBe("-5,3");
        expect(signed(-0.04, en)).toBe("0.0");
    });
});
