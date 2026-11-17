/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rows a Plan's event kinds land on (#1541, U1, U2): `Plan.series.resources`
 * and `Plan.series.kinds`, as the canvas draws them before any event is placed.
 *
 * A resources series makes one landing row per entry, at the entry's path under
 * the series' key — a row of no elements of its own, or of tiles in its lanes —
 * and its series beneath it, each at the same path under its own key, nested
 * under the landing row so folding it folds them. A tree makes more of them, a
 * resource at a time. A kinds block draws each entry by the case its variant
 * field holds, in the source's order, every accessor handed the case's value. A
 * gesture on a resource's series' row is written by that series.
 *
 * Where the events land is drawn on e3 itself, in e3-ui-components
 * (`test/plan-event-rows.spec.ts`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, RecursiveType, StringType, StructType, VariantType,
    SortedMap, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, variant, type BlockBuilder, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Schedule } from "@elaraai/e3-ui";
import { Plan, PlanPayloadType } from "@elaraai/e3-ui/internal";
import { recordHandle } from "../record-handles.js";
import { entry, ids, labels, parents, readings, rowsOf, sameIds, sameLabels, sameParents } from "./plan-rows.fixtures.js";

const W27 = new Date("2026-06-29T00:00:00Z");
const W28 = new Date("2026-07-06T00:00:00Z");
const axis = Plan.axis({ window: { min: W27, max: new Date("2026-09-21T00:00:00Z") }, resolution: "week" });

// ── Presses, each with its readings beneath it, the bindery's lines a tree ───

const Press = StructType({ name: StringType, readings: DictType(DateTimeType, FloatType) });
const Presses = DictType(StringType, Press);
const PRESSES: ValueTypeOf<typeof Presses> = new Map([
    ["P03", { name: "Heidelberg 3", readings: readings([W27, 10]) }],
    ["P04", { name: "Heidelberg 4", readings: readings() }],
]);

/** The presses, a landing row each, its readings typed into beneath it. */
const pressRows = () => [
    Plan.series.resources(Press, {
        key: "presses", title: "Presses", label: (press) => press.name,
        sub: (_press, key) => some(key),
        series: [
            Plan.series.table(Press, {
                key: "readings", title: "Readings", label: () => "Readings", edit: true,
                cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))),
            }),
        ],
    }),
];

const pressRoot = East.function([], Plan.Types.Root, ($) => {
    const data = $.const(PRESSES, Presses);
    return Plan.Root({ axis, data, series: pressRows(), editing: {} });
}).toIR().compile([])();

