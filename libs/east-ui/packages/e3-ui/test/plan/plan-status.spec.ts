/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An item's status (#1541, U8): `Plan.status(words, tone, { ring? })`, returned
 * as `status` by the map of any data series item — a run, a tile, a chip or a
 * mark — and taken by `Plan.run`, `Plan.event`, `Plan.chip` and `Plan.mark`.
 * It is the builders' one status, as an event kind's status case is. A run
 * map's bare tone and a tile map's `tone` are refused naming it, word for
 * word. What an item draws of its status is e3-ui-components' to check.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, OptionType, StringType, StructType, equalFor, isTypeEqual, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { EventStateType, StatusTokenType } from "@elaraai/east-ui";
import { Plan, Schedule, Schematic } from "@elaraai/e3-ui/internal";

const W27 = new Date("2026-06-29T00:00:00Z");
const W28 = new Date("2026-07-06T00:00:00Z");
const W29 = new Date("2026-07-13T00:00:00Z");
const axis = Plan.axis({ window: { min: W27, max: new Date("2026-09-21T00:00:00Z") }, resolution: "week" });

type Status = ValueTypeOf<typeof Plan.Types.Status>;
const sameStatus = equalFor(Plan.Types.Status);
const sameStatuses = equalFor(ArrayType(OptionType(Plan.Types.Status)));
/** A status as the wire holds it. */
const status = (label: string, tone: ValueTypeOf<typeof StatusTokenType>["type"], ring = false): Status => ({ label, tone: variant(tone, null), ring });

/** What `build` throws; `""` when it builds. */
function refusal(build: () => unknown): string {
    try {
        build();
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

describe("Plan.status builds an item's status (#1541, U8)", () => {
    test("its words and its tone, an open ring only where asked", () => {
        const built = East.compile(East.function([], ArrayType(Plan.Types.Status), () => [
            Plan.status("Over dwell", "warning"),
            Plan.status("Blocked", "danger", { ring: false }),
            Plan.status("Tentative", "info", { ring: true }),
            Plan.status("Done", "success"),
            Plan.status("Parked", "neutral"),
        ]), [])();
        assert.ok(equalFor(ArrayType(Plan.Types.Status))(built, [
            status("Over dwell", "warning"), status("Blocked", "danger"), status("Tentative", "info", true),
            status("Done", "success"), status("Parked", "neutral"),
        ]));
    });

    test("its words, its tone and its ring may each be an expression", () => {
        const built = East.compile(East.function([StringType, StatusTokenType], Plan.Types.Status, (_$, words, tone) =>
            Plan.status(East.str`${words} · 3 d`, tone, { ring: words.equal("Hold") })), [])("Hold", variant("danger", null));
        assert.ok(sameStatus(built, status("Hold · 3 d", "danger", true)));
    });

    test("it is the builders' one status: an event kind's status case and a Schematic item's are the same type", () => {
        assert.ok(isTypeEqual(Plan.Types.Status, Schedule.Types.Status));
        assert.ok(isTypeEqual(Plan.Types.Status, Schematic.Types.Status));
        // One definition, given under three names: no builder holds a copy that could drift.
        assert.equal(Plan.Types.Status, Schedule.Types.Status);
        assert.equal(Plan.Types.Status, Schematic.Types.Status);
    });
});

describe("a run, a tile, a chip and a mark each carry a status (#1541, U8)", () => {
    test("the builders take it: `status` on Plan.run, Plan.event, Plan.chip and Plan.mark, none where left out", () => {
        const Built = StructType({
            run: Plan.Types.Run, bare: Plan.Types.Run, tile: Plan.Types.BucketEvent, chip: Plan.Types.Chip, mark: Plan.Types.EventMark,
        });
        const built = East.compile(East.function([], Built, () => ({
            run: Plan.run({ key: "r", start: W27, end: W28, label: "RUN", state: "actual", status: Plan.status("Over dwell", "warning") }),
            bare: Plan.run({ key: "b", start: W27, end: W28, label: "RUN", state: "actual" }),
            tile: Plan.event({ key: "t", at: W27, state: "confirmed", status: Plan.status("Late", "danger") }),
            chip: Plan.chip({ key: "c", from: W27, to: W28, label: "80h", state: "confirmed", status: Plan.status("Short", "info", { ring: true }) }),
            mark: Plan.mark({ key: "m", at: W27, kind: "milestone", status: Plan.status("Missed", "danger") }),
        })), [])();
        assert.ok(sameStatuses(
            [built.run.status, built.bare.status, built.tile.status, built.chip.status, built.mark.status],
            [some(status("Over dwell", "warning")), none, some(status("Late", "danger")), some(status("Short", "info", true)), some(status("Missed", "danger"))],
        ));
    });

    test("a map returns it: each item of a span, a bucket, a cards and an events series, as its row's data says", () => {
        const Item = StructType({ at: DateTimeType, to: DateTimeType, state: EventStateType, late: OptionType(StringType) });
        const Row = StructType({ items: DictType(StringType, Item) });
        const Rows = DictType(StringType, Row);
        const rows: ValueTypeOf<typeof Rows> = new Map([["p03", { items: new Map([
            ["a", { at: W27, to: W28, state: variant("confirmed", null), late: none }],
            ["b", { at: W28, to: W29, state: variant("confirmed", null), late: some("2 d late") }],
        ]) }]]);
        const root = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(rows, Rows);
            // An `Option` of a status passes as it is: none for an item with nothing to say.
            const late = $.const(East.function([OptionType(StringType)], OptionType(Plan.Types.Status), (_$2, words) => words.match({
                some: (_$3, w) => East.value(some(Plan.status(w, "warning")), OptionType(Plan.Types.Status)),
                none: () => East.value(none, OptionType(Plan.Types.Status)),
            })));
            return Plan.Root({ axis, data, series: [
                Plan.series.span(Row, { key: "runs", title: "Runs", label: (_r, k) => k,
                    runs: Plan.items("items", { from: "at", to: "to" }, (item) => ({ label: "RUN", state: item.state, status: late(item.late) })) }),
                Plan.series.buckets(Row, { key: "tiles", title: "Tiles", label: (_r, k) => k,
                    events: Plan.items("items", { at: "at" }, (item) => ({ state: item.state, status: late(item.late) })) }),
                Plan.series.cards(Row, { key: "chips", title: "Chips", label: (_r, k) => k,
                    chips: Plan.items("items", { from: "at", to: "to" }, (item) => ({ label: "80h", state: item.state, status: late(item.late) })) }),
                Plan.series.events(Row, { key: "marks", title: "Marks", label: (_r, k) => k,
                    // A status written in place, the same for every item.
                    marks: Plan.items("items", { at: "at" }, () => ({ kind: "milestone", status: Plan.status("Check", "info", { ring: true }) })) }),
            ] });
        }).toIR().compile([])();
        if (root.rows.type !== "inline") throw new Error("expected an inline canvas");
        const kinds = root.rows.value.flatMap((block) => block.rows).map((row) => row.kind);
        const said = [none, some(status("2 d late", "warning"))];
        assert.deepEqual(kinds.map((kind) => kind.type), ["span", "buckets", "cards", "events"]);
        for (const kind of kinds) {
            if (kind.type === "span") assert.ok(sameStatuses(kind.value.runs.map((run) => run.status), said));
            if (kind.type === "buckets") assert.ok(sameStatuses(kind.value.events.map((tile) => tile.status), said));
            if (kind.type === "cards") assert.ok(sameStatuses(kind.value.chips.map((chip) => chip.status), said));
            if (kind.type === "events") {
                assert.ok(sameStatuses(kind.value.marks.map((mark) => mark.status), [some(status("Check", "info", true)), some(status("Check", "info", true))]));
            }
        }
    });
});

