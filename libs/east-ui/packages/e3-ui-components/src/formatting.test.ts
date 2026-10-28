/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * One formatter (#850) in e3-ui-components — the experiment's numbers and its
 * journal print in the app's locale, and every date its UTC day. Each runs
 * under timezones either side of UTC, where a local reading would move an
 * instant to another day.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
    decodeBeast2For, encodeBeast2For, none, some, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Experiment } from "@elaraai/e3-ui/internal";
import { formatters } from "@elaraai/east-ui-components";
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
    test("the experiment speaks a number whole, else to one decimal; a value that rounds to zero is unsigned", () => {
        expect(fmt(1234, en)).toBe("1,234");
        expect(fmt(5.25, de)).toBe("5,3");
        expect(fmt(-0.04, en)).toBe("0.0");
        expect(signed(5.25, en)).toBe("+5.3");
        expect(signed(-5.25, de)).toBe("-5,3");
        expect(signed(-0.04, en)).toBe("0.0");
    });
});