describe("a resources series", () => {
    test("each entry is one landing row at its path under the series' key, its series beneath it at the same path, nested under it", () => {
        assert.ok(sameIds(ids(pressRoot), [
            entry("presses", "P03"), entry("readings", "P03"),
            entry("presses", "P04"), entry("readings", "P04"),
        ]));
        assert.ok(sameParents(parents(pressRoot), [
            none, some(entry("presses", "P03")),
            none, some(entry("presses", "P04")),
        ]));
        assert.ok(sameLabels(labels(pressRoot), ["Heidelberg 3", "Readings", "Heidelberg 4", "Readings"]));
        const [p03] = rowsOf(pressRoot);
        assert.equal(p03!.gutter.sub.type === "some" ? p03!.gutter.sub.value : undefined, "P03");
    });

    test("a landing row holds no element of its own: a row of bars, none in it, which rolls nothing up", () => {
        const [p03] = rowsOf(pressRoot);
        assert.equal(p03!.kind.type, "span");
        if (p03!.kind.type !== "span") return;
        assert.equal(p03!.kind.value.runs.length, 0);
        assert.equal(p03!.kind.value.rollup.type, "none");
    });

    test("declaring lanes, a landing row is a row of tiles in them, every one drawn from the start", () => {
        const root = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(PRESSES, Presses);
            return Plan.Root({
                axis, data, series: [Plan.series.resources(Press, {
                    key: "presses", title: "Presses", label: (press) => press.name,
                    lanes: () => [Plan.lane({ key: "am", label: "AM" }), Plan.lane({ key: "pm", label: "PM" })],
                })],
            });
        }).toIR().compile([])();
        const [p03] = rowsOf(root);
        assert.equal(p03!.kind.type, "buckets");
        if (p03!.kind.type !== "buckets") return;
        assert.deepEqual(p03!.kind.value.lanes.map((lane) => lane.key), ["am", "pm"]);
        assert.equal(p03!.kind.value.events.length, 0);
    });

    test("a number typed into a resource's series is written by that series, into the resource's entry", () => {
        if (pressRoot.editing.type !== "some") return assert.fail("the canvas edits");
        const wire = pressRoot.editing.value;
        const encode = encodeBeast2For(Press);
        const decode = decodeBeast2For(Press);
        const row = entry("readings", "P04");
        const [out] = wire.write([{
            id: "P04", entry: encode(PRESSES.get("P04")!), rows: [row],
            gesture: variant("value", { row, position: 0n, at: variant("time", W28), value: some(7) }),
        }]);
        assert.ok(out?.type === "some");
        if (out?.type !== "some") return;
        assert.ok(equalFor(Press)(decode(out.value), { name: "Heidelberg 4", readings: readings([W28, 7]) }));
        // The landing row takes no gesture: its events are its kinds' records'.
        const [none_] = wire.write([{
            id: "P04", entry: encode(PRESSES.get("P04")!), rows: [entry("presses", "P04")],
            gesture: variant("value", { row: entry("presses", "P04"), position: 0n, at: variant("time", W28), value: some(7) }),
        }]);
        assert.equal(none_?.type, "none");
    });

    test("a tree makes a landing row of each resource beneath, nested under its parent, its bands rolling them up", () => {
        const LineNode = RecursiveType((self) => StructType({ name: StringType, lines: DictType(StringType, self) }));
        type LineValue = ValueTypeOf<typeof LineNode>;
        const line = (name: string, lines: [string, LineValue][] = []): LineValue => ({ name, lines: new Map(lines) }) as LineValue;
        const Bindery = DictType(StringType, LineNode);
        const root = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(new Map([["B1", line("Bindery", [["B1a", line("Folder")], ["B1b", line("Stitcher")]])]]), Bindery);
            return Plan.Root({
                axis, data, series: [Plan.series.resources(LineNode, { key: "lines", title: "Lines", label: (l) => l.name, children: "lines" })],
            });
        }).toIR().compile([])();
        assert.ok(sameIds(ids(root), [entry("lines", "B1"), entry("lines", "B1", "B1a"), entry("lines", "B1", "B1b")]));
        assert.ok(sameParents(parents(root), [none, some(entry("lines", "B1")), some(entry("lines", "B1"))]));
        assert.ok(sameLabels(labels(root), ["Bindery", "Folder", "Stitcher"]));
        const [b1, b1a] = rowsOf(root);
        assert.ok(b1!.kind.type === "span" && b1!.kind.value.rollup.type === "some" && b1!.kind.value.rollup.value.type === "union");
        assert.ok(b1a!.kind.type === "span" && b1a!.kind.value.rollup.type === "none");
        // A tree is more of the series' own rows: a Dict field holding the row's own type.
        const Flat = StructType({ name: StringType, under: DictType(StringType, StructType({ name: StringType })) });
        assert.throws(() => Plan.series.resources(Flat, { key: "lines", title: "Lines", label: (l) => l.name, children: "under" as never }),
            /children "under" holds \{ name \}, not \{ name, under \}/);
    });

    test("its series are rows over the resource's own row: a group, a section or another resources series is refused", () => {
        assert.throws(() => Plan.series.resources(Press, {
            key: "presses", title: "Presses", label: (press) => press.name,
            series: [Plan.series.section(Press, { key: "notes", title: "Notes" }, [])],
        }), /Plan\.series\.resources "presses": series\[0\] is a section "Notes" series — a resource's series are rows over its own row/);
    });
});

// ── A works of several kinds of resource, in one record ─────────────────────

const What = VariantType({ press: StructType({ sheets: IntegerType }), crew: StructType({ size: IntegerType }), bay: NullType });
const Resource = StructType({ name: StringType, what: What, readings: DictType(DateTimeType, FloatType) });
const Works = DictType(StringType, Resource);
const WORKS: ValueTypeOf<typeof Works> = new Map([
    ["B1", { name: "Bay 1", what: variant("bay", null), readings: readings() }],
    ["C1", { name: "Day crew", what: variant("crew", { size: 4n }), readings: readings() }],
    ["P03", { name: "Heidelberg 3", what: variant("press", { sheets: 8000n }), readings: readings([W27, 10]) }],
    ["P04", { name: "Heidelberg 4", what: variant("press", { sheets: 6000n }), readings: readings() }],
]);

const worksRoot = (bay: false | "drawn") => East.function([], Plan.Types.Root, ($) => {
    const data = $.const(WORKS, Works);
    return Plan.Root({
        axis, data,
        series: [Plan.series.kinds(Resource, "what", {
            press: {
                title: "Presses", label: (press, _key, kind) => East.str`${press.name} · ${East.print(kind.sheets)}`,
                series: [Plan.series.heat(Resource, { key: "utilisation", title: "Utilisation", label: () => "Utilisation", cells: () => Plan.heatCells([]) })],
            },
            crew: { title: "Crews", label: (crew, _key, kind) => East.str`${crew.name} (${East.print(kind.size)})` },
            bay: bay === false ? false : { key: "bays", title: "Bays", label: (b) => b.name },
        })],
    });
}).toIR().compile([])();

