/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan against east-ui's shared contracts (#567, #880) — the cases of
 * east-ui's own contract specs that hold a collection to them, for the Plan,
 * which is e3-ui's (#1177): a trimmed keyed source still hands the canvas
 * whole windows, a lookalike paged source is refused naming the contract, and
 * the canvas's editing wire carries every field of the shared session's.
 */

import { test as hostTest, describe } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { ArrayType, DictType, East, FunctionType, IntegerType, OptionType, StringType, StructType, none, some } from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { EditingSessionFields } from "@elaraai/east-ui/internal";
import { Plan } from "@elaraai/e3-ui/internal";

/** Fifty entries, keyed `r00`…`r49` — wide enough that a window is a genuine window. */
const WideVal = StructType({ n: IntegerType });
const WideDict = DictType(StringType, WideVal);
const WIDE_DICT = new Map(Array.from({ length: 50 }, (_, i) => [`r${String(i).padStart(2, "0")}`, { n: BigInt(i) }] as const));

/** At most this many elements a window, whatever is asked for — as e3 trims a
 *  dataset's pages of wide elements to its byte budget (#829). */
const TRIM = 7n;

const TRIMMED_ENTRIES_PAGE = East.function([IntegerType, IntegerType], OptionType(WideDict), ($, offset, limit) => {
    const all = $.const(WIDE_DICT, WideDict);
    const keys = $.let(all.toArray((_$, _v, k) => k));
    const n = $.let(keys.size());
    const start = $.let(offset.less(n).ifElse(() => offset, () => n));
    const served = $.let(limit.less(TRIM).ifElse(() => limit, () => TRIM));
    const end = $.let(start.add(served).less(n).ifElse(() => start.add(served), () => n));
    return some(all.getKeys(keys.slice(start, end).toSet()));
});
const WIDE_DICT_TOTAL = East.function([], OptionType(IntegerType), ($) => {
    const all = $.const(WIDE_DICT, WideDict);
    return some(all.size());
});
const TRIMMED_ENTRIES = { id: "trimmed-entries", page: TRIMMED_ENTRIES_PAGE, total: WIDE_DICT_TOTAL, seek: none };

/** The canvas's window — its paged arm requires one, and nothing here depends on where it sits. */
const TRIM_WINDOW = { min: new Date("2026-07-06T00:00:00Z"), max: new Date("2026-09-28T00:00:00Z") };

describeEast("Plan over the row-source contract (#567)", (test) => {
    test("a Plan over a trimmed KEYED source gets WHOLE windows", $ => {
        const src = $.const(TRIMMED_ENTRIES, Paged.Types.Source(WideDict));
        $(Assert.equal(src.page(0n, 20n).unwrap("some").size(), 7n));
        const series = $.const([
            Plan.series.span(WideVal, { key: "entries", title: "Entries", label: (_r, k) => k, runs: () => [] }),
        ], ArrayType(Plan.Types.Series(WideVal)));
        const axis = $.const(Plan.axis({ window: TRIM_WINDOW, resolution: "week" }));
        const plan = $.let(Plan.Payload({ axis, data: src, series }));
        const derived = $.let(plan.rows.unwrap("paged"));
        // One row per entry: a whole window is 20 rows, r00…r19 in key order —
        // the one series' block of it (#823: a window is the canvas's blocks).
        const w0 = $.let(derived.page(0n, 20n).unwrap("some").get(0n).rows);
        $(Assert.equal(w0.size(), 20n));
        $(Assert.equal(w0.get(0n).id, Plan.ref("entries", "r00")));
        $(Assert.equal(w0.get(19n).id, Plan.ref("entries", "r19")));
        const w2 = $.let(derived.page(40n, 20n).unwrap("some").get(0n).rows);
        $(Assert.equal(w2.size(), 10n));
    });
}, { platformFns: TestImpl });

/** What a refusal of a lookalike says: the contract, every field in its order at its type. */
const NAMES_THE_CONTRACT = new RegExp(
    "^Error: Plan: a paged source is a platform bind's handle \\(Data\\.bindPaged\\) — " +
    "`\\{ id: String, page: \\(Integer, Integer\\) → Option<C>, total: \\(\\) → Option<Integer>, " +
    "seek: Option<\\(SeekQuery\\) → Option<SeekRange>>, revision: \\(\\) → Option<String>, " +
    "refresh: \\(Option<String>\\) → Null \\}`, its fields in that order at those types, " +
    "or the same without `revision` and `refresh`");

describe("the Plan against the shared contracts", () => {
    hostTest("a lookalike paged source is refused, naming the contract", () => {
        const Rows = ArrayType(WideVal);
        const lookalike = East.value(
            {
                page: East.function([IntegerType, IntegerType], OptionType(Rows), () => some([])),
                total: East.function([], OptionType(IntegerType), () => some(0n)),
            },
            StructType({ page: FunctionType([IntegerType, IntegerType], OptionType(Rows)), total: FunctionType([], OptionType(IntegerType)) }));
        const axis = Plan.axis({ window: { min: new Date("2026-06-29T00:00:00Z"), max: new Date("2026-09-21T00:00:00Z") }, resolution: "week" });
        assert.throws(() => Plan.Root({ axis, data: lookalike as never, series: [] }), NAMES_THE_CONTRACT);
    });

    hostTest("the Plan's editing wire carries every field of the shared session's, at the same type (#880)", () => {
        for (const [field, type] of Object.entries(EditingSessionFields)) {
            assert.equal(Plan.Types.Editing.fields[field as keyof typeof Plan.Types.Editing.fields], type, `Plan.Types.Editing.${field}`);
        }
    });
});
