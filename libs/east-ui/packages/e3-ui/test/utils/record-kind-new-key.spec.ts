/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A kind over the app's record told the app's own rule for a new row's key
 * (`newKey`, east-workspace#1709), as every kind whose builder adds rows
 * declares one (`utils/record-kind.ts`' `KindRowKeys`): the rule goes on the
 * wire over the keys' text, a kind given none carries none, and `newKey`
 * beside `key` is refused, naming both. Then each builder's own declaration —
 * the Flowchart's states, transitions and lanes, the Schematic's items, links
 * and nets, and the Plan's link kinds — takes the option, and a kind whose
 * rows are never typed and keyed by neither String nor Integer is declared
 * with `newKey` as with `key`. A kind whose builder adds no row — a
 * Schematic's zones — declares none of the key options.
 *
 * e3-ui's specs read and write no e3: each record is a handle made by hand
 * (`record-handles.ts`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, SetType, SortedMap, SortedSet, StringType, StructType,
    compareFor, type BlockBuilder, type EastType, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Flowchart, Plan, Record, Schematic } from "@elaraai/e3-ui";
import { KindSideFields, recordSide, type KindBinding } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { recordHandle } from "../record-handles.js";

const byText = compareFor(StringType);
/** The rule a kind carries: over the keys' text, whatever the record is keyed by. */
const Rule = OptionType(FunctionType([SetType(StringType)], StringType));
/** The keys taken, as a builder's payload gives them: each as its text. */
const taken = (...ids: string[]) => new SortedSet(ids, byText);
/** The app's rule over String keys: the next of a scheme, counted from the keys taken. */
const nextOf = (prefix: string) => East.function([SetType(StringType)], StringType, (_$, keys) => East.str`${prefix}-${keys.size().add(1n)}`);
/** The app's rule over Integer keys: ten past the largest taken. */
const tenOn = East.function([SetType(IntegerType)], IntegerType, (_$, keys) => keys.reduce((_$2, most, key) => East.max(most, key), 0n).add(10n));

/** A rack, and racks keyed by their code and by their number. */
const Rack = StructType({ code: StringType, bay: IntegerType });
const RackKind = StructType({ ...KindSideFields });
const racksByCode = recordHandle(DictType(StringType, Rack), new SortedMap<string, ValueTypeOf<typeof Rack>>([], byText), "spec_new_key_racks");
const racksByNumber = recordHandle(DictType(IntegerType, Rack), new SortedMap<bigint, ValueTypeOf<typeof Rack>>([], compareFor(IntegerType)), "spec_new_key_numbered_racks");
/** The racks' kind, built as a builder builds one over a record keyed by `keyType`. */
const racksKind = (handleOf: typeof racksByCode | typeof racksByNumber, keyType: EastType, config: object) => East.compile(East.function([], RackKind, ($) => {
    const handle = $.let(handleOf());
    const bound: KindBinding = { form: "record", handle: handle as unknown as ExprType<EastType>, keyType, rowType: Rack };
    return recordSide(bound, undefined, undefined, config as never, [], "Spec.racks") as never;
}), []);

describe("a kind told the app's rule for a new key", () => {
    test("ruling 1 — carries the rule over the keys' text: a String key's as it is, an Integer key's read from its text and printed back", () => {
        const coded = racksKind(racksByCode, StringType, { newKey: nextOf("R") })();
        if (coded.newKey.type !== "some") assert.fail("expected the kind to carry its rule");
        assert.equal(coded.newKey.value(taken("R-1", "R-2")), "R-3");
        const numbered = racksKind(racksByNumber, IntegerType, { newKey: tenOn })();
        if (numbered.newKey.type !== "some") assert.fail("expected the kind to carry its rule");
        assert.equal(numbered.newKey.value(taken("7", "40")), "50");
    });

    test("ruling 3 — told none, it carries none: its builder makes the key", () => {
        assert.equal(racksKind(racksByCode, StringType, {})().newKey.type, "none");
    });

    test("ruling 2 — refuses `newKey` beside `key`, naming both: a new row's key is decided one way", () => {
        assert.throws(() => racksKind(racksByCode, StringType, { newKey: nextOf("R"), key: (rack: ExprType<typeof Rack>) => rack.code }),
            /Spec\.racks: `key` and `newKey` each decide a new row's key — give one: `key` builds it from the row, `newKey` makes it from the keys taken/);
    });

    test("ruling 1 — refuses a rule that is no function from the record's keys to one, naming both types", () => {
        assert.throws(() => racksKind(racksByCode, StringType, { newKey: tenOn }),
            /Spec\.racks: `newKey` takes the keys taken and gives a new one — an East function from \.Set \.String to \.String/);
    });
});

/** A flow's rows: its steps, the moves between them, and its lanes. */
const Step = StructType({ name: StringType, lane: StringType, seq: FloatType });
const Move = StructType({ from: StringType, to: StringType });
const Lane = StructType({ label: StringType, seq: FloatType });
const steps = recordHandle(DictType(StringType, Step), new SortedMap<string, ValueTypeOf<typeof Step>>([], byText), "spec_new_key_steps");
const moves = recordHandle(DictType(StringType, Move), new SortedMap<string, ValueTypeOf<typeof Move>>([], byText), "spec_new_key_moves");
const lanes = recordHandle(DictType(StringType, Lane), new SortedMap<string, ValueTypeOf<typeof Lane>>([], byText), "spec_new_key_lanes");
/** Moves keyed by their two ends: a key no person types, and no builder makes up. */
const MoveKey = StructType({ from: StringType, to: StringType });
const movesByEnds = recordHandle(DictType(MoveKey, Move), new SortedMap<ValueTypeOf<typeof MoveKey>, ValueTypeOf<typeof Move>>([], compareFor(MoveKey)), "spec_new_key_moves_by_ends");

/** A floor's rows: its ovens, the ducts between them, and the feeds over them. */
const Oven = StructType({ name: StringType, x: FloatType, y: FloatType });
const Duct = StructType({ from: StringType, to: StringType });
const Feed = StructType({ supply: SetType(StringType), fed: SetType(StringType) });
const ovens = recordHandle(DictType(StringType, Oven), new SortedMap<string, ValueTypeOf<typeof Oven>>([], byText), "spec_new_key_ovens");
const ducts = recordHandle(DictType(StringType, Duct), new SortedMap<string, ValueTypeOf<typeof Duct>>([], byText), "spec_new_key_ducts");
const feeds = recordHandle(DictType(StringType, Feed), new SortedMap<string, ValueTypeOf<typeof Feed>>([], byText), "spec_new_key_feeds");

/** The rule a declaration puts on the wire: each builder's kind, built as its builder builds it. */
const ruleOf = (build: ($: BlockBuilder<typeof Rule>) => ExprType<typeof Rule>) => East.compile(East.function([], Rule, ($) => build($)), [])();

describe("every builder's kind that adds rows takes the app's rule for a new key", () => {
    /** Each declaration told `newKey`, by the builder's name for it. */
    const told: readonly (readonly [string, ($: BlockBuilder<typeof Rule>, options: object) => ExprType<typeof Rule>])[] = [
        ["Flowchart.states", ($, options) => Flowchart.states($.let(steps()) as never, { label: "name", lane: "lane", order: "seq", ...options } as never).build(undefined, false).newKey],
        ["Flowchart.transitions", ($, options) => Flowchart.transitions($.let(moves()) as never, { from: "from", to: "to", ...options } as never).build(undefined, false).newKey],
        ["Flowchart.lanes", ($, options) => Flowchart.lanes($.let(lanes()) as never, { label: "label", order: "seq", ...options } as never).build(undefined, false).newKey],
        ["Schematic.items", ($, options) => Schematic.items($.let(ovens()) as never, { name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name", ...options } as never).build("ovens").newKey],
        ["Schematic.links", ($, options) => Schematic.links($.let(ducts()) as never, {
            name: "Duct", icon: "wind", from: { field: "from", of: "ovens" }, to: { field: "to", of: "ovens" }, ...options,
        } as never).build("ducts").newKey],
        ["Schematic.nets", ($, options) => Schematic.nets($.let(feeds()) as never, {
            name: "Feed", icon: "plug", sources: { field: "supply", of: "ovens" }, destinations: { field: "fed", of: "ovens" }, ...options,
        } as never).build("feeds").newKey],
        ["Plan.links", ($, options) => Plan.links($.let(ducts()) as never, {
            name: "Duct", icon: "arrow-right-long", from: { field: "from", of: "job" }, to: { field: "to", of: "job" }, ...options,
        } as never).build("duct").newKey],
    ];

    for (const [name, declared] of told) {
        test(`ruling 1 — ${name}: carries the rule, carries none told none, and refuses it beside \`key\``, () => {
            const rule = ruleOf(($) => declared($, { newKey: nextOf("N") }));
            if (rule.type !== "some") assert.fail(`expected ${name} to carry its rule`);
            assert.equal(rule.value(taken("N-1")), "N-2");
            assert.equal(ruleOf(($) => declared($, {})).type, "none");
            assert.throws(() => ruleOf(($) => declared($, { newKey: nextOf("N"), key: () => "N-0" })),
                /`key` and `newKey` each decide a new row's key — give one/);
        });
    }

    test("ruling 3 — transitions keyed by neither String nor Integer are declared with `newKey`, as with `key`: the rule keys what Connect makes", () => {
        const direct = East.function([SetType(MoveKey)], MoveKey, (_$, _keys) => ({ from: "A", to: "B" }));
        const rule = ruleOf(($) => Flowchart.transitions($.let(movesByEnds()) as never, { from: "from", to: "to", newKey: direct } as never).build(undefined, false).newKey);
        if (rule.type !== "some") assert.fail("expected the transitions to carry their rule");
        // Over the keys' text: the key the rule gives, as East prints it.
        assert.equal(rule.value(taken()), '(from="A", to="B")');
        assert.throws(() => ruleOf(($) => Flowchart.transitions($.let(movesByEnds()) as never, { from: "from", to: "to" } as never).build(undefined, false).newKey),
            /Flowchart\.transitions: the transitions are keyed by .*, and Connect makes one with no key typed — give `key`, building one's key from its row, or `newKey`, making one from the keys taken, or key them by String or Integer/);
    });
});

// Records declared with e3, as an app declares them: what each option's type is checked over.
const Zone = StructType({ code: StringType, label: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType });
const zones = e3.record("new_key_zones", DictType(StringType, Zone), {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
const laneRows = e3.record("new_key_lanes", DictType(StringType, Lane), {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** The options' type checks: never called — `tsc` checks what each line says. */
export function newKeyKindChecks($: BlockBuilder<NullType>): void {
    const boundLanes = $.let(Record.bind(laneRows));
    const next = $.const(nextOf("lane"));
    Flowchart.lanes(boundLanes, { label: "label", order: "seq", newKey: next });
    const overNumbers = $.const(tenOn);
    // @ts-expect-error — the lanes are keyed by a String, and this rule is over Integer keys
    Flowchart.lanes(boundLanes, { label: "label", order: "seq", newKey: overNumbers });
    // A zone is added through its record, never by the Schematic: its kind declares no key option.
    const boundZones = $.let(Record.bind(zones));
    Schematic.zones(boundZones, { name: "Hall", icon: "border-all", x: "x", y: "y", width: "w", height: "h", label: "label" });
    // @ts-expect-error — the Schematic adds no zone, and makes no key for one
    Schematic.zones(boundZones, { name: "Hall", icon: "border-all", x: "x", y: "y", width: "w", height: "h", label: "label", newKey: next });
    // @ts-expect-error — the Schematic adds no zone, and keeps no key in one's row
    Schematic.zones(boundZones, { name: "Hall", icon: "border-all", x: "x", y: "y", width: "w", height: "h", label: "label", keyField: "code" });
}