describe("a kinds block", () => {
    test("each entry is drawn by its case, in the source's order, each accessor handed the case's value", () => {
        const root = worksRoot("drawn");
        assert.ok(sameIds(ids(root), [
            entry("bays", "B1"), entry("crew", "C1"), entry("press", "P03"), entry("utilisation", "P03"), entry("press", "P04"), entry("utilisation", "P04"),
        ]));
        assert.ok(sameLabels(labels(root), ["Bay 1", "Day crew (4)", "Heidelberg 3 · 8000", "Utilisation", "Heidelberg 4 · 6000", "Utilisation"]));
    });

    test("a case drawn false leaves its entries out", () => {
        assert.ok(sameIds(ids(worksRoot(false)), [
            entry("crew", "C1"), entry("press", "P03"), entry("utilisation", "P03"), entry("press", "P04"), entry("utilisation", "P04"),
        ]));
    });

    test("its cases are the variant's, every one listed: one missing, one it lacks, and none drawn are refused", () => {
        assert.throws(() => Plan.series.kinds(Resource, "what", {
            press: { title: "Presses", label: () => "" }, crew: false,
        } as never), /Plan\.series\.kinds "what": every case of "what" is listed — a resources series, or false for one not drawn — and "bay" is not/);
        assert.throws(() => Plan.series.kinds(Resource, "what", {
            press: false, crew: false, bay: false, van: false,
        } as never), /Plan\.series\.kinds "what": "van" is no case of "what" \(bay, crew, press\)/);
        assert.throws(() => Plan.series.kinds(Resource, "what", { press: false, crew: false, bay: false }),
            /Plan\.series\.kinds "what": every case of "what" says false — draw at least one/);
        assert.throws(() => Plan.series.kinds(Resource, "name" as never, {} as never),
            /Plan\.series\.kinds "name": "name" is no variant field of its rows/);
        // A case names its resources: one with no `label` is refused by its name.
        assert.throws(() => Plan.series.kinds(Resource, "what", { press: { title: "Presses" }, crew: false, bay: false } as never),
            /^Error: Plan\.series\.kinds "what": case "press": `label` is the resource's name in the gutter, a function of the row — label: \(row\) => row\.name$/);
    });

    test("a case's key is unique across the series tree, as every series' is", () => {
        assert.throws(() => East.function([], Plan.Types.Root, ($) => {
            const data = $.const(WORKS, Works);
            return Plan.Root({
                axis, data,
                series: [
                    Plan.series.kinds(Resource, "what", {
                        press: { title: "Presses", label: (r) => r.name }, crew: false, bay: false,
                    }),
                    Plan.series.span(Resource, { key: "press", title: "Jobs", label: (r) => r.name, runs: () => [] }),
                ],
            });
        }), /two series share the key "press"/);
    });
});

// ── Child rows of another type beneath a resource (#1541, U2) ───────────────

const TaskKindRow = StructType({ name: StringType });
const Machine = StructType({
    name: StringType,
    what: VariantType({ folder: NullType, press: NullType }),
    readings: DictType(DateTimeType, FloatType),
    kinds: DictType(StringType, TaskKindRow),
});
const Machines = DictType(StringType, Machine);
const MACHINES: ValueTypeOf<typeof Machines> = new Map([
    ["F1", { name: "Folder 1", what: variant("folder", null), readings: readings(), kinds: new Map() }],
    ["P03", { name: "Heidelberg 3", what: variant("press", null), readings: readings([W27, 10]), kinds: new Map([["ink", { name: "Ink fill" }], ["wash", { name: "Blanket wash" }]]) }],
    ["P04", { name: "Heidelberg 4", what: variant("press", null), readings: readings(), kinds: new Map() }],
]);
/** The rows an event kind's `child` lands on: a row per kind of task a press takes. */
const kindRows = () => Plan.series.resources(TaskKindRow, { key: "kinds", title: "Tasks", label: (kind) => kind.name });
const utilisation = () => Plan.series.heat(Machine, { key: "utilisation", title: "Utilisation", label: () => "Utilisation", cells: () => Plan.heatCells([]) });

const machinesRoot = East.function([], Plan.Types.Root, ($) => {
    const data = $.const(MACHINES, Machines);
    return Plan.Root({
        axis, data,
        series: [Plan.series.kinds(Machine, "what", {
            press: { title: "Presses", label: (press) => press.name, series: [utilisation()], children: Plan.children("kinds", [kindRows()]) },
            folder: { title: "Folders", label: (folder) => folder.name },
        })],
    });
}).toIR().compile([])();

describe("a resource's child rows of another type (#1541, U2)", () => {
    test("a case's children follow its series, each child row at its resource's path and its own key, nested under the landing row", () => {
        assert.ok(sameIds(ids(machinesRoot), [
            entry("folder", "F1"),
            entry("press", "P03"), entry("utilisation", "P03"), entry("kinds", "P03", "ink"), entry("kinds", "P03", "wash"),
            entry("press", "P04"), entry("utilisation", "P04"),
        ]));
        assert.ok(sameParents(parents(machinesRoot), [
            none,
            none, some(entry("press", "P03")), some(entry("press", "P03")), some(entry("press", "P03")),
            none, some(entry("press", "P04")),
        ]));
        assert.ok(sameLabels(labels(machinesRoot), ["Folder 1", "Heidelberg 3", "Utilisation", "Ink fill", "Blanket wash", "Heidelberg 4", "Utilisation"]));
    });

    test("a resources series takes them too, one step-down or several in order", () => {
        const root = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(MACHINES, Machines);
            return Plan.Root({
                axis, data,
                series: [Plan.series.resources(Machine, {
                    key: "machines", title: "Machines", label: (machine) => machine.name,
                    children: [
                        Plan.children("kinds", [kindRows()]),
                        Plan.children("kinds", [Plan.series.span(TaskKindRow, { key: "runs", title: "Runs", label: (kind) => kind.name, runs: () => [] })]),
                    ],
                })],
            });
        }).toIR().compile([])();
        assert.ok(sameIds(ids(root), [
            entry("machines", "F1"),
            entry("machines", "P03"), entry("kinds", "P03", "ink"), entry("kinds", "P03", "wash"), entry("runs", "P03", "ink"), entry("runs", "P03", "wash"),
            entry("machines", "P04"),
        ]));
    });

    test("a case with `row: false` draws no row of its own: its series and its children stand at its level, under what it was under", () => {
        const root = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(MACHINES, Machines);
            return Plan.Root({
                axis, data,
                series: [Plan.series.kinds(Machine, "what", {
                    press: { title: "Press", row: false, series: [utilisation()], children: Plan.children("kinds", [kindRows()]) },
                    folder: false,
                })],
            });
        }).toIR().compile([])();
        assert.ok(sameIds(ids(root), [
            entry("utilisation", "P03"), entry("kinds", "P03", "ink"), entry("kinds", "P03", "wash"),
            entry("utilisation", "P04"),
        ]));
        assert.ok(sameParents(parents(root), [none, none, none, none]));
        assert.ok(sameLabels(labels(root), ["Utilisation", "Ink fill", "Blanket wash", "Utilisation"]));
        // Any other `row` is refused, naming the case.
        assert.throws(() => Plan.series.kinds(Machine, "what", { press: { title: "Press", row: true as never, label: (m) => m.name }, folder: false }),
            /Plan\.series\.kinds "what": case "press": row is false — its own row not drawn, its series and children at its level — or left out/);
    });

    test("child rows from a list (U12) draw beneath each row, read with it: the same kinds under every press", () => {
        const Kinds = DictType(StringType, TaskKindRow);
        const root = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(MACHINES, Machines);
            const kinds = $.const(new Map([["check", { name: "Plate check" }], ["wash", { name: "Blanket wash" }]]), Kinds);
            return Plan.Root({
                axis, data,
                series: [Plan.series.kinds(Machine, "what", {
                    press: { title: "Presses", label: (press) => press.name, children: Plan.children.of(() => kinds, [kindRows()]) },
                    folder: false,
                })],
            });
        }).toIR().compile([])();
        assert.ok(sameIds(ids(root), [
            entry("press", "P03"), entry("kinds", "P03", "check"), entry("kinds", "P03", "wash"),
            entry("press", "P04"), entry("kinds", "P04", "check"), entry("kinds", "P04", "wash"),
        ]));
        assert.ok(sameLabels(labels(root), ["Heidelberg 3", "Plate check", "Blanket wash", "Heidelberg 4", "Plate check", "Blanket wash"]));
    });

    test("child rows from a list are read only: a series over them that declares `edit` is refused, naming it, at any depth", () => {
        const Crew = StructType({ name: StringType, hours: DictType(DateTimeType, FloatType) });
        const typed = () => Plan.series.table(Crew, {
            key: "hours", title: "Hours", label: (crew) => crew.name, edit: true,
            cells: Plan.tableCells(Plan.values("hours", (h) => ({ value: some(h) }))),
        });
        assert.throws(() => Plan.children.of(() => new Map(), [typed()]),
            /^Error: Plan\.children\.of: table "Hours" declares `edit`, and the rows of a list are read only — leave `edit` out, or keep the rows in the record and step down to their field: Plan\.children\(field, \[series…\]\)$/);
        assert.throws(() => Plan.children.of(() => new Map(), [Plan.series.resources(Crew, { key: "crews", title: "Crews", label: (crew) => crew.name, series: [typed()] })]),
            /Plan\.children\.of: table "Hours" declares `edit`/);
        assert.throws(() => Plan.children.of("kinds" as never, [kindRows()]), /Plan\.children\.of: give the function returning the child rows/);
    });

    test("children that are neither a tree's field nor step-downs are refused, naming the series", () => {
        assert.throws(() => Plan.series.resources(Machine, { key: "machines", title: "Machines", label: (m) => m.name, children: 3 as never }),
            /Plan\.series\.resources "machines": `children` is a field of the row holding more of its rows, or Plan\.children\(field, \[series…\]\) step-downs/);
        assert.throws(() => Plan.series.resources(Machine, { key: "machines", title: "Machines", label: (m) => m.name, children: Plan.children("name" as never, [kindRows()]) }),
            /Plan\.children: "name" is a String — child rows are a Dict, keyed by an id/);
    });
});

