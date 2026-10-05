/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import {
    East, ArrayType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, StringType, StructType,
    example, none, some, variant,
} from "@elaraai/east";
import { Reactive, SegmentGroup, Slice, State, StatusValueType, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data, Record, Sheet } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// The Sheet builder (Sheet Builder Spec.md §3, #1183): an e3 record edited as
// a sheet, in BuilderFrame with a library and an inspector beside it.
// `sheetBuilder` is the smallest (§3.2), `sheetBuilderWorkshop` the joinery
// workshop's orders (§3.3), `sheetBuilderWeeks` one entry's rows and
// `sheetBuilderPaged` a record read a window at a time (§3.4).
//
// Every record is seeded with an authored literal (§2a), so each pane of the
// builder has something in it from the first: the sheet its rows, the
// library's Rows tab the templates, its Registers tab the activities, the
// machines and the statuses, its Columns tab the columns, and the inspector
// the selected row's fields and the batch's issues. The names are made up;
// the domain is a joinery workshop (decision 14).
// ============================================================================

// ============================================================================
// sheetBuilder — the smallest builder (§3.2)
// ============================================================================

/** A job — what it is, when it starts and how many. */
export const BuilderJob = StructType({ task: StringType, start: OptionType(DateTimeType), qty: OptionType(FloatType) });
/** The jobs, keyed J-0001, J-0002, …: the record's entries are the sheet's rows. */
export const sheetBuilderJobs = e3.record("sheet_builder_jobs", DictType(StringType, BuilderJob), new Map([
    ["J-0001", { task: "Panel cutting", start: some(new Date("2026-10-12T00:00:00Z")), qty: some(48.0) }],
    ["J-0002", { task: "Edge banding", start: some(new Date("2026-10-13T00:00:00Z")), qty: some(120.0) }],
    ["J-0003", { task: "CNC routing", start: none, qty: some(48.0) }],
    ["J-0004", { task: "Spray finish", start: none, qty: none }],
]));
/** The jobs' patch door — every Apply commits through it. */
export const sheetBuilderJobsPatch = e3.mutation.patch(sheetBuilderJobs);

/**
 * The smallest builder (§3.2) — the jobs an e3 record holds, edited as a
 * sheet: one row per job in key order and a blank tail for the next, every
 * gesture a draft the history item undoes, and Apply one commit through the
 * record's patch door.
 */
