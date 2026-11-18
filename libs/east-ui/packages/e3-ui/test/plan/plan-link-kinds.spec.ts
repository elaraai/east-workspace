/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's link kinds (#1541, U10): `Plan.links(record, { from, to, … })`,
 * a kind of link over the app's own record, checked without e3 — a print
 * works' feeds, each from a print job or a bindery job into a bindery job or
 * a delivery.
 *
 * - **The kind, built and run.** Its ends on the wire, the event kinds each
 *   may name; its stored links, each one's roles — its two events by their
 *   kind's slot and their key's text, and its quantity — beside its bytes; a
 *   drafted link's roles; a new link between two events; and the record's
 *   side: editable through its patch door, its form over every field but its
 *   ends.
 * - **Read whole, within the cap.** Past the cap an event kind is read under,
 *   it counts its links and reads none.
 * - **Each refusal at `Plan.links`** names its option: the binding, an end's
 *   field and its `of`, the quantity, the key.
 * - **`<Plan>` holds the ends to its event kinds**: an end naming no kind, or
 *   holding another type than its kind is keyed by, is refused naming the
 *   field and both types; `links` takes the kinds by slot beside the list built
 *   in code; and `canConnect` is its veto over the link a Connect would draw.
 *
 * What a link kind draws, and its Connect, are the renderer's
 * (`e3-ui-components`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DictType, East, Expr, FloatType, FunctionType, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
    decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, isTypeEqual, none, some, variant,
    type BlockBuilder, type EastType, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Data, Record, Schedule } from "@elaraai/e3-ui";
import {
    Plan, PlanLinkEntryType, PlanLinkKindType, PlanLinkRolesType, PlanPayloadType, SCHEDULE_EVENT_CAP,
} from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import * as ex from "./plan-events.examples.js";
import { dataHandle, recordHandle } from "../record-handles.js";

// ============================================================================
// The feeds
// ============================================================================

/** A feed: the job it runs from, the job or the delivery it runs into, and the sheets it moves. */
const Feed = StructType({
    from: VariantType({ binding: StringType, job: StringType }),
    to: VariantType({ binding: StringType, delivery: StringType }),
    sheets: FloatType,
});
const Feeds = DictType(StringType, Feed);
const FEEDS = new Map<string, ValueTypeOf<typeof Feed>>([
    ["F-1", { from: variant("job", "J-1001"), to: variant("binding", "B-101"), sheets: 12000.0 }],
    ["F-2", { from: variant("binding", "B-101"), to: variant("delivery", "D-101"), sheets: 11500.0 }],
]);
const feedsRecord = recordHandle(Feeds, FEEDS, "feeds");
const feedsData = dataHandle(Feeds, FEEDS, "feeds");
/** The feeds as a package declares them: what `Record.bind` and `Data.bindPaged` are given. */
const feeds = e3.record("plan_link_kinds_spec_feeds", Feeds, { initial: new Map(), mutations: (mutation) => ({ patch: mutation.patch() }) });

const FROM = { field: "from", of: { binding: "binding", job: "job" } } as const;
const TO = { field: "to", of: { binding: "binding", delivery: "delivery" } } as const;

const feedOf = decodeBeast2For(Feed);
const feedBytes = encodeBeast2For(Feed);
const feedEqual = equalFor(Feed);
const rolesEqual = equalFor(PlanLinkRolesType);
const entriesType = DictType(StringType, PlanLinkEntryType);
const ref = (kind: string, key: string) => ({ kind, key });
/** A quantity in sheets, as the feeds' kind reads one. */
const sheets = (value: number) => some({ value, unit: some("sheets"), format: none, text: none });

/** A kind built over its handle and run: what the payload carries for it. */
function kindOf(make: ($: BlockBuilder<EastType>) => ExprType<PlanLinkKindType>): ValueTypeOf<PlanLinkKindType> {
    return East.compile(East.function([], PlanLinkKindType, ($) => make($ as never)), [])();
}