// ── #1541 §3.5's series, over a plain record of the works' groups ───────────
// A crew's roles are keyed by their name here: child rows keyed by a variant
// (§3.5's `keyType: RoleType`) are #1540's, which a later pull request lands.

const RoleHoursType = StructType({ hours: DictType(DateTimeType, FloatType) });
const ResourceRowType = StructType({
    name: StringType,
    what: VariantType({ press: StructType({ sheets_per_hour: FloatType }), line: NullType, crew: NullType, bay: NullType, van: NullType }),
    utilisation: DictType(DateTimeType, FloatType),
    hours: DictType(StringType, RoleHoursType),
});
const GroupRowType = StructType({ name: StringType, resources: DictType(StringType, ResourceRowType) });
const Groups = DictType(StringType, GroupRowType);
type ResourceRow = ValueTypeOf<typeof ResourceRowType>;
const resource = (name: string, what: ResourceRow["what"], hours: ResourceRow["hours"] = new Map()): ResourceRow =>
    ({ name, what, utilisation: readings([W27, 96]), hours });
const GROUPS: ValueTypeOf<typeof Groups> = new Map([
    ["hall-a", { name: "Hall A", resources: new Map([
        ["a1", resource("Press A1", variant("press", { sheets_per_hour: 12000.0 }))],
        ["c1", resource("Crew 1", variant("crew", null), new Map([
            ["assistant", { hours: readings([W27, 30]) }], ["operator", { hours: readings([W27, 40]) }],
        ]))],
    ]) }],
    ["dispatch", { name: "Dispatch", resources: new Map([["bay", resource("Bay", variant("bay", null))], ["van1", resource("Van 1", variant("van", null))]]) }],
]);

