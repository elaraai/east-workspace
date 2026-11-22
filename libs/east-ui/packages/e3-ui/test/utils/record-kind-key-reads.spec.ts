/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A declaration whose `key` reads the field its `keyField` names
 * (east-workspace#1709, ruling 8). A key field holds a copy of the row's key,
 * which the builder keeps there and shows read only, so a key built from it
 * is built from itself: a new row stands under an empty key, or under a
 * made-up one it never leaves. Every declaration that takes the two options —
 * the Flowchart's states, transitions and lanes, the Schematic's items, links
 * and nets, the Plan's link kinds, an event kind and the Roster's targets —
 * refuses the pair where it is declared, naming both and saying to leave
 * `keyField` out. A Sheet's and a Record's are refused in the Sheet's spec.
 * A `key` that hands the row whole to a function that cannot be read where it
 * is declared may read the field unseen: beside a `keyField` it is refused too.
 *
 * e3-ui's specs read and write no e3: each record is a handle made by hand
 * (`record-handles.ts`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, FloatType, IntegerType, NullType, SetType, SortedMap, StringType, StructType,
    compareFor, type BlockBuilder, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Flowchart, Plan, Roster, Schematic } from "@elaraai/e3-ui";
import { Schedule } from "@elaraai/e3-ui/internal";
import { recordHandle } from "../record-handles.js";

const byText = compareFor(StringType);

/** A flow's rows, each holding its key in `code`: its steps, the moves between them, and its lanes. */
const Step = StructType({ code: StringType, name: StringType, lane: StringType, seq: FloatType });
const Move = StructType({ code: StringType, from: StringType, to: StringType });
const Lane = StructType({ code: StringType, label: StringType, seq: FloatType, site: StructType({ code: StringType }) });
const steps = recordHandle(DictType(StringType, Step), new SortedMap<string, ValueTypeOf<typeof Step>>([], byText), "spec_key_reads_steps");
const moves = recordHandle(DictType(StringType, Move), new SortedMap<string, ValueTypeOf<typeof Move>>([], byText), "spec_key_reads_moves");
const lanes = recordHandle(DictType(StringType, Lane), new SortedMap<string, ValueTypeOf<typeof Lane>>([], byText), "spec_key_reads_lanes");

/** A floor's rows: its ovens, the ducts between them, and the feeds over them. */
const Oven = StructType({ code: StringType, name: StringType, x: FloatType, y: FloatType });
const Duct = StructType({ code: StringType, from: StringType, to: StringType });
const Feed = StructType({ code: StringType, supply: SetType(StringType), fed: SetType(StringType) });
const ovens = recordHandle(DictType(StringType, Oven), new SortedMap<string, ValueTypeOf<typeof Oven>>([], byText), "spec_key_reads_ovens");
const ducts = recordHandle(DictType(StringType, Duct), new SortedMap<string, ValueTypeOf<typeof Duct>>([], byText), "spec_key_reads_ducts");
const feeds = recordHandle(DictType(StringType, Feed), new SortedMap<string, ValueTypeOf<typeof Feed>>([], byText), "spec_key_reads_feeds");

/** A workshop's jobs, and the cover its roster asks for. */
const Job = StructType({ code: StringType, title: StringType, start: DateTimeType, end: DateTimeType });
const Cover = StructType({ code: StringType, day: DateTimeType, team: StringType, shift: StringType, heads: IntegerType, hours: DictType(StringType, FloatType) });
const jobs = recordHandle(DictType(StringType, Job), new SortedMap<string, ValueTypeOf<typeof Job>>([], byText), "spec_key_reads_jobs");
const cover = recordHandle(DictType(StringType, Cover), new SortedMap<string, ValueTypeOf<typeof Cover>>([], byText), "spec_key_reads_cover");

/** Each declaration that takes `key` and `keyField`: as its refusals name it, what one of its rows is called, and the declaration told `options`. */
const declarations: readonly (readonly [where: string, row: string, declared: ($: BlockBuilder<NullType>, options: object) => unknown])[] = [
    ["Flowchart.states", "a state", ($, options) => Flowchart.states($.let(steps()) as never, { label: "name", lane: "lane", order: "seq", ...options } as never)],
    ["Flowchart.transitions", "a transition", ($, options) => Flowchart.transitions($.let(moves()) as never, { from: "from", to: "to", ...options } as never)],
    ["Flowchart.lanes", "a lane", ($, options) => Flowchart.lanes($.let(lanes()) as never, { label: "label", order: "seq", ...options } as never)],
    ['Schematic.items: "Oven"', "an item", ($, options) => Schematic.items($.let(ovens()) as never, { name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name", ...options } as never)],
    ['Schematic.links: "Duct"', "a link", ($, options) => Schematic.links($.let(ducts()) as never, {
        name: "Duct", icon: "wind", from: { field: "from", of: "ovens" }, to: { field: "to", of: "ovens" }, ...options,
    } as never)],
    ['Schematic.nets: "Feed"', "a net", ($, options) => Schematic.nets($.let(feeds()) as never, {
        name: "Feed", icon: "plug", sources: { field: "supply", of: "ovens" }, destinations: { field: "fed", of: "ovens" }, ...options,
    } as never)],
    ['Plan.links: "Duct"', "a link", ($, options) => Plan.links($.let(ducts()) as never, {
        name: "Duct", icon: "arrow-right-long", from: { field: "from", of: "job" }, to: { field: "to", of: "job" }, ...options,
    } as never)],
    ['Schedule.events: "Job"', "an event", ($, options) => Schedule.events($.let(jobs()) as never, {
        name: "Job", icon: "wrench", title: "title", start: "start", end: "end", ...options,
    } as never)],
    ["Roster.targets", "a target", ($, options) => Roster.targets($.let(cover()) as never, {
        day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours", ...options,
    } as never)],
];

/** What a declaration told `options` is refused with; empty where it is declared. */
const refusal = (declared: ($: BlockBuilder<NullType>, options: object) => unknown, options: object): string => {
    try {
        East.function([], NullType, ($) => { declared($, options); });
    } catch (error) {
        return error instanceof Error ? error.message : "";
    }
    return "";
};

describe("a declaration whose `key` reads the field its `keyField` names", () => {
    for (const [where, row, declared] of declarations) {
        test(`ruling 8 — ${where}: refused where it is declared, naming both and saying to leave \`keyField\` out`, () => {
            assert.equal(refusal(declared, { keyField: "code", key: (held: { code: unknown }) => held.code }),
                `${where}: \`key\` reads "code", the field \`keyField\` names — that field holds a copy of ${row}'s key, kept there by its builder, ` +
                "so no key is built from it: leave `keyField` out, and `key` alone keys each one by what the field holds");
            // Each alone is declared, as before.
            assert.deepEqual([refusal(declared, { keyField: "code" }), refusal(declared, { key: (held: { code: unknown }) => held.code })], ["", ""]);
        });
    }

    const laned = declarations[2]![2];

    test("ruling 8 — a `key` built from the key field among other fields is refused too", () => {
        assert.match(refusal(laned, { keyField: "code", key: (lane: ExprType<typeof Lane>) => East.str`${lane.label}/${lane.code}` }),
            /^Flowchart\.lanes: `key` reads "code", the field `keyField` names/);
    });

    test("ruling 8 — a `key` that reads the field through an East function it calls is refused as one that reads it itself", () => {
        const codeOf = East.function([Lane], StringType, (_$, lane) => lane.code);
        assert.match(refusal(laned, { keyField: "code", key: (lane: ExprType<typeof Lane>) => codeOf(lane) }),
            /^Flowchart\.lanes: `key` reads "code", the field `keyField` names/);
    });

    test("ruling 8 — a `key` that hands the row whole to a function that cannot be read where it is declared is refused beside `keyField`, saying why and what to do; given a field of the row it stands, and alone it stands", () => {
        const coded = East.platform("spec_key_reads_coded", [Lane], StringType);
        const labelled = East.platform("spec_key_reads_labelled", [StringType], StringType);
        assert.equal(refusal(laned, { keyField: "code", key: (lane: ExprType<typeof Lane>) => coded(lane) }),
            'Flowchart.lanes: `key` hands the row to a function that cannot be read where it is declared, so whether it reads "code", ' +
            "the field `keyField` names, cannot be told — and a key built from that field is built from itself: read the row's fields in `key` itself, " +
            "or leave `keyField` out");
        assert.deepEqual([
            refusal(laned, { keyField: "code", key: (lane: ExprType<typeof Lane>) => labelled(lane.label) }),
            refusal(laned, { key: (lane: ExprType<typeof Lane>) => coded(lane) }),
        ], ["", ""]);
    });

    test("ruling 8 — a `key` that reads another field stands beside `keyField`: one of the row's own, or a field of the same name a step down", () => {
        assert.deepEqual([
            refusal(laned, { keyField: "code", key: (lane: ExprType<typeof Lane>) => lane.label }),
            refusal(laned, { keyField: "code", key: (lane: ExprType<typeof Lane>) => lane.site.code }),
        ], ["", ""]);
    });
});