/** Run `build` inside a block, as `<Plan>`'s factory runs. */
function inBlock<T>(build: ($: BlockBuilder<NullType>) => T): T {
    let out: T | undefined;
    East.function([], NullType, ($) => { out = build($); });
    return out!;
}

/** What `build` throws inside a block; `""` when it builds. */
function refusal(build: ($: BlockBuilder<NullType>) => unknown): string {
    try {
        inBlock(build);
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

/** The feeds' kind over a handle made in the block. */
const feedKind = ($: BlockBuilder<EastType>) => Plan.links($.let(feedsRecord()), {
    name: "Feed", icon: "arrow-right-long", from: FROM, to: TO,
    quantity: { field: "sheets", unit: "sheets" },
});

// ============================================================================
// The kind, built and run
// ============================================================================

describe("a link kind over the app's record: its links, each a row", () => {
    const kind = kindOf(($) => feedKind($).build("feed"));

    test("on the wire: its slot, its name and icon, the event kinds each end may name, and its record's key type", () => {
        assert.deepEqual([kind.key, kind.name, kind.icon], ["feed", "Feed", "arrow-right-long"]);
        assert.deepEqual(kind.ends, { from: ["binding", "job"], to: ["binding", "delivery"] });
        assert.ok(isTypeEqual(fromEastTypeValue(kind.keyType), StringType));
        assert.ok(isTypeEqual(fromEastTypeValue(kind.rowType), Feed));
        assert.equal(kind.rowKey.type, "none", "a String key is made up: no `key` is given");
    });

    test("its stored links, by their keys: each one's two events by their kind's slot and their key's text, and the sheets it moves", () => {
        assert.equal(kind.count(), 2n);
        const rows = kind.rows();
        if (rows.type !== "some") assert.fail("a record read whole, within the cap, holds its links");
        assert.ok(equalFor(ArrayType(StringType))([...rows.value.keys()], ["F-1", "F-2"]));
        assert.ok(rolesEqual(rows.value.get("F-1")!.roles, { from: ref("job", "J-1001"), to: ref("binding", "B-101"), quantity: sheets(12000.0) }));
        assert.ok(rolesEqual(rows.value.get("F-2")!.roles, { from: ref("binding", "B-101"), to: ref("delivery", "D-101"), quantity: sheets(11500.0) }));
        assert.ok(feedEqual(feedOf(rows.value.get("F-1")!.row), FEEDS.get("F-1")!), "beside its row's bytes");
        assert.ok(equalFor(entriesType)(rows.value, rows.value));
    });

    test("a drafted link's roles, from its bytes", () => {
        const drafted = feedBytes({ from: variant("job", "J-1002"), to: variant("delivery", "D-102"), sheets: 500.0 });
        assert.ok(rolesEqual(kind.read(drafted, "F-9"), { from: ref("job", "J-1002"), to: ref("delivery", "D-102"), quantity: sheets(500.0) }));
    });

    test("a new link between two events: its ends written, each to its case, and every other field its type's default", () => {
        const made = kind.create({ from: ref("job", "J-1003"), to: ref("binding", "B-102") }, none);
        if (made.type !== "some") assert.fail("a Connect between a job and a bindery job makes a feed");
        assert.ok(feedEqual(feedOf(made.value), { from: variant("job", "J-1003"), to: variant("binding", "B-102"), sheets: 0.0 }));
        // An end of a kind its field holds no keys of makes nothing: a feed runs from no delivery, and into no print job.
        assert.equal(kind.create({ from: ref("delivery", "D-101"), to: ref("binding", "B-102") }, none).type, "none");
        assert.equal(kind.create({ from: ref("job", "J-1003"), to: ref("job", "J-1004") }, none).type, "none");
    });

    test("its templates are a record's, on the wire as the library lists them; a link made from one takes its values, its ends still the two events", () => {
        const Preset = StructType({ name: StringType, values: StructType({ sheets: FloatType }) });
        const PRESETS = new Map<string, ValueTypeOf<typeof Preset>>([
            ["short", { name: "Short run", values: { sheets: 5000.0 } }], ["long", { name: "Long run", values: { sheets: 40000.0 } }],
        ]);
        const presets = dataHandle(DictType(StringType, Preset), PRESETS, "presets");
        const withTemplates = kindOf(($) => Plan.links($.let(feedsRecord()), {
            name: "Feed", icon: "arrow-right-long", from: FROM, to: TO,
            templates: Schedule.templates($.let(presets()).read(), { name: (preset) => preset.name, values: (preset) => preset.values }),
        }).build("feed"));
        assert.ok(equalFor(ArrayType(StringType))(withTemplates.templates.map((template) => template.name), ["Long run", "Short run"]));
        const long = withTemplates.templates.find((template) => template.key === "long")!;
        const made = withTemplates.create({ from: ref("job", "J-1003"), to: ref("binding", "B-102") }, some(long.values));
        if (made.type !== "some") assert.fail("a Connect between a job and a bindery job makes a feed");
        assert.ok(feedEqual(feedOf(made.value), { from: variant("job", "J-1003"), to: variant("binding", "B-102"), sheets: 40000.0 }));
        // A kind given no templates lists none.
        assert.equal(kind.templates.length, 0);
    });

    test("its templates are refused, naming the kind: a list written in the code, a template with a time — a `duration` or an `at` — or a source of the rail, and values that are not the row's fields but its ends", () => {
        const Preset = StructType({ name: StringType, values: StructType({ sheets: FloatType }), other: StructType({ pallets: FloatType }) });
        const presets = dataHandle(DictType(StringType, Preset), new Map(), "presets");
        const declare = ($: BlockBuilder<EastType>, templates: unknown) => Plan.links($.let(feedsRecord()), {
            name: "Feed", icon: "arrow-right-long", from: FROM, to: TO, templates: templates as never,
        });
        assert.match(refusal(($) => declare($ as never, [{ key: "short", name: "Short run", values: { sheets: 5000.0 } }])),
            /^Plan\.links: "Feed": templates are a record's — Schedule\.templates\(templates\.read\(\), \{ name, values \}\) over a record of the app's, never a list written in the code$/);
        assert.match(refusal(($) => declare($ as never, Schedule.templates($.let(presets()).read(), {
            name: (preset) => preset.name, duration: () => variant("hours", 1.0), values: (preset) => preset.values,
        }))), /^Plan\.links: "Feed": a link has no time — its templates give no `duration`, and no `at`$/);
        assert.match(refusal(($) => declare($ as never, Schedule.templates($.let(presets()).read(), {
            name: (preset) => preset.name, at: () => some({ hour: 6n, minute: 0n }), values: (preset) => preset.values,
        }))), /^Plan\.links: "Feed": a link has no time — its templates give no `duration`, and no `at`$/);
        assert.match(refusal(($) => declare($ as never, Schedule.templates($.let(presets()).read(), {
            name: (preset) => preset.name, values: (preset) => preset.values, source: "feedPresets",
        }))), /^Plan\.links: "Feed": its templates are listed whole, following no source of the rail — they take no `source`, and these give "feedPresets"$/);
        assert.match(refusal(($) => declare($ as never, Schedule.templates($.let(presets()).read(), {
            name: (preset) => preset.name, values: (preset) => preset.other,
        }))), /^Plan\.links: "Feed": its templates' `values` give every field of the row but `from` and `to` — .* — and these give .*$/);
    });

    test("its record's side: bound with its patch door it is editable, its session there; its form is over every field but its ends", () => {
        assert.deepEqual([kind.editable, kind.editing.type, kind.entries.type], [true, "some", "none"]);
        assert.deepEqual(kind.fields.map((field) => field.path), [["sheets"]]);
        const read = kindOf(($) => Plan.links($.let(feedsData()), { name: "Feed", icon: "arrow-right-long", from: FROM, to: TO }).build("feed"));
        assert.deepEqual([read.editable, read.editing.type], [false, "none"], "bound Data.bind, it is read only");
        const rows = read.rows();
        if (rows.type !== "some") assert.fail("read only, its links are read all the same");
        assert.ok(rolesEqual(rows.value.get("F-1")!.roles, { from: ref("job", "J-1001"), to: ref("binding", "B-101"), quantity: none }), "with no `quantity`, a link moves none");
    });
});

describe("a link's quantity, and its key", () => {
    test("a quantity field holding an Option: a link holding none moves none, and draws as one of the list with no quantity does", () => {
        const Flow = StructType({ from: StringType, to: StringType, sheets: OptionType(FloatType) });
        const flows = recordHandle(DictType(StringType, Flow), new Map([
            ["a", { from: "J-1", to: "J-2", sheets: none }],
            ["b", { from: "J-2", to: "J-3", sheets: some(8.0) }],
        ]), "flows");
        const kind = kindOf(($) => Plan.links($.let(flows()), {
            name: "Flow", icon: "arrow-right-long", from: { field: "from", of: "job" }, to: { field: "to", of: "job" },
            quantity: { field: "sheets", unit: "k sheets" },
        }).build("flow"));
        const rows = kind.rows();
        if (rows.type !== "some") assert.fail("the flows are read");
        assert.ok(rolesEqual(rows.value.get("a")!.roles, { from: ref("job", "J-1"), to: ref("job", "J-2"), quantity: none }));
        assert.ok(rolesEqual(rows.value.get("b")!.roles, { from: ref("job", "J-2"), to: ref("job", "J-3"), quantity: some({ value: 8.0, unit: some("k sheets"), format: none, text: none }) }));
        assert.deepEqual(kind.ends, { from: ["job"], to: ["job"] });
    });

    test("a record keyed by its two ends gives `key`, which builds a new link's key from its row", () => {
        const Ends = StructType({ from: IntegerType, to: IntegerType });
        const Step = StructType({ from: IntegerType, to: IntegerType, note: StringType });
        const steps = recordHandle(DictType(Ends, Step), new Map(), "steps");
        const declare = ($: BlockBuilder<EastType>, key?: (step: ExprType<typeof Step>) => unknown) => Plan.links($.let(steps()), {
            name: "Step", icon: "arrow-right-long", from: { field: "from", of: "job" }, to: { field: "to", of: "job" },
            ...(key === undefined ? {} : { key: key as never }),
        });
        assert.match(refusal(($) => declare($ as never)),
            /^Plan\.links: "Step": the links are keyed by .*, and Connect makes one with no key typed — give `key`, building one's key from its row, or key them by String or Integer$/);
        const kind = kindOf(($) => declare($, (step) => ({ from: step.from, to: step.to })).build("step"));
        if (kind.rowKey.type !== "some") assert.fail("its `key` is on the wire");
        // Its ends hold the jobs' keys at their own type, an Integer, read back from their text.
        const made = kind.create({ from: ref("job", "7"), to: ref("job", "9") }, none);
        if (made.type !== "some") assert.fail("a Connect between two jobs makes a step");
        assert.equal(kind.rowKey.value(made.value), "(from=7, to=9)");
        assert.equal(kind.create({ from: ref("job", "seven"), to: ref("job", "9") }, none).type, "none", "a text no key of the jobs prints as makes nothing");
    });
});

describe("a link kind is read whole, within the cap an event kind is read under", () => {
    test("past the cap it counts its links and reads none", () => {
        const Hop = StructType({ from: StringType, to: StringType });
        const hopsOf = (count: number) => recordHandle(DictType(StringType, Hop),
            new Map(Array.from({ length: count }, (_, i) => [`h${String(i).padStart(5, "0")}`, { from: "J-1", to: "J-2" }])), "hops");
        const kindOver = (count: number) => {
            const hops = hopsOf(count);
            return kindOf(($) => Plan.links($.let(hops()), { name: "Hop", icon: "arrow-right-long", from: { field: "from", of: "job" }, to: { field: "to", of: "job" } }).build("hop"));
        };
        const within = kindOver(SCHEDULE_EVENT_CAP);
        assert.equal(within.count(), BigInt(SCHEDULE_EVENT_CAP));
        const read = within.rows();
        assert.equal(read.type === "some" ? read.value.size : -1, SCHEDULE_EVENT_CAP, "at the cap, every link is read");
        const past = kindOver(SCHEDULE_EVENT_CAP + 1);
        assert.equal(past.count(), BigInt(SCHEDULE_EVENT_CAP) + 1n);
        assert.equal(past.rows().type, "none");
    });
});

// ============================================================================
// The refusals at Plan.links
// ============================================================================

describe("Plan.links refuses, naming the option", () => {
    const config = { name: "Feed", icon: "arrow-right-long", from: FROM, to: TO } as const;
    const over = <R extends EastType>(type: R, more: object) => ($: BlockBuilder<NullType>) =>
        Plan.links($.let(recordHandle(DictType(StringType, type), new Map(), "rows")()) as never, { name: "Feed", icon: "arrow-right-long", ...more } as never);

    test("the record: a binding of a record of structs, read whole — never paged, and Record.bind with its patch door", () => {
        assert.match(refusal(() => Plan.links(new Map() as never, config as never)),
            /^Plan\.links: "Feed": the links are a record of the app's, read whole: bind Record\.bind\(record\), its record declaring patch: mutation\.patch\(\), to make and edit them, or Data\.bind\(record\) to read them$/);
        assert.match(refusal(($) => Plan.links($.let(Data.bindPaged(feeds)) as never, config as never)),
            /^Plan\.links: "Feed": the links are a record of the app's, read whole: .* — and this is Data\.bindPaged\(record\): a link has no times and its ends hold keys, which a rail narrows by neither$/);
        assert.match(refusal(($) => Plan.links($.let(Record.bind(feeds, [])) as never, config as never)),
            /^Plan\.links: "Feed": the links' record is bound without its patch door — its record declares patch: mutation\.patch\(\), which Save writes each link through$/);
        assert.match(refusal(($) => Plan.links($.let(recordHandle(DictType(StringType, FloatType), new Map(), "rows")()) as never, config as never)),
            /^Plan\.links: "Feed": the links' record holds its links by key, each a struct — and this one holds /);
        assert.equal(refusal(($) => Plan.links($.let(Record.bind(feeds)), config)), "", "bound with its patch door, it is declared");
    });

    test("an end: { field, of }, its field one the row has, holding a key or a variant of them — never an Option — and an `of` for each case", () => {
        const Row = StructType({ from: StringType, to: StringType, maybe: OptionType(StringType), weight: ArrayType(StringType), ends: VariantType({ job: StringType, binding: StringType }) });
        const of = { field: "to", of: "job" };
        assert.match(refusal(over(Row, { from: undefined, to: of })), /^Plan\.links: "Feed": `from` is \{ field, of \} — the field holding an event's key, and the event kind it holds keys of$/);
        assert.match(refusal(over(Row, { from: { field: "src", of: "job" }, to: of })), /^Plan\.links: "Feed": `from\.field` names "src", a field the row does not have \(from, to, maybe, weight, ends\)$/);
        assert.match(refusal(over(Row, { from: { field: "weight", of: "job" }, to: of })), /^Plan\.links: "Feed": `from\.field` names a field holding an event's key — of a type a Dict may be keyed by, a variant holding one per case, or an Option of either — and "weight" holds /);
        assert.match(refusal(over(Row, { from: { field: "maybe", of: "job" }, to: of })), /^Plan\.links: "Feed": a link has both its ends — `from\.field` names a field holding an event's key, or a variant holding one per case, never an Option — and "maybe" holds /);
        assert.match(refusal(over(Row, { from: { field: "ends", of: { job: "job" } }, to: of })), /^Plan\.links: "Feed": `from\.of` names an event slot for each of "ends"'s cases \(binding, job\) — and it names job$/);
        assert.match(refusal(over(Row, { from: { field: "from", of: "job" }, to: { field: "from", of: "job" } })), /^Plan\.links: "Feed": `from` and `to` both name "from" — a link's ends are two fields$/);
    });

    test("its icon, its quantity — a Float field, or an Option of one — and its key's type", () => {
        const Row = StructType({ from: StringType, to: StringType, note: StringType, weight: FloatType });
        const ends = { from: { field: "from", of: "job" }, to: { field: "to", of: "job" } };
        assert.match(refusal(($) => Plan.links($.let(feedsRecord()), { ...config, icon: undefined } as never)), /^Plan\.links: "Feed": `icon` is a Font Awesome solid icon's name$/);
        assert.match(refusal(over(Row, { ...ends, quantity: { field: "note" } })), /^Plan\.links: "Feed": `quantity\.field` names a Float field, or an Option of one, the quantity a link moves — "note" holds /);
        assert.match(refusal(over(Row, { ...ends, quantity: { field: "sheets" } })), /^Plan\.links: "Feed": `quantity\.field` names "sheets", a field the row does not have \(from, to, note, weight\)$/);
        // The record is keyed by String, and this key is the row's weight, a Float.
        assert.match(refusal(over(Row, { ...ends, key: (row: { weight: unknown }) => row.weight })),
            /^Plan\.links: "Feed": `key` builds a link's key, of the record's key type \.String — and this one builds \.Float$/);
        assert.equal(refusal(over(Row, { ...ends, quantity: { field: "weight" }, key: (row: { note: unknown }) => row.note })), "", "a Float quantity and a String key are taken");
    });
});

// ============================================================================
// <Plan links>
// ============================================================================

const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");
const PRESSES = Plan.series.resources(ex.PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name });

/** The print jobs over the presses, bound inside a block. */
function jobsOf($: BlockBuilder<NullType>) {
    return Schedule.events($.let(Record.bind(ex.planPrintJobs)), {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" },
    });
}

/** A Plan of the print jobs with `links`, and more of its props. */
function planOf($: BlockBuilder<NullType>, links: unknown, more: object = {}) {
    return Plan.Payload({
        axis: Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }),
        data: $.let(Record.bind(ex.planPrintPresses, [])).read(), series: [PRESSES],
        events: { job: jobsOf($) }, links, ...more,
    } as never);
}

/** A link kind between two print jobs, its ends holding keys of `key`'s type. */
function between<K extends EastType>($: BlockBuilder<NullType>, key: K, of: { from: unknown; to: unknown } = { from: "job", to: "job" }) {
    const Row = StructType({ from: key, to: key, sheets: FloatType });
    return Plan.links($.let(recordHandle(DictType(StringType, Row), new Map(), "runs")()) as never,
        { name: "Run on", icon: "arrow-right-long", from: { field: "from", of: of.from }, to: { field: "to", of: of.to } } as never);
}

describe("<Plan links>: link kinds by slot, held to the event kinds", () => {
    test("a link kind whose ends hold its event kind's keys builds: the payload carries the kind, and no veto unless given one", () => {
        const type = inBlock(($) => Expr.type(planOf($, { runOn: between($, StringType) }) as unknown as Expr) as EastType);
        assert.ok(isTypeEqual(type, PlanPayloadType));
        assert.equal(refusal(($) => planOf($, { runOn: between($, StringType) })), "");
    });

    test("a link kind's slot is its own: one an event kind has is refused", () => {
        assert.match(refusal(($) => planOf($, { job: between($, StringType) })),
            /^Plan: `links\.job` is a link kind under an event kind's slot — "job" names an event kind in `events`: give the link kind a slot of its own$/);
    });

    test("an end naming an event kind the Plan has not is refused, naming the kinds it has", () => {
        assert.match(refusal(($) => planOf($, { runOn: between($, StringType, { from: "job", to: "binding" }) })),
            /^Plan: the link kind "runOn"'s `to` holds keys of "binding", and `events` has no kind of that name \(job\)$/);
    });

    test("an end holding another type than its event kind is keyed by is refused, naming the field and both types", () => {
        assert.match(refusal(($) => planOf($, { runOn: between($, IntegerType) })),
            /^Plan: the link kind "runOn"'s `from`, "from", holds \.Integer — and the event kind "job" is keyed by \.String: name a field holding \.String$/);
        const cases = ($: BlockBuilder<NullType>) => {
            const Row = StructType({ from: VariantType({ job: IntegerType }), to: StringType });
            return Plan.links($.let(recordHandle(DictType(StringType, Row), new Map(), "runs")()) as never,
                { name: "Run on", icon: "arrow-right-long", from: { field: "from", of: { job: "job" } }, to: { field: "to", of: "job" } } as never);
        };
        assert.match(refusal(($) => planOf($, { runOn: cases($) })),
            /^Plan: the link kind "runOn"'s `from`, "from", holds \.Integer in its case "job" — and the event kind "job" is keyed by \.String: give the case \.String$/);
    });

    test("`links` takes the list built in code as it did, and a slot may hold one beside the kinds — each link's ends checked as before", () => {
        const built = () => Plan.link({ key: "x", from: Plan.eventRef("job", "J-1001"), to: Plan.eventRef("job", "J-1002") });
        assert.equal(refusal(($) => planOf($, [built()])), "");
        assert.equal(refusal(($) => planOf($, { runOn: between($, StringType), built: [built()] })), "");
        assert.match(refusal(($) => planOf($, { built: [Plan.link({ key: "x", from: Plan.eventRef("stop", "S-01"), to: Plan.eventRef("job", "J-1001") })] })),
            /^Plan: links\.built\[0\] names the event kind "stop", and `events` has no kind of that name \(job\)$/);
        assert.match(refusal(($) => planOf($, { runOn: 7 })), /^Plan: `links\.runOn` is a link kind — Plan\.links\(record, \{ from, to, … \}\) — or a list of Plan\.link values$/);
        assert.match(refusal(($) => planOf($, 7)), /^Plan: `links` is the links built in code, a list of Plan\.link values, or link kinds by slot — links=\{\{ feed: Plan\.links\(record, \{ from, to, … \}\) \}\}$/);
    });

    test("`canConnect` is the veto over the link a Connect would draw: a function of Plan.Types.ConnectCandidate, on a Plan with a link kind", () => {
        const veto = East.function([Plan.Types.ConnectCandidate], OptionType(StringType), (_$, candidate) =>
            East.equal(candidate.from.key, candidate.to.key).ifElse(() => some("A job feeds another job"), () => none));
        assert.equal(refusal(($) => planOf($, { runOn: between($, StringType) }, { canConnect: veto })), "");
        assert.match(refusal(($) => planOf($, undefined, { canConnect: veto })),
            /^Plan: `canConnect` vets the link a Connect would draw, and this Plan has no link kind — give one, links=\{\{ feed: Plan\.links\(record, \{ from, to, … \}\) \}\}, or leave `canConnect` out$/);
        const other = East.function([StringType], OptionType(StringType), (_$, _kind) => none);
        assert.match(refusal(($) => planOf($, { runOn: between($, StringType) }, { canConnect: other })),
            /^Plan: `canConnect` is Fn\(Plan\.Types\.ConnectCandidate\) → Option<String>, the one check of every link a Connect would draw, its message on the ghost, and this one is /);
        assert.ok(isTypeEqual(Plan.Types.ConnectCandidate, StructType({ kind: StringType, from: StructType({ kind: StringType, key: StringType }), to: StructType({ kind: StringType, key: StringType }) })));
        assert.ok(isTypeEqual(FunctionType([Plan.Types.ConnectCandidate], OptionType(StringType)), Expr.type(veto as unknown as Expr) as EastType));
    });
});