/** §3.5's series as the issue writes them: no `label` on the series beneath a resource, its row named by the resource. */
const worksSeries = () => [
    Plan.series.group(GroupRowType, {
        key: "groups", title: "Works", label: (group) => group.name,
        children: Plan.children("resources", [
            Plan.series.kinds(ResourceRowType, "what", {
                press: {
                    title: "Presses", icon: "print", label: (press) => press.name,
                    series: [
                        Plan.series.heat(ResourceRowType, {
                            key: "utilisation", title: "Utilisation",
                            cells: Plan.heatCells(Plan.values("utilisation", (pct) => ({ value: some(pct) })), { min: 0, max: 100, warnAt: 95 }),
                        }),
                    ],
                },
                line: { title: "Bindery lines", icon: "book-open", label: (line) => line.name },
                crew: {
                    title: "Crews", icon: "users", label: (crew) => crew.name,
                    series: [
                        Plan.series.table(ResourceRowType, {
                            key: "hours", title: "Hours", aggregate: "sum", collapsed: true,
                            children: Plan.children("hours", [Plan.series.table(RoleHoursType, {
                                key: "role", title: "Role", edit: true,
                                label: (_hours, role) => role.equal("assistant").ifElse(() => "Assistant", () => "Operator"),
                                cells: Plan.tableCells(Plan.values("hours", (h) => ({ value: some(h) }))),
                            })]),
                        }),
                    ],
                },
                bay: { title: "Bays", icon: "warehouse", label: (bay) => bay.name },
                van: { title: "Vans", icon: "truck", label: (van) => van.name },
            }),
        ]),
    }),
];