describe("the map fields `Plan.status` took the place of are refused naming it (#1541, U8)", () => {
    const RUN = "Plan: a run's `status` is a status, its words with its tone (#1541) — give Plan.status(words, tone, { ring? }): "
        + "status: Plan.status(\"Over dwell\", \"warning\")";
    const TILE = "Plan: a tile's `tone` is removed (#1541) — its `status` says it, its words with its tone: status: Plan.status(\"Late\", \"warning\")";

    test("a run's `status` given a tone alone: its name, its value, or an expression of one", () => {
        const run = (given: unknown) => refusal(() => Plan.run({ key: "r", start: W27, end: W28, label: "RUN", state: "actual", status: given as never }));
        assert.equal(run("warning"), RUN);
        assert.equal(run(variant("warning", null)), RUN);
        assert.equal(run(East.value(variant("warning", null), StatusTokenType)), RUN);
        // A status, an Option of one and nothing at all are taken.
        assert.equal(run(Plan.status("Over dwell", "warning")), "");
        assert.equal(run(none), "");
        assert.equal(run(undefined), "");
    });

    test("a run map's bare tone is refused as the series is built, naming the series and its read", () => {
        const Job = StructType({ from: DateTimeType, to: DateTimeType });
        const Row = StructType({ jobs: DictType(StringType, Job) });
        assert.equal(refusal(() => East.function([], Plan.Types.Root, ($) => {
            const data = $.const(new Map(), DictType(StringType, Row));
            return Plan.Root({ axis, data, series: [
                Plan.series.span(Row, { key: "runs", title: "Runs", label: (_r, k) => k,
                    runs: Plan.items("jobs", { from: "from", to: "to" }, () => ({ label: "RUN", state: "actual", status: "warning" as never })) }),
            ] });
        })), `Plan.series.span "runs": Plan.items("jobs", …) does not build for its rows (${RUN})`);
    });

    test("a tile's `tone`, on the builder and in a map", () => {
        assert.equal(refusal(() => Plan.event({ key: "t", at: W27, state: "confirmed", tone: "warning" } as never)), TILE);
        const Drop = StructType({ at: DateTimeType });
        const Row = StructType({ drops: DictType(StringType, Drop) });
        assert.equal(refusal(() => East.function([], Plan.Types.Root, ($) => {
            const data = $.const(new Map(), DictType(StringType, Row));
            return Plan.Root({ axis, data, series: [
                Plan.series.buckets(Row, { key: "tiles", title: "Tiles", label: (_r, k) => k,
                    events: Plan.items("drops", { at: "at" }, () => ({ state: "confirmed", tone: "warning" }) as never) }),
            ] });
        })), `Plan.series.buckets "tiles": Plan.items("drops", …) does not build for its rows (${TILE})`);
    });

    test("a tile, a chip and a mark refuse a bare tone as a run does, each by its name", () => {
        const word = (item: string) => RUN.replace("a run's", `${item}'s`);
        assert.equal(refusal(() => Plan.event({ key: "t", at: W27, state: "confirmed", status: "warning" as never })), word("a tile"));
        assert.equal(refusal(() => Plan.chip({ key: "c", from: W27, to: W28, label: "80h", state: "confirmed", status: "warning" as never })), word("a chip"));
        assert.equal(refusal(() => Plan.mark({ key: "m", at: W27, kind: "milestone", status: "warning" as never })), word("a mark"));
    });
});