export const sheetBuilder = example({
    keywords: ["Sheet", "Builder", "Sheet.Builder", "record", "Record", "Record.bind", "e3.record", "patch", "commit", "BuilderFrame", "library", "inspector", "key order"],
    description: "The smallest sheet builder — an e3 record's entries as the rows, in key order, edited as drafts and applied as one commit through the record's patch door",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const jobs = $.let(Record.bind(sheetBuilderJobs, [sheetBuilderJobsPatch]));
            return (
                <Sheet.Builder
                    record={jobs}
                    columns={{
                        task:  Sheet.column.text(BuilderJob, { header: "Task", width: "240px" }),
                        start: Sheet.column.date(BuilderJob, { header: "Start", width: "96px" }),
                        qty:   Sheet.column.quantity(BuilderJob, { header: "Qty", width: "96px" }),
                    }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetBuilderWorkshop — the joinery workshop's orders (§3.3)
// ============================================================================

/** An activity — the driver's row: its unit, and how many days it takes. */
export const BuilderActivity = StructType({ name: StringType, uom: StringType, days: IntegerType });
/** A machine — its family and the bay it stands in; its code is its key. */
export const BuilderMachine = StructType({ family: StringType, bay: StringType });
/** A status — a word of the statuses register, and its tone. */
export const BuilderStatus = StructType({ word: StringType, tone: StatusValueType });
/** One operation of an order. */
export const BuilderOperation = StructType({
    activity:   StringType,                    // the driver: an activity's name
    start:      OptionType(DateTimeType),
    end:        OptionType(DateTimeType),
    qty:        OptionType(FloatType),         // in the activity's unit
    machines:   Sheet.Types.Link,              // work centres, from → to
    notes:      StringType,
    created_by: StringType,                    // no column: the inspector shows it
});
/** An order — its name, customer, due date and status, and its operations in order. */
export const BuilderOrder = StructType({
    name:     StringType,
    customer: StringType,
    due:      OptionType(DateTimeType),
    status:   StringType,                      // a word of the statuses register
    ops:      ArrayType(BuilderOperation),
});

/** The activities — the driver's members, each with its unit and days. */
export const sheetBuilderActivities = e3.input("sheet_builder_activities", ArrayType(BuilderActivity), variant("value", [
    { name: "Panel cutting", uom: "panels", days: 1n },
    { name: "Edge banding", uom: "metres", days: 1n },
    { name: "CNC routing", uom: "panels", days: 2n },
    { name: "Drilling", uom: "panels", days: 1n },
    { name: "Sanding", uom: "panels", days: 1n },
    { name: "Assembly", uom: "units", days: 2n },
    { name: "Spray finish", uom: "doors", days: 3n },
    { name: "Wrapping", uom: "units", days: 1n },
    { name: "Delivery", uom: "loads", days: 1n },
]));
/** The machines, keyed by code — the work centres' register. */
export const sheetBuilderMachines = e3.record("sheet_builder_machines", DictType(StringType, BuilderMachine), new Map([
    ["S101", { family: "beam saw", bay: "Bay 1" }],
    ["S102", { family: "beam saw", bay: "Bay 1" }],
    ["S103", { family: "beam saw", bay: "Bay 1" }],
    ["E201", { family: "edge bander", bay: "Bay 2" }],
    ["E202", { family: "edge bander", bay: "Bay 2" }],
    ["R301", { family: "CNC router", bay: "Bay 3" }],
    ["R302", { family: "CNC router", bay: "Bay 3" }],
    ["R303", { family: "CNC router", bay: "Bay 3" }],
    ["F401", { family: "spray booth", bay: "Bay 4" }],
    ["F402", { family: "spray booth", bay: "Bay 4" }],
    ["A701", { family: "assembly bench", bay: "Bay 7" }],
    ["A702", { family: "assembly bench", bay: "Bay 7" }],
]));
/** The orders, keyed by order number: each a group, its operations its lines. */
export const sheetBuilderOrders = e3.record("sheet_builder_orders", DictType(StringType, BuilderOrder), new Map([
    ["WO-2201", { name: "WO-2201 · Kitchen, oak", customer: "Quillfeather Interiors", due: some(new Date("2026-10-23T00:00:00Z")), status: "RELEASED", ops: [
        { activity: "Panel cutting", start: some(new Date("2026-10-12T00:00:00Z")), end: some(new Date("2026-10-13T00:00:00Z")), qty: some(48.0),
          machines: { from: [variant("identified", { key: "S101" })], to: [variant("identified", { key: "E201" })] }, notes: "Oak veneered board", created_by: "planner" },
        { activity: "Edge banding", start: some(new Date("2026-10-14T00:00:00Z")), end: some(new Date("2026-10-15T00:00:00Z")), qty: some(120.0),
          machines: { from: [variant("identified", { key: "E201" })], to: [variant("identified", { key: "R301" })] }, notes: "", created_by: "planner" },
        { activity: "CNC routing", start: some(new Date("2026-10-15T00:00:00Z")), end: some(new Date("2026-10-17T00:00:00Z")), qty: some(48.0),
          machines: { from: [variant("identified", { key: "R301" })], to: [variant("identified", { key: "A701" })] }, notes: "Hinge cups and handle slots", created_by: "planner" },
        { activity: "Assembly", start: none, end: none, qty: some(12.0),
          machines: { from: [], to: [variant("identified", { key: "A701" })] }, notes: "Twelve carcasses", created_by: "planner" },
        { activity: "Spray finish", start: none, end: none, qty: some(24.0),
          machines: { from: [], to: [variant("identified", { key: "F401" })] }, notes: "Matt lacquer", created_by: "planner" },
    ] }],
    ["WO-2202", { name: "WO-2202 · Wardrobes, ash", customer: "Marrowby Lettings", due: some(new Date("2026-10-30T00:00:00Z")), status: "PLANNED", ops: [
        { activity: "Panel cutting", start: some(new Date("2026-10-13T00:00:00Z")), end: some(new Date("2026-10-14T00:00:00Z")), qty: some(36.0),
          machines: { from: [variant("identified", { key: "S102" })], to: [variant("identified", { key: "E202" })] }, notes: "", created_by: "planner" },
        { activity: "Edge banding", start: none, end: none, qty: some(90.0),
          machines: { from: [variant("identified", { key: "E202" })], to: [] }, notes: "", created_by: "planner" },
        { activity: "Drilling", start: none, end: none, qty: some(36.0),
          machines: { from: [], to: [variant("identified", { key: "R302" })] }, notes: "Hinge and shelf pins", created_by: "planner" },
        { activity: "Assembly", start: none, end: none, qty: some(6.0),
          machines: { from: [], to: [variant("identified", { key: "A702" })] }, notes: "", created_by: "planner" },
    ] }],
    ["WO-2203", { name: "WO-2203 · Vanity unit, walnut", customer: "Tallowmere Homes", due: some(new Date("2026-11-02T00:00:00Z")), status: "PLANNED", ops: [
        { activity: "Panel cutting", start: none, end: none, qty: some(12.0),
          machines: { from: [], to: [variant("identified", { key: "S101" })] }, notes: "", created_by: "planner" },
        { activity: "CNC routing", start: none, end: none, qty: some(12.0),
          machines: { from: [], to: [variant("counted", { n: 1n, key: "CNC router" })] }, notes: "Basin cut-out", created_by: "planner" },
        { activity: "Spray finish", start: none, end: none, qty: some(4.0),
          machines: { from: [], to: [variant("identified", { key: "F402" })] }, notes: "", created_by: "planner" },
        { activity: "Assembly", start: none, end: none, qty: some(2.0),
          machines: { from: [], to: [] }, notes: "", created_by: "planner" },
    ] }],
    ["WO-2204", { name: "WO-2204 · Shelving, birch", customer: "Pebblecombe School", due: some(new Date("2026-10-20T00:00:00Z")), status: "ON HOLD", ops: [
        { activity: "Panel cutting", start: none, end: none, qty: some(60.0),
          machines: { from: [], to: [variant("counted", { n: 2n, key: "beam saw" })] }, notes: "Awaiting board delivery", created_by: "planner" },
        { activity: "Edge banding", start: none, end: none, qty: some(150.0),
          machines: { from: [], to: [] }, notes: "", created_by: "planner" },
        { activity: "Sanding", start: none, end: none, qty: some(60.0),
          machines: { from: [], to: [] }, notes: "", created_by: "planner" },
    ] }],
    ["WO-2205", { name: "WO-2205 · Office fit-out, maple", customer: "", due: none, status: "PLANNED", ops: [
        { activity: "Panel cutting", start: none, end: none, qty: some(80.0),
          machines: { from: [], to: [] }, notes: "", created_by: "planner" },
        { activity: "CNC routing", start: none, end: none, qty: some(40.0),
          machines: { from: [], to: [] }, notes: "Cable ports", created_by: "planner" },
        { activity: "Assembly", start: none, end: none, qty: some(10.0),
          machines: { from: [], to: [] }, notes: "", created_by: "planner" },
        { activity: "Wrapping", start: none, end: none, qty: some(10.0),
          machines: { from: [], to: [] }, notes: "", created_by: "planner" },
        { activity: "Delivery", start: none, end: none, qty: some(2.0),
          machines: { from: [], to: [] }, notes: "", created_by: "planner" },
    ] }],
    ["WO-2206", { name: "WO-2206 · Kitchen, painted", customer: "Orrisdale Cottages", due: some(new Date("2026-11-06T00:00:00Z")), status: "PLANNED", ops: [
        { activity: "Panel cutting", start: none, end: none, qty: some(30.0),
          machines: { from: [], to: [variant("identified", { key: "S103" })] }, notes: "", created_by: "planner" },
        { activity: "Edge banding", start: none, end: none, qty: some(70.0),
          machines: { from: [], to: [variant("counted", { n: 1n, key: "edge bander" })] }, notes: "", created_by: "planner" },
        { activity: "Spray finish", start: none, end: none, qty: some(18.0),
          machines: { from: [], to: [variant("identified", { key: "F401" })] }, notes: "Primer, then two coats", created_by: "planner" },
        { activity: "Assembly", start: none, end: none, qty: some(8.0),
          machines: { from: [], to: [] }, notes: "", created_by: "planner" },
        { activity: "Wrapping", start: none, end: none, qty: some(8.0),
          machines: { from: [], to: [] }, notes: "", created_by: "planner" },
        { activity: "Delivery", start: none, end: none, qty: some(1.0),
          machines: { from: [], to: [] }, notes: "", created_by: "planner" },
    ] }],
]));
/** The orders' patch door — every Apply commits through it. */
export const sheetBuilderOrdersPatch = e3.mutation.patch(sheetBuilderOrders);

/**
 * The joinery workshop's orders (§3.3) — a grouped sheet over a record: each
 * order a group, its operations its lines. An activity driver, a machines
 * register from a record and a statuses register, a copilot fill, a check on
 * each order, templates for whole orders and single operations, the slice's
 * search and filter, and views kept per viewer. The library's Rows tab holds
 * the templates and its Registers tab the members; the order with no customer
 * is the batch's issue.
 */
export const sheetBuilderWorkshop = example({
    keywords: ["Sheet", "Builder", "Sheet.Builder", "record", "Record", "group", "driver", "register", "link", "templates", "library", "inspector", "views", "slice", "copilot", "fill", "ready", "newGroup", "newRow", "joinery"],
    description: "The workshop's orders as a sheet builder — orders as groups and their operations as lines, an activity driver, machines and statuses registers, a date fill, an order check, order and operation templates for the library, the slice's search and filter, and views kept per viewer",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const orders     = $.let(Record.bind(sheetBuilderOrders, [sheetBuilderOrdersPatch]));
            const machines   = $.let(Record.bind(sheetBuilderMachines, []));
            const activities = $.let(Data.bind(sheetBuilderActivities));
            const views      = $.let(State.bind([ArrayType(Sheet.Types.View)], "sheet.builder.workshop.views", []));
            const statuses   = $.let([
                { word: "PLANNED",  tone: variant("neutral", null) },
                { word: "RELEASED", tone: variant("info", null) },
                { word: "ON HOLD",  tone: variant("warning", null) },
            ], ArrayType(BuilderStatus));
            // Every operation of every order: what the slice searches and filters.
            const operations = $.let(orders.read().toArray((_$, o) => o.ops).flatMap((_$, ops) => ops));
            const slice = $.let(Slice.bind([BuilderOperation], "sheet_builder_workshop",
                Slice.config(BuilderOperation, { fields: { activity: { label: "Activity" }, notes: { label: "Notes" } },
                                                 searchFieldIds: ["activity", "notes"] }),
                Slice.state(), operations, none));
            // End = start + the activity's days: a fill the copilot offers.
            const DateFill = OptionType(Sheet.Types.Fill(DateTimeType));
            const endFromStart = $.const(East.function([Sheet.Types.DraftContext(BuilderOrder, "ops", BuilderActivity)], DateFill, ($, ctx) => {
                const noFill = $.const(none, DateFill);
                return ctx.row.start.match({
                    value: (_$, supplied) => supplied.match({
                        none: () => noFill,
                        some: (_$, start) => ctx.driver.match({
                            none: () => noFill,
                            some: (_$, a) => some({ value: start.addDays(a.days), meta: East.str`+${a.days}d · ${a.name}` }),
                        }),
                    }),
                }, () => noFill);
            }));
            // The operations each kind of order starts with: the group templates' lines.
            const kitchen = $.let([
                { activity: "Panel cutting", start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Edge banding",  start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Assembly",      start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Spray finish",  start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
            ], ArrayType(BuilderOperation));
            const wardrobe = $.let([
                { activity: "Panel cutting", start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Edge banding",  start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Drilling",      start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Assembly",      start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
            ], ArrayType(BuilderOperation));
            const vanity = $.let([
                { activity: "Panel cutting", start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "CNC routing",   start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Spray finish",  start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Assembly",      start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
            ], ArrayType(BuilderOperation));
            // A new operation's and a new order's defaults, and the check every order passes before Apply.
            const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(BuilderOperation), () =>
                Sheet.patch(BuilderOperation, { start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "planner" })));
            const newGroup = $.const(East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(BuilderOrder), () =>
                Sheet.patch(BuilderOrder, { status: "PLANNED", due: none, ops: [] })));
            const readyOrder = $.const(East.function([Sheet.Types.DraftGroup(BuilderOrder, "ops")], Sheet.Types.Readiness, ($, order) => {
                $.if(order.customer.hasTag("value").and(() => order.customer.unwrap("value").length().equal(0n)), $ => {
                    $.return(East.value(variant("incomplete", [{ field: "customer", message: "Name the customer" }]), Sheet.Types.Readiness));
                });
                return East.value(variant("ready", null), Sheet.Types.Readiness);
            }));
            return (
                <Sheet.Builder
                    record={orders}
                    group={Sheet.group(BuilderOrder, "ops", {
                        title: "name", sub: o => o.customer, noun: { singular: "order", plural: "orders" },
                        cells: { activity: Sheet.group.cell.enum(BuilderOrder, "statuses", "status"),
                                 end:      Sheet.group.cell.date(BuilderOrder, "due") },
                    })}
                    driver={Sheet.driver("activity", activities.read(), { key: a => a.name, label: a => a.name, meta: a => some(a.uom) })}
                    registers={{
                        machines: Sheet.register.concat([
                            Sheet.register.members(machines.read(), { kind: "machine", key: (_m, code) => code, label: (_m, code) => code,
                                meta: m => some(m.family), parent: m => some(m.bay) }),
                            Sheet.register.members(machines.read(), { kind: "family", key: m => m.family, label: m => m.family,
                                meta: _m => some("family") }),
                        ]),
                        statuses: Sheet.register.members(statuses, { kind: "status", key: s => s.word, label: s => s.word, tone: s => some(s.tone) }),
                    }}
                    columns={{
                        activity: Sheet.column.lookup(BuilderOperation, { header: "Activity", width: "160px" }),
                        start:    Sheet.column.date(BuilderOperation, { header: "Start", width: "96px" }),
                        end:      Sheet.column.date(BuilderOperation, { header: "End", sub: "start + days", width: "96px",
                                      base: "start", fill: [endFromStart] }),
                        qty:      Sheet.column.quantity(BuilderOperation, BuilderActivity, { header: "Qty", sub: "unit per activity",
                                      width: "104px", uom: a => a.uom }),
                        machines: Sheet.column.link(BuilderOperation, BuilderActivity, "machines", {
                                      header: "Work centres", sub: "from → to · 2 x edge bander", width: "300px",
                                      members: [{ kind: "machine", identified: true }, { kind: "family", countable: true, resolvesTo: "machine" }] }),
                        notes:    Sheet.column.text(BuilderOperation, { header: "Notes", width: "240px" }),
                    }}
                    templates={{
                        groups: [
                            { key: "kitchen", name: "Kitchen order", group: "Orders",
                              values: Sheet.patch(BuilderOrder, { status: "PLANNED", due: none, ops: kitchen }) },
                            { key: "wardrobe", name: "Wardrobe order", group: "Orders",
                              values: Sheet.patch(BuilderOrder, { status: "PLANNED", due: none, ops: wardrobe }) },
                            { key: "vanity", name: "Vanity unit", group: "Orders",
                              values: Sheet.patch(BuilderOrder, { status: "PLANNED", due: none, ops: vanity }) },
                        ],
                        rows: [
                            { key: "cut", name: "Panel cutting", group: "Operations",
                              values: Sheet.patch(BuilderOperation, { activity: "Panel cutting",
                                  machines: { from: [], to: [variant("counted", { n: 1n, key: "beam saw" })] } }) },
                            { key: "edge", name: "Edge banding", group: "Operations",
                              values: Sheet.patch(BuilderOperation, { activity: "Edge banding",
                                  machines: { from: [], to: [variant("counted", { n: 1n, key: "edge bander" })] } }) },
                            { key: "route", name: "CNC routing", group: "Operations",
                              values: Sheet.patch(BuilderOperation, { activity: "CNC routing",
                                  machines: { from: [], to: [variant("counted", { n: 1n, key: "CNC router" })] } }) },
                            { key: "sand", name: "Sanding", group: "Operations",
                              values: Sheet.patch(BuilderOperation, { activity: "Sanding" }) },
                            { key: "spray", name: "Spray finish", group: "Operations",
                              values: Sheet.patch(BuilderOperation, { activity: "Spray finish",
                                  machines: { from: [], to: [variant("counted", { n: 1n, key: "spray booth" })] } }) },
                            { key: "assemble", name: "Assembly", group: "Operations",
                              values: Sheet.patch(BuilderOperation, { activity: "Assembly" }) },
                            { key: "wrap", name: "Wrapping", group: "Dispatch",
                              values: Sheet.patch(BuilderOperation, { activity: "Wrapping" }) },
                            { key: "deliver", name: "Delivery", group: "Dispatch",
                              values: Sheet.patch(BuilderOperation, { activity: "Delivery" }) },
                        ],
                    }}
                    newRow={newRow}
                    newGroup={newGroup}
                    ready={{ group: readyOrder }}
                    slice={slice} affordances={["search", "filter"]}
                    views={views}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetBuilderWeeks — one entry's rows (§3.4)
// ============================================================================

/** A plan row — what it is, when it starts and how many; `id` identifies it. */
export const BuilderPlanRow = StructType({ id: StringType, task: StringType, start: OptionType(DateTimeType), qty: OptionType(FloatType) });
/** One week's plan — when it starts, and its rows in the planner's order. */
export const BuilderWeek = StructType({ starts: DateTimeType, rows: ArrayType(BuilderPlanRow) });
/** The plans, one per week, keyed 2026-W42, 2026-W43, … */
export const sheetBuilderPlans = e3.record("sheet_builder_plans", DictType(StringType, BuilderWeek), new Map([
    ["2026-W42", { starts: new Date("2026-10-12T00:00:00Z"), rows: [
        { id: "w42-1", task: "Cut the kitchen carcasses", start: some(new Date("2026-10-12T00:00:00Z")), qty: some(48.0) },
        { id: "w42-2", task: "Band the carcass edges", start: some(new Date("2026-10-13T00:00:00Z")), qty: some(120.0) },
        { id: "w42-3", task: "Route the door panels", start: none, qty: some(24.0) },
    ] }],
    ["2026-W43", { starts: new Date("2026-10-19T00:00:00Z"), rows: [
        { id: "w43-1", task: "Assemble the wardrobes", start: some(new Date("2026-10-19T00:00:00Z")), qty: some(6.0) },
        { id: "w43-2", task: "Spray the vanity doors", start: none, qty: some(4.0) },
    ] }],
]));
/** The plans' patch door — every Apply commits through it. */
export const sheetBuilderPlansPatch = e3.mutation.patch(sheetBuilderPlans);

/**
 * One entry's rows (§3.4) — the week the viewer picks, its rows in the
 * planner's order; each week keeps its own drafts until Apply or Discard, and
 * a week the record does not hold opens empty and read-only.
 */
export const sheetBuilderWeeks = example({
    keywords: ["Sheet", "Builder", "Sheet.Builder", "record", "entry", "one entry", "rows", "id", "week", "State", "SegmentGroup", "drafts per entry"],
    description: "A sheet builder over one entry's rows — the week the viewer picks, its rows in the planner's order, each week its own drafts until Apply or Discard",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const plans = $.let(Record.bind(sheetBuilderPlans, [sheetBuilderPlansPatch]));
            // The week the viewer picked: a viewer's own state.
            const week = $.let(State.bind([StringType], "sheet.builder.weeks.week", "2026-W42"));
            const weeks = $.let(["2026-W42", "2026-W43", "2026-W44"], ArrayType(StringType));
            const pick = $.const(East.function([StringType], NullType, ($, w) => { $(week.write(w)); }));
            return (
                <VStack gap="3" align="stretch">
                    <SegmentGroup value={week.read()} onChange={pick} size="sm"
                        items={weeks.map((_$, w) => SegmentGroup.Item(w, <Text>{w}</Text>))} />
                    <Sheet.Builder
                        record={plans}
                        entry={{ key: week.read(), rows: "rows", id: "id" }}
                        columns={{
                            task:  Sheet.column.text(BuilderPlanRow, { header: "Task", width: "260px" }),
                            start: Sheet.column.date(BuilderPlanRow, { header: "Start", width: "96px" }),
                            qty:   Sheet.column.quantity(BuilderPlanRow, { header: "Qty", width: "96px" }),
                        }}
                    />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetBuilderPaged — a record read a window at a time (§3.4)
// ============================================================================

/**
 * A record read a window at a time (§3.4) — the jobs, paged in key order: the
 * key search seeks a job by its key, and the lens narrows the loaded rows.
 */
export const sheetBuilderPaged = example({
    keywords: ["Sheet", "Builder", "Sheet.Builder", "record", "window", "Data.bindPaged", "paged", "key order", "key search"],
    description: "A sheet builder over a large record, read a window at a time in key order — Data.bindPaged over the same record its Apply commits to",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const jobs = $.let(Record.bind(sheetBuilderJobs, [sheetBuilderJobsPatch]));
            const page = $.let(Data.bindPaged(sheetBuilderJobs));
            return (
                <Sheet.Builder
                    record={jobs}
                    window={page}
                    columns={{
                        task:  Sheet.column.text(BuilderJob, { header: "Task", width: "240px" }),
                        start: Sheet.column.date(BuilderJob, { header: "Start", width: "96px" }),
                        qty:   Sheet.column.quantity(BuilderJob, { header: "Qty", width: "96px" }),
                    }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