describe("#1541 §3.5's series", () => {
    test("build as written: each group's resources drawn by their kind, a press's utilisation and a crew's hours beneath it, each named by its title", () => {
        const root = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(GROUPS, Groups);
            return Plan.Root({ axis, data, series: worksSeries() });
        }).toIR().compile([])();
        // The groups in their keys' order, as a Dict holds them: "dispatch", then "hall-a".
        assert.ok(sameLabels(labels(root), [
            "Dispatch", "Bay", "Van 1",
            "Hall A", "Press A1", "Utilisation", "Crew 1", "Hours", "Assistant", "Operator",
        ]), printFor(ArrayType(StringType))(labels(root)));
        const at = (series: string, ...path: string[]) => rowsOf(root).find((r) => sameIds([r.id], [entry(series, ...path)]));
        // Each resource's landing row at its path under its case's key; its series at the same path beneath it.
        assert.ok(at("press", "hall-a", "a1") !== undefined && at("utilisation", "hall-a", "a1") !== undefined);
        assert.ok(at("crew", "hall-a", "c1") !== undefined && at("hours", "hall-a", "c1") !== undefined);
        assert.ok(at("bay", "dispatch", "bay") !== undefined && at("van", "dispatch", "van1") !== undefined);
        assert.ok(sameParents([at("utilisation", "hall-a", "a1")!.parent], [some(entry("press", "hall-a", "a1"))]));
    });

    test("a series given no `label` stands beneath a resource alone: anywhere else it is refused, naming where it sits", () => {
        const unlabelled = () => Plan.series.heat(Press, { key: "utilisation", title: "Utilisation", cells: () => Plan.heatCells([]) });
        assert.throws(() => East.function([], Plan.Types.Root, ($) => {
            const data = $.const(PRESSES, Presses);
            return Plan.Root({ axis, data, series: [unlabelled()] });
        }), /^Error: Plan: series\[0\] heat "Utilisation" gives no `label` — each of its rows is an entry's, named by it: give `label`, or lay it beneath a resource, in a resources series' or a kinds case's `series`, whose own row names it$/);
        // A views member writes its label again in each series.
        assert.throws(() => Plan.series.views(Press, { key: "views", title: "Views" }, [unlabelled()]),
            /gives no `label` — each of its rows is an entry's, named by it/);
        // Beneath a resource it builds, named by its title.
        assert.doesNotThrow(() => Plan.series.resources(Press, { key: "presses", title: "Presses", label: (p) => p.name, series: [unlabelled()] }));
        // A resources series names its own rows: with no `label` it is refused by its key.
        assert.throws(() => Plan.series.resources(Press, { key: "presses", title: "Presses" } as never),
            /^Error: Plan\.series\.resources "presses": `label` is the resource's name in the gutter, a function of the row — label: \(row\) => row\.name$/);
    });
});

/** Never run: each line marked below must fail to compile, or the build fails on the unused directive. */
export function planKindsTypeChecks(): void {
    // Every case of the variant is listed: one left out fails to compile, as an East `match` does.
    // @ts-expect-error — "bay" is not listed
    Plan.series.kinds(Resource, "what", { press: { title: "Presses", label: (r) => r.name }, crew: false });
    // A case the variant lacks fails too.
    // @ts-expect-error — "van" is no case of "what"
    Plan.series.kinds(Resource, "what", { press: false, crew: false, bay: { title: "Bays", label: (r) => r.name }, van: false });
    // A field that holds no variant is no kinds block's.
    // @ts-expect-error — "name" holds a String
    Plan.series.kinds(Resource, "name", {});
}

// ── Child rows keyed by any type but a DateTime (#1540, E1) ─────────────────

describe("child rows keyed by another type than String (#1540, E1)", () => {
    const Kind = VariantType({ ink_fill: NullType, wash: NullType });
    const Press = StructType({
        name: StringType,
        kinds: DictType(Kind, TaskKindRow),
        counts: DictType(IntegerType, TaskKindRow),
        days: DictType(DateTimeType, TaskKindRow),
    });
    const Presses = DictType(StringType, Press);
    const PRESSES: ValueTypeOf<typeof Presses> = new Map([
        ["P03", {
            name: "Heidelberg 3",
            kinds: new SortedMap<ValueTypeOf<typeof Kind>, ValueTypeOf<typeof TaskKindRow>>(
                [[variant("ink_fill", null), { name: "Ink fill" }], [variant("wash", null), { name: "Blanket wash" }]], compareFor(Kind)),
            counts: new SortedMap<bigint, ValueTypeOf<typeof TaskKindRow>>([[2n, { name: "Second" }], [10n, { name: "Tenth" }]], compareFor(IntegerType)),
            days: new SortedMap<Date, ValueTypeOf<typeof TaskKindRow>>([], compareFor(DateTimeType)),
        }],
    ]);
    /** The presses, each with the rows of one of its fields beneath it, the rows' series keyed by `keyType`. */
    const rootOver = <K extends typeof Kind | typeof IntegerType>(field: "kinds" | "counts", keyType: K, label: (row: { name: unknown }, key: unknown) => unknown) =>
        East.function([], Plan.Types.Root, ($) => Plan.Root({
            axis, data: $.const(PRESSES, Presses),
            series: [Plan.series.resources(Press, {
                key: "presses", title: "Presses", label: (press) => press.name,
                children: Plan.children(field, [Plan.series.resources(TaskKindRow, { key: "rows", title: "Rows", keyType, label: label as never })]),
            })],
        } as never)).toIR().compile([])();

    test("a variant keys them: each row at its parent's path and its key as East prints it, in the keys' own order", () => {
        const root = rootOver("kinds", Kind, (row) => row.name);
        assert.ok(sameIds(ids(root), [entry("presses", "P03"), entry("rows", "P03", ".ink_fill"), entry("rows", "P03", ".wash")]));
        assert.ok(sameLabels(labels(root), ["Heidelberg 3", "Ink fill", "Blanket wash"]));
    });

    test("an Integer keys them: in the Integers' order, never their text's, and an accessor hears each key at its type", () => {
        const root = rootOver("counts", IntegerType, (row, key) => East.str`${row.name as never} (${(key as never)})`);
        assert.ok(sameIds(ids(root), [entry("presses", "P03"), entry("rows", "P03", "2"), entry("rows", "P03", "10")]));
        assert.ok(sameLabels(labels(root), ["Heidelberg 3", "Second (2)", "Tenth (10)"]));
    });

    test("a Dict keyed by a DateTime is values over time, never child rows: refused, naming the field", () => {
        assert.throws(() => East.function([], Plan.Types.Root, ($) => Plan.Root({
            axis, data: $.const(PRESSES, Presses),
            series: [Plan.series.resources(Press, {
                key: "presses", title: "Presses", label: (press) => press.name,
                children: Plan.children("days" as never, [Plan.series.resources(TaskKindRow, { key: "rows", title: "Rows", label: (row) => row.name })]),
            })],
        })), /Plan\.children: "days" is keyed by a DateTime — child rows are keyed by an id, and a Dict keyed by a DateTime is values over time: read it with Plan\.values/);
    });
});

// ── An event kind's child: the rows beneath its resource (#1541, U1) ────────

const Half = VariantType({ am: NullType, pm: NullType });
const Task = StructType({ title: StringType, day: DateTimeType, press: StringType, kind: OptionType(StringType), half: Half });
const Tasks = DictType(StringType, Task);
const DAY = new Date("2026-06-30T00:00:00Z");
const TASKS: ValueTypeOf<typeof Tasks> = new Map([
    ["T-1", { title: "Ink", day: DAY, press: "P03", kind: some("ink"), half: variant("am", null) }],
    ["T-2", { title: "Wash", day: DAY, press: "P03", kind: some("wash"), half: variant("pm", null) }],
    ["T-3", { title: "Ink again", day: DAY, press: "P03", kind: some("ink"), half: variant("pm", null) }],
    // On a press that has no such row beneath it, and on no row beneath its press.
    ["T-4", { title: "Stray", day: DAY, press: "P04", kind: some("ink"), half: variant("am", null) }],
    ["T-5", { title: "Unplaced", day: DAY, press: "P03", kind: none, half: variant("am", null) }],
]);
const tasksRecord = recordHandle(Tasks, TASKS, "tasks");
/** The presses, each with its kinds of task beneath it. */
const pressCase = (more: object = {}) => ({ title: "Presses", label: (press: { name: unknown }) => press.name, children: Plan.children("kinds", [kindRows()]), ...more });

/** A Plan of the machines with the tasks, a kind landing on the rows beneath its press; `kind` and `press` say otherwise. */
function tasksPayload($: BlockBuilder<EastType>, kind: object = {}, press: object = pressCase()) {
    return Plan.Payload({
        axis, data: $.const(MACHINES, Machines),
        series: [Plan.series.kinds(Machine, "what", { press, folder: { title: "Folders", label: (folder: { name: unknown }) => folder.name } } as never)],
        events: {
            task: Schedule.events($.let(tasksRecord()) as never, {
                name: "Task", icon: "list-check", title: "title", at: "day", draw: "buckets",
                resource: { field: "press", of: "press" }, child: { field: "kind", of: "kinds" }, lane: "half", ...kind,
            } as never),
        },
    } as never);
}

/** What that Plan throws as it is built; `""` when it builds. */
function tasksRefusal(kind: object = {}, press: object = pressCase()): string {
    try {
        East.function([], NullType, ($) => { tasksPayload($ as never, kind, press); });
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

describe("an event kind's `child`: its events on the rows beneath its resource (#1541, U1)", () => {
    const payload = East.compile(East.function([], PlanPayloadType, ($) => tasksPayload($ as never)), [])();
    const printRef = printFor(Schedule.Types.EventRef);
    const sameKeys = equalFor(ArrayType(StringType));
    const refs = (...keys: string[]) => keys.map((key) => printRef({ kind: "task", key }));

    /** The canvas's rows with the tasks joined in, every row read whole. */
    function placedRows() {
        if (payload.seam.type !== "some") assert.fail("expected the event kinds' seam");
        const rows = payload.plan.rows;
        if (rows.type !== "inline") assert.fail("expected the rows read whole");
        const placed = payload.seam.value.placed(W27, new Date("2026-07-06T00:00:00Z"), new Map(), [], new Map());
        if (placed.type !== "some") assert.fail("expected the tasks read");
        return payload.seam.value.place(rows.value, placed.value, new Map(), [], true).flatMap((block) => block.rows);
    }
    /** A row's tiles and lanes, by its id. */
    function tilesOn(id: ValueTypeOf<typeof Plan.Types.RowId>) {
        const row = placedRows().find((one) => sameIds([one.id], [id]));
        if (row === undefined || row.kind.type !== "buckets") assert.fail(`no row of tiles ${printFor(Plan.Types.RowId)(id)}`);
        return { keys: row.kind.value.events.map((tile) => tile.key), lanes: row.kind.value.lanes.map((lane) => lane.key), tiles: row.kind.value.events };
    }

    test("the kind lands on the series its `child` names, a step beneath its resource's, and never on the resource's own", () => {
        const landing = (key: string) => payload.landings.find((one) => one.key === key)!;
        assert.ok(sameKeys(landing("kinds").kinds, ["task"]));
        assert.ok(sameKeys(landing("kinds").draws.map((draw) => draw.type), ["buckets"]));
        assert.ok(equalFor(OptionType(StringType))(landing("kinds").under, some("press")));
        assert.ok(sameKeys(landing("press").kinds, []));
        assert.equal(landing("press").draws.length, 0);
        assert.equal(landing("press").under.type, "none");
        assert.ok(equalFor(OptionType(StructType({ field: StringType, of: StringType })))(payload.events[0]!.child, some({ field: "kind", of: "kinds" })));
    });

    test("each task draws on its press's row of its kind, by the press's key and the kind's together; a press's own row draws none", () => {
        assert.ok(sameKeys(tilesOn(entry("kinds", "P03", "ink")).keys, refs("T-1", "T-3")));
        assert.ok(sameKeys(tilesOn(entry("kinds", "P03", "wash")).keys, refs("T-2")));
        const press = placedRows().find((one) => sameIds([one.id], [entry("press", "P03")]))!;
        assert.notEqual(press.kind.type, "buckets");
    });

    test("a variant `lane` draws a lane for every case, empty or not, by name, each tile in its case's", () => {
        const ink = tilesOn(entry("kinds", "P03", "ink"));
        assert.ok(sameKeys(ink.lanes, ["am", "pm"]));
        assert.ok(equalFor(ArrayType(OptionType(StringType)))(ink.tiles.map((tile) => tile.lane), [some("am"), some("pm")]));
        // Blanket wash has a task in the afternoon alone, and both its lanes.
        assert.ok(sameKeys(tilesOn(entry("kinds", "P03", "wash")).lanes, ["am", "pm"]));
    });

    test("a task on a press with no such row beneath it, or whose field holds none, is on no row: its kind's Unassigned row draws it", () => {
        assert.ok(sameKeys(tilesOn(entry("task.unassigned", "buckets")).keys, refs("T-4", "T-5")));
    });

    test("the Plan holds `child` to its series at build, naming the kind", () => {
        assert.equal(tasksRefusal(), "");
        assert.match(tasksRefusal({ child: { field: "kind", of: "tasks" } }),
            /^Plan: events\.task's child names "tasks", and no resources series or kinds case has that key \(folder, press, kinds\) — `child\.of` names a resources series among the `children` of the series its resource names$/);
        assert.match(tasksRefusal({ child: { field: "kind", of: "folder" } }),
            /^Plan: events\.task's child names "folder", whose rows stand beneath no resources series — `child\.of` names a resources series among the `children` of the series its resource names \(press\)$/);
        assert.match(tasksRefusal({ child: { field: "day", of: "kinds" } }),
            /^Plan: events\.task's child field "day" holds \.DateTime, the key of a row of "kinds" — and those rows are keyed by \.String$/);
    });

    test("a kind landing on a series that draws no row of its own is refused, unless its `child` names the rows beneath (#1541, U2)", () => {
        const undrawn = pressCase({ row: false, label: undefined });
        assert.equal(tasksRefusal({}, undrawn), "");
        assert.match(tasksRefusal({ child: undefined }, undrawn),
            /^Plan: events\.task lands on the rows of "press", and that series draws no row of its own \(row: false\) — give the kind `child`, the rows beneath each it lands on, or draw the series' rows$/);
    });
});
