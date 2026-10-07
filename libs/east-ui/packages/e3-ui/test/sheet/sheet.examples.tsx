/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import {
    East, ArrayType, BooleanType, DateTimeType, DictType, FloatType, FunctionType, IntegerType, NullType, OptionType, SetType, StringType, StructType, VariantType,
    example, none, some, variant,
} from "@elaraai/east";
import {
    Badge, Box, Configurator, Field, Format, HStack, Input, Reactive, SegmentGroup, Slice, State, StatusValueType, Style, Switch, Text, UIComponentType, VStack,
} from "@elaraai/east-ui";
import { Data, Record, Sheet } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// The Sheet's examples (#1216): the one `<Sheet>`, each in its frame — one
// toolbar holding every control the sheet has, the banners, the grid with its
// strip docked under it, the footer, and the panes it is given. The slots of
// EXAMPLES_AUTHORING.md §8, fewer and fuller (#1189):
//
// - `sheetBasic`, the smallest: a record's entries as the rows (§3.1);
// - `sheetVariants`, THE configurator: the sheet's options as axes, over the
//   host's rows (`data`), committed through `onApply`;
// - `sheetStress`, two thousand rows a task makes, read only, and the lens;
// - `sheetLibrary`, a library of the author's own (§4.4);
// - `sheetWorkshop`, the flagship — the joinery workshop's orders (§3.3):
//   groups, the driver and registers, the link grammar, the copilot,
//   readiness, the lens and views;
// - `sheetWeeks`, one entry's rows with every column kind and its rules (§3.4);
// - `sheetBatches`, one entry's groups in the planner's order, dragged and
//   moved (#1187), with their sub rows;
// - `sheetLoose`, loose rows between the groups (#846);
// - `sheetPaged`, a record read a window at a time;
// - `sheetUpkeep`, the inspector's every field kind (#1220).
//
// Its panes are optional props, and the examples show each combination:
// none (`sheetBasic`, `sheetVariants`, `sheetStress`, `sheetLoose`,
// `sheetPaged`), a library (`sheetLibrary`), an inspector (`sheetWeeks`, its
// Details the author's own; `sheetUpkeep`, its form), and both
// (`sheetWorkshop`, `sheetBatches`).
//
// Every sheet binds its rows from e3, so each runs on e3-web in the showcase
// (#1180): a record seeded with an authored literal (§2a), whose patch door
// every Apply commits through, or a task's output, made where data is made.
// `State` holds only what the viewer owns: a configurator's axes, saved views,
// the week picked. The names are made up; the domain is a joinery workshop
// (decision 14).
//
// A sheet fills its parent, as a ui task's page fills the window: each
// example gives it a box of its own height. One page shows them all, so every
// sheet but the first is named (`name`), and keeps its viewer's state apart.
// ============================================================================

// ============================================================================
// sheetBasic — the smallest sheet (§3.1)
// ============================================================================

/** A job — what it is, when it starts and how many. */
export const SheetJob = StructType({ task: StringType, start: OptionType(DateTimeType), qty: OptionType(FloatType) });
/** The jobs, keyed J-0001, J-0002, …: the record's entries are the sheet's rows. */
export const sheetJobs = e3.record("sheet_jobs", DictType(StringType, SheetJob), new Map([
    ["J-0001", { task: "Panel cutting", start: some(new Date("2026-10-12T00:00:00Z")), qty: some(48.0) }],
    ["J-0002", { task: "Edge banding", start: some(new Date("2026-10-13T00:00:00Z")), qty: some(120.0) }],
    ["J-0003", { task: "CNC routing", start: none, qty: some(48.0) }],
    ["J-0004", { task: "Spray finish", start: none, qty: none }],
]));
/** The jobs' patch door — every Apply commits through it. */
export const sheetJobsPatch = e3.mutation.patch(sheetJobs);

/**
 * The smallest sheet (§3.1) — the jobs an e3 record holds, in its frame: one
 * row per job in key order and a blank tail for the next, three typed
 * columns, every gesture a draft the history item undoes, and Apply one
 * commit through the record's patch door. It is given no pane.
 */
export const sheetBasic = example({
    keywords: ["Sheet", "basic", "BuilderFrame", "record", "Record", "Record.bind", "e3.record", "patch", "commit", "column", "date", "text", "quantity", "key order", "Reactive"],
    description: "The smallest sheet — an e3 record's entries as its rows, in key order, under three typed columns, edited as drafts and applied as one commit through the record's patch door, in its frame with no pane",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const jobs = $.let(Record.bind(sheetJobs, [sheetJobsPatch]));
            return (
                <Box height="560px">
                    <Sheet
                        record={jobs}
                        columns={{
                            task:  Sheet.column.text(SheetJob, { header: "Task", width: "240px" }),
                            start: Sheet.column.date(SheetJob, { header: "Start", width: "96px" }),
                            qty:   Sheet.column.quantity(SheetJob, { header: "Qty", width: "96px" }),
                        }}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetVariants — THE Sheet configurator
// ============================================================================

/** A job — its start, task, quantity and notes. */
export const VariantsJob = StructType({ id: StringType, start: OptionType(DateTimeType), task: StringType, qty: OptionType(FloatType), notes: StringType });
/** A plan — its jobs, in the planner's order. */
export const VariantsPlan = StructType({ jobs: ArrayType(VariantsJob) });
/** The plans — the configurator's sheet edits the week's jobs. */
export const sheetVariantsPlans = e3.record("sheet_variants_plans", DictType(StringType, VariantsPlan), new Map([
    ["week", { jobs: [
        { id: "j1", start: some(new Date("2026-02-16T00:00:00Z")), task: "Routing", qty: some(1200.0), notes: "Nest the C-18 panels" },
        { id: "j2", start: some(new Date("2026-03-09T00:00:00Z")), task: "Spraying", qty: some(250.0), notes: "" },
        { id: "j3", start: none, task: "Wrapping", qty: none, notes: "" },
    ] }],
]));
/** The record's patch door — every Apply commits through it. */
export const sheetVariantsPlansPatch = e3.mutation.patch(sheetVariantsPlans);

/**
 * THE Sheet configurator — ONE live sheet in its frame; every axis is an
 * expression-fed prop on that single instance: density, the blank tail, read
 * only and the copilot switch (a fill provider that reads the switch through
 * its captured bind handle). Selection (`onSelect`) and every gesture
 * (`onPatch`) log to the reactive aside. Its rows are the host's (`data`):
 * the week's jobs, read from an e3 record, and Apply hands the checked batch
 * to `onApply`, which commits it to that record. Its panes are fixed when it
 * is built, so they are no axis here: it is given none. The configurator's
 * axes are the viewer's own state.
 */
export const sheetVariants = example({
    keywords: ["Sheet", "configurator", "density", "blanks", "readOnly", "copilot", "fill", "provider", "onSelect", "onPatch", "onApply", "data", "Record", "Record.onApply", "e3.record", "bound", "Configurator", "SegmentGroup", "Switch", "Input", "Reactive", "State"],
    description: "Sheet configurator — density, the blank tail, read only and the copilot switch, all expression-fed into one live sheet in its frame over the host's rows (an e3 record's week, committed through onApply); selection and edits log to the aside",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const Ctx = Sheet.Types.DraftContext(VariantsJob);
            // The jobs, read from an e3 record bound with its patch door.
            const plans = $.let(Record.bind(sheetVariantsPlans, [sheetVariantsPlansPatch]));
            const rows = $.let(plans.read().get("week").jobs);
            const onApply = $.const(Record.onApply(plans, {
                entry: "week",
                get: East.function([VariantsPlan], ArrayType(VariantsJob), (_$, held) => held.jobs),
                set: East.function([VariantsPlan, ArrayType(VariantsJob)], VariantsPlan, (_$, _held, next) => ({ jobs: next })),
                idField: "id",
            }));
            const densities = $.const([
                variant("condensed", null), variant("compact", null), variant("comfortable", null),
            ], ArrayType(Style.Types.Density));

            const densityBind  = $.let(State.bind([StringType], "sheet_variants_density", "compact"));
            const blanksBind   = $.let(State.bind([IntegerType], "sheet_variants_blanks", 18n));
            const readOnlyBind = $.let(State.bind([BooleanType], "sheet_variants_readonly", false));
            const copilotBind  = $.let(State.bind([BooleanType], "sheet_variants_copilot", true));
            const lastEventBind = $.let(State.bind([StringType], "sheet_variants_last_event", ""));

            const dKey = $.let(densityBind.read());
            const blanks = $.let(blanksBind.read());
            const readOnly = $.let(readOnlyBind.read());
            const copilotOn = $.let(copilotBind.read());
            const lastEvent = $.let(lastEventBind.read());

            const onDensity  = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const onBlanks   = $.const(East.function([IntegerType], NullType, ($, next) => { $(blanksBind.write(next)); }));
            const onReadOnly = $.const(East.function([BooleanType], NullType, ($, next) => { $(readOnlyBind.write(next)); }));
            const onCopilot  = $.const(East.function([BooleanType], NullType, ($, next) => { $(copilotBind.write(next)); }));

            // The copilot axis — a fill that reads the switch through the
            // captured bind handle, so the one instance keeps its providers.
            const NoteFill = OptionType(Sheet.Types.Fill(StringType));
            const phrase = $.const(East.function([Ctx], NoteFill, ($, ctx) => {
                const noFill = $.const(none, NoteFill);
                return ctx.row.task.match({ value: (_$, task) => copilotBind.read().and(() => task.length().greater(0n)).ifElse(
                    () => some({ value: East.str`${task} as planned`, meta: "phrasing from the supplied task" }), () => noFill),
                }, () => noFill);
            }));

            const onSelect = $.const(East.function([Sheet.Types.Selection], NullType, ($, sel) => {
                $(lastEventBind.write(East.str`onSelect: row ${sel.rowId.match({ some: (_$, id) => id, none: (_$) => "—" })} · ${sel.key.match({ some: (_$, k) => k, none: (_$) => "—" })}`));
            }));
            const onPatch = $.const(East.function([Sheet.Types.PatchEvent(VariantsJob)], NullType, ($, e) => {
                $(lastEventBind.write(East.str`${e.origin.getTag()} · ${e.draftChanges.length()} entries · ${e.readiness.getTag()}`));
            }));

            const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(VariantsJob), () => Sheet.patch(VariantsJob, { notes: "" })));
            const densitySel = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Blank tail", East.print(blanks),
                            <Input.Integer value={blanks} min={0n} max={40n} step={2n} size="sm" onChange={onBlanks} />),
                        Configurator.Slot("Chrome",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={readOnly} label="Read-only" onChange={onReadOnly} />
                                <Switch checked={copilotOn} label="Copilot" onChange={onCopilot} />
                            </HStack>),
                    ]}
                    preview={
                        <Box width="100%" height="420px">
                            <Sheet
                                data={rows}
                                id="id"
                                name="variants"
                                columns={{
                                    start: Sheet.column.date(VariantsJob, { header: "Start", sub: "dd / mm / yyyy", width: "96px" }),
                                    task:  Sheet.column.text(VariantsJob, { header: "Task", width: "180px" }),
                                    qty:   Sheet.column.quantity(VariantsJob, { header: "Qty", sub: "1,200 · pcs", width: "112px", format: Format.Number({ maximumFractionDigits: 0n }) }),
                                    notes: Sheet.column.text(VariantsJob, { header: "Notes", sub: "free text", fill: [phrase] }),
                                }}
                                density={densitySel}
                                blanks={blanks}
                                readOnly={readOnly}
                                onSelect={onSelect}
                                onPatch={onPatch}
                                newRow={newRow}
                                onApply={onApply}
                            />
                        </Box>
                    }
                    aside={{
                        label: "Events · Reactive",
                        body: (
                            <Badge colorPalette="brand" variant="outline">
                                {East.equal(lastEvent.length(), 0n).ifElse((_$) => "Interact with the sheet", (_$) => lastEvent)}
                            </Badge>
                        ),
                    }}
                    spec={[
                        Configurator.Spec("Copilot", copilotOn.ifElse((_$) => "on · notes phrase", (_$) => "off")),
                        Configurator.Spec("Rows", East.str`${rows.length()} real`),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetStress — two thousand rows, and the lens over them
// ============================================================================

/** A job on the stress sheet — its start, activity, notes, work centres (a
 *  machine by code, or a count of a family), status and quantity. */
export const StressJob = StructType({
    id: StringType, start: OptionType(DateTimeType), activity: StringType, notes: StringType,
    stations: Sheet.Types.Link, status: StringType, qty: OptionType(FloatType),
});

/** How many jobs the stress sheet holds — a small authored constant;
 *  {@link sheetStressJobs} makes the rows. */
export const sheetStressJobCount = e3.input("sheet_stress_job_count", IntegerType, variant("value", 2000n));

/**
 * The jobs, generated from their count — four a day from 5 January, the
 * activities in turn: every fifth a routing run naming a count of routers,
 * the rest a machine by code; every seventh urgent, every eleventh quantity
 * blank.
 */
export const generateStressJobs = East.function([IntegerType], ArrayType(StressJob), ($, count) => {
    const activities = $.const(["Routing", "Spraying", "Wrapping", "Set-up", "Maintenance"], ArrayType(StringType));
    const words = $.const(["PLANNED", "RELEASED", "COMPLETE"], ArrayType(StringType));
    const codes = $.const(["R2140", "R2141", "R2145", "P3210", "A7301"], ArrayType(StringType));
    const first = $.const(new Date("2026-01-05T00:00:00Z"), DateTimeType);
    const noMembers = $.const([], ArrayType(Sheet.Types.Member));
    const blank = $.const(none, OptionType(FloatType));
    return East.Array.generate(count, StressJob, (_$, i) => ({
        id: East.str`S${i}`,
        start: some(first.addDays(i.divide(4n))),
        activity: activities.get(i.remainder(5n)),
        notes: i.remainder(7n).equal(0n).ifElse((_$2) => "urgent — inspect before delivery", (_$2) => East.str`batch ${i.add(100n)}`),
        // Routing runs name a count of routers; the rest a machine by code.
        stations: i.remainder(5n).equal(0n).ifElse(
            (_$2) => East.value({ from: noMembers, to: [variant("counted", { n: i.remainder(3n).add(2n), key: "CNC router" })] }, Sheet.Types.Link),
            (_$2) => East.value({ from: noMembers, to: [variant("identified", { key: codes.get(i.remainder(5n)) })] }, Sheet.Types.Link)),
        status: words.get(i.remainder(3n)),
        qty: i.remainder(11n).equal(0n).ifElse((_$2) => blank, (_$2) => East.value(some(i.multiply(7n).toFloat().add(50.0)), OptionType(FloatType))),
    }));
});

/** The task that generates the jobs — its output is what the stress sheet reads. */
export const sheetStressJobs = e3.task("sheet_stress_jobs", [sheetStressJobCount], generateStressJobs);

/**
 * Stress, and the lens (§3.8) — two thousand jobs an e3 task generates, the
 * host's rows (`data`), read only, every row virtualised. Search and filter
 * run through the bound slice; the sheet never narrows, it draws the rows the
 * narrowing leaves as collapsed context bands while hits keep their row
 * numbers. The work centres are a set column searched through its display
 * form (`text: r => Sheet.link.print(r.stations)`); saved views are
 * slice-state snapshots evaluated live, with their context and reveals, the
 * first one open, kept per viewer through a `State` bind handle. The rows
 * are a task's output, made where data is made, so the sheet only reads
 * them. It is given no pane.
 */
export const sheetStress = example({
    keywords: ["Sheet", "stress", "virtualization", "2000", "rows", "performance", "data", "readOnly", "slice", "search", "filter", "lens", "bands", "context", "reveal", "views", "State.bind", "activeView", "text", "Sheet.link.print", "set", "register", "concat", "footer", "Slice", "config", "bind", "state", "Data.bind", "bound", "e3.task", "generated", "Reactive", "State"],
    description: "Two thousand jobs an e3 task generates, read only and virtualised in the sheet's frame, with the lens over them — search and filter through the bound slice drawn as context bands (hits keep their row numbers), a set column searched through its display text, and saved views kept per viewer as slice-state snapshots with their context and reveals",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const MachineType = StructType({ code: StringType, family: StringType });
            // Two thousand jobs an e3 task generates — made where data is made.
            const jobs = $.let(Data.bind(sheetStressJobs));
            const count = $.let(jobs.read().length());
            const machines = $.const([
                { code: "R2140", family: "CNC router" }, { code: "R2141", family: "CNC router" }, { code: "R2145", family: "CNC router" },
                { code: "P3210", family: "4-side planer" }, { code: "A7301", family: "assembly bench" },
            ], ArrayType(MachineType));
            // The work centres are searched through their display form — `3 x CNC router`, `A7301` — not their `.east` text.
            const cfg = $.const(Slice.config(StressJob, {
                fields: {
                    activity: { label: "Activity", hints: ["Routing", "Spraying", "Wrapping", "Set-up", "Maintenance"] },
                    notes:    { label: "Notes" },
                    stations: { label: "Work centres", text: r => Sheet.link.print(r.stations) },
                    status:   { label: "Status" },
                },
                searchFieldIds: ["activity", "notes", "stations"],
            }));
            const slice = $.let(Slice.bind([StressJob], "sheet_stress_slice", cfg, Slice.state(), jobs.read(), none));
            const views = $.let(State.bind([ArrayType(Sheet.Types.View)], "sheet_stress_views", [
                { id: "spraying", name: "SPRAYING", narrowing: Slice.state({ search: some("spraying") }), context: 1n, reveals: [], folds: new Map() },
                { id: "routers", name: "ROUTERS", narrowing: Slice.state({ search: some("router") }), context: 0n, reveals: [], folds: new Map() },
                { id: "urgent", name: "URGENT", narrowing: Slice.state({ search: some("urgent") }), context: 0n, reveals: [], folds: new Map() },
            ]));
            return (
                <Box height="480px">
                    <Sheet
                        data={jobs}
                        id="id"
                        name="stress"
                        registers={{
                            stations: Sheet.register.concat([
                                Sheet.register.members(machines, { kind: "machine", key: m => m.code, label: m => m.code, meta: m => some(m.family) }),
                                Sheet.register.members(machines, { kind: "family", key: m => m.family, label: m => m.family, meta: _m => some("family") }),
                            ]),
                        }}
                        columns={{
                            start:    Sheet.column.date(StressJob, { header: "Start", width: "96px" }),
                            activity: Sheet.column.text(StressJob, { header: "Activity", width: "160px" }),
                            notes:    Sheet.column.text(StressJob, { header: "Notes", sub: "free text", width: "240px" }),
                            stations: Sheet.column.set(StressJob, "stations", { header: "Work centres", sub: "3 x router · machine", width: "220px",
                                          members: [{ kind: "machine", identified: true }, { kind: "family", countable: true, resolvesTo: "machine" }] }),
                            status:   Sheet.column.text(StressJob, { header: "Status", width: "120px" }),
                            qty:      Sheet.column.quantity(StressJob, { header: "Qty", width: "112px", format: Format.Number({ maximumFractionDigits: 0n }) }),
                        }}
                        slice={slice} affordances={["search", "filter"]}
                        views={views} activeView={some("spraying")}
                        readOnly
                        footer={[{ text: East.str`${count} rows · virtualised` }]}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetLibrary — a library of the author's own (§4.4)
// ============================================================================

/** A task a job takes, and the stage of the work it belongs to. */
export const LibraryTask = StructType({ name: StringType, stage: StringType });

/**
 * The jobs with a library of the author's own (§4.4, SB60): the library pane
 * lists the tasks a job takes, grouped by their stage — a card dropped on a
 * job sets its task — beside the columns a viewer shows and hides. It is
 * given no inspector, so it has no inspector pane.
 */
export const sheetLibrary = example({
    keywords: ["Sheet", "BuilderFrame", "pane", "library", "Sheet.library", "Sheet.library.tab", "Sheet.library.columns", "tab", "cards", "drop", "Sheet.patch", "group"],
    description: "A sheet whose library pane lists a tab of the author's own — the tasks a job takes, grouped by stage, a card dropped on a job setting its task — beside the columns",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const jobs = $.let(Record.bind(sheetJobs, [sheetJobsPatch]));
            const tasks = $.let([
                { name: "Panel cutting", stage: "Cutting" },
                { name: "Edge banding",  stage: "Cutting" },
                { name: "CNC routing",   stage: "Machining" },
                { name: "Sanding",       stage: "Finishing" },
                { name: "Spray finish",  stage: "Finishing" },
            ], ArrayType(LibraryTask));
            return (
                <Box height="560px">
                    <Sheet
                        record={jobs}
                        name="library"
                        columns={{
                            task:  Sheet.column.text(SheetJob, { header: "Task", width: "240px" }),
                            start: Sheet.column.date(SheetJob, { header: "Start", width: "96px" }),
                            qty:   Sheet.column.quantity(SheetJob, { header: "Qty", width: "96px" }),
                        }}
                        library={[
                            // The tasks a job takes, by their stage: a card dropped on a job sets its task.
                            Sheet.library.tab(tasks, { name: "Tasks", icon: "hammer",
                                key: t => t.name, label: t => t.name, group: t => t.stage,
                                drop: t => Sheet.patch(SheetJob, { task: t.name }) }),
                            Sheet.library.columns(),
                        ]}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetWorkshop — the joinery workshop's orders (§3.3)
// ============================================================================

/** An activity — the driver's row: its unit, how many days it takes, how many
 *  units an hour, the family of machine it runs on (`""` for none) and the
 *  halves of the work centres it makes live. */
export const WorkshopActivity = StructType({
    name: StringType, uom: StringType, days: IntegerType, rate: FloatType, family: StringType, sides: Sheet.Types.Sides,
});
/** A machine — its family and the bay it stands in; its code is its key. */
export const WorkshopMachine = StructType({ family: StringType, bay: StringType });
/** A status — a word of the statuses register, and its tone. */
export const WorkshopStatus = StructType({ word: StringType, tone: StatusValueType });
/** One operation of an order. */
export const WorkshopOperation = StructType({
    activity:   StringType,                    // the driver: an activity's name
    start:      OptionType(DateTimeType),
    end:        OptionType(DateTimeType),
    qty:        OptionType(FloatType),         // in the activity's unit
    machines:   Sheet.Types.Link,              // work centres, from → to
    notes:      StringType,
    created_by: StringType,                    // no column: the inspector shows it
});
/** An order — its name, customer, due date and status, and its operations in order. */
export const WorkshopOrder = StructType({
    name:     StringType,
    customer: StringType,
    due:      OptionType(DateTimeType),
    status:   StringType,                      // a word of the statuses register
    ops:      ArrayType(WorkshopOperation),
});

/** The activities — the driver's members, each with its unit and days. */
export const sheetWorkshopActivities = e3.input("sheet_workshop_activities", ArrayType(WorkshopActivity), variant("value", [
    { name: "Panel cutting", uom: "panels", days: 1n, rate: 12.0, family: "beam saw", sides: variant("both", null) },
    { name: "Edge banding", uom: "metres", days: 1n, rate: 60.0, family: "edge bander", sides: variant("both", null) },
    { name: "CNC routing", uom: "panels", days: 2n, rate: 6.0, family: "CNC router", sides: variant("both", null) },
    { name: "Drilling", uom: "panels", days: 1n, rate: 10.0, family: "CNC router", sides: variant("both", null) },
    { name: "Sanding", uom: "panels", days: 1n, rate: 20.0, family: "", sides: variant("in", null) },
    { name: "Assembly", uom: "units", days: 2n, rate: 2.0, family: "assembly bench", sides: variant("both", null) },
    { name: "Spray finish", uom: "doors", days: 3n, rate: 8.0, family: "spray booth", sides: variant("both", null) },
    { name: "Wrapping", uom: "units", days: 1n, rate: 10.0, family: "", sides: variant("in", null) },
    { name: "Delivery", uom: "loads", days: 1n, rate: 1.0, family: "", sides: variant("from", null) },
]));
/** The machines, keyed by code — the work centres' register. */
export const sheetWorkshopMachines = e3.record("sheet_workshop_machines", DictType(StringType, WorkshopMachine), new Map([
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
export const sheetWorkshopOrders = e3.record("sheet_workshop_orders", DictType(StringType, WorkshopOrder), new Map([
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
export const sheetWorkshopOrdersPatch = e3.mutation.patch(sheetWorkshopOrders);

/** The model behind the workshop's async proposer — an e3 function, a service, a notebook; the sheet needs only its types. */
const workshopRecommend = East.asyncPlatform(
    "sheet_workshop_recommend",
    [Sheet.Types.DraftContext(WorkshopOrder, "ops", WorkshopActivity)],
    ArrayType(Sheet.Types.Proposal(WorkshopOperation)),
    { optional: true },
);

/**
 * The flagship (§3.3) — the joinery workshop's orders, a grouped sheet over a
 * record: each order a group, its operations its lines, the order's status and
 * due date in its band. An activity driver gives each quantity its unit, the
 * End fill its duration and the work centres their live halves. The work
 * centres are a link cell over one register joined from three sources: the
 * machines record (a Dict, its key the accessors' second argument), the bays
 * (an Array with aliases) and the machine families, read off the machines
 * (duplicate keys fold). Its grammar takes counts (`2 x edge bander`), locks a
 * half the activity does not use, implies how many machines a quantity needs,
 * and checks each machine named. The copilot fills dates, quantities, notes
 * and work centres, and proposes the lines that follow — a pattern, one
 * learned from the order, and an async model. A check on each order, templates
 * for whole orders and single operations, the slice's search and filter with
 * the work centres searched by their display text, views kept per viewer and
 * a footer. Both panes: the library lists the templates, the statuses — a
 * card dropped on an order's band sets its status — and the columns; the
 * inspector shows every field of the selected operation, `created_by` (no
 * column) read only, and the order with no customer is the batch's issue.
 */
export const sheetWorkshop = example({
    keywords: ["Sheet", "BuilderFrame", "record", "Record", "group", "driver", "register", "members", "concat", "aliases", "meta", "parent", "Dict", "fold", "duplicate", "link", "multiple", "sides", "locks", "arity", "check", "exists", "uom", "Format", "templates", "library", "Sheet.library", "Sheet.library.tab", "drop", "inspector", "fields", "Sheet.field", "readonly", "views", "slice", "search", "filter", "text", "Sheet.link.print", "copilot", "fill", "provider", "derive", "history", "sequence", "default", "phrase", "capacity", "propose", "proposer", "suggest", "learned", "follower", "asyncFunction", "asyncPlatform", "ready", "newGroup", "newRow", "footer", "joinery"],
    description: "The flagship sheet — the workshop's orders as groups and their operations as lines; an activity driver giving units, durations and live halves; one work-centre register joined from a machines record (Dict), the bays (aliases) and the families (folded), its link grammar counting, locking, implying and checking machines; the copilot's fills (derive, history, sequence, default, phrase, capacity) and proposers (a pattern, a learned follower, an async model); an order check; order and operation templates; a library of the templates, the statuses (dropped on an order to set its status) and the columns; an inspector pane showing every field; the slice's search and filter over the link's display text; views kept per viewer; and a footer",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const orders     = $.let(Record.bind(sheetWorkshopOrders, [sheetWorkshopOrdersPatch]));
            const machines   = $.let(Record.bind(sheetWorkshopMachines, []));
            const activities = $.let(Data.bind(sheetWorkshopActivities));
            const views      = $.let(State.bind([ArrayType(Sheet.Types.View)], "sheet.workshop.views", []));
            const statuses   = $.let([
                { word: "PLANNED",  tone: variant("neutral", null) },
                { word: "RELEASED", tone: variant("info", null) },
                { word: "ON HOLD",  tone: variant("warning", null) },
            ], ArrayType(WorkshopStatus));
            const BayType = StructType({ name: StringType, aliases: ArrayType(StringType) });
            const bays = $.let([
                { name: "Bay 1", aliases: ["b1", "saw bay"] },
                { name: "Bay 2", aliases: ["b2", "banding bay"] },
                { name: "Bay 3", aliases: ["b3", "router bay"] },
                { name: "Bay 4", aliases: ["b4", "spray bay"] },
                { name: "Bay 7", aliases: ["b7", "assembly bay"] },
            ], ArrayType(BayType));
            // Every operation of every order: what the slice searches and filters — the work centres by their display text.
            const operations = $.let(orders.read().toArray((_$, o) => o.ops).flatMap((_$, ops) => ops));
            const slice = $.let(Slice.bind([WorkshopOperation], "sheet_workshop",
                Slice.config(WorkshopOperation, {
                    fields: {
                        activity: { label: "Activity", hints: ["Panel cutting", "Edge banding", "CNC routing", "Drilling", "Sanding", "Assembly", "Spray finish", "Wrapping", "Delivery"] },
                        notes:    { label: "Notes" },
                        machines: { label: "Work centres", text: o => Sheet.link.print(o.machines) },
                    },
                    searchFieldIds: ["activity", "notes", "machines"],
                }),
                Slice.state(), operations, none));
            const Ctx = Sheet.Types.DraftContext(WorkshopOrder, "ops", WorkshopActivity);
            const DateFill = OptionType(Sheet.Types.Fill(DateTimeType));
            const FloatFill = OptionType(Sheet.Types.Fill(FloatType));
            const TextFill = OptionType(Sheet.Types.Fill(StringType));
            const LinkFill = OptionType(Sheet.Types.Fill(Sheet.Types.Link));
            const Counted = OptionType(Sheet.Types.Counted);
            const Proposals = ArrayType(Sheet.Types.Proposal(WorkshopOperation));
            // derive — End = start + the activity's days.
            const endFromStart = $.const(East.function([Ctx], DateFill, ($, ctx) => {
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
            // sequence — the day after the last dated line above; else next Monday.
            const nextSlot = $.const(East.function([Ctx], DateFill, ($, ctx) => {
                const dated = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) => r.start.hasTag("value").and(() => r.start.unwrap("value").hasTag("some"))));
                return dated.length().greater(0n).ifElse(
                    ($2) => {
                        const last = $2.let(dated.get(dated.length().subtract(1n)));
                        return East.value(some({ value: last.start.unwrap("value").unwrap("some").addDays(1n), meta: "the day after the line above" }), DateFill);
                    },
                    ($2) => {
                        const daysToMonday = $2.let(East.value(8n, IntegerType).subtract(ctx.today.getDayOfWeek()).remainder(7n));
                        const monday = $2.let(ctx.today.addDays(daysToMonday.equal(0n).ifElse((_$) => 7n, (_$) => daysToMonday)));
                        return East.value(some({ value: monday, meta: "next Monday" }), DateFill);
                    });
            }));
            // history — the quantity of the last like operation in the order.
            const lastQuantity = $.const(East.function([Ctx], FloatFill, ($, ctx) => {
                const noFill = $.const(none, FloatFill);
                return ctx.row.activity.match({
                    value: ($, activity) => {
                        const similar = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) =>
                            r.activity.hasTag("value").and(() => r.activity.unwrap("value").equal(activity))
                                .and(() => r.qty.hasTag("value")).and(() => r.qty.unwrap("value").hasTag("some"))));
                        return similar.size().equal(0n).ifElse(() => noFill, ($) => {
                            const row = $.let(similar.get(similar.size().subtract(1n)));
                            return some({ value: row.qty.unwrap("value").unwrap("some"), meta: "the last like operation's quantity" });
                        });
                    },
                }, () => noFill);
            }));
            // default — a shift's worth at the activity's rate.
            const shiftQuantity = $.const(East.function([Ctx], FloatFill, ($, ctx) => {
                const noFill = $.const(none, FloatFill);
                return ctx.driver.match({
                    none: (_$) => noFill,
                    some: (_$, a) => East.value(some({ value: a.rate.multiply(8.0), meta: East.str`${a.rate}/h × 8 h` }), FloatFill),
                });
            }));
            // phrase — the notes, from the supplied quantity and the activity's unit.
            const phrase = $.const(East.function([Ctx], TextFill, ($, ctx) => {
                const noFill = $.const(none, TextFill);
                return ctx.row.qty.hasTag("value").and(() => ctx.row.qty.unwrap("value").hasTag("some")).ifElse(($) => {
                    const qty = $.const(ctx.row.qty.unwrap("value").unwrap("some"));
                    return ctx.driver.match({
                        none: (_$) => noFill,
                        some: (_$, a) => East.value(some({ value: East.str`${qty} ${a.uom} · ${a.name}`, meta: "phrasing from the supplied activity and quantity" }), TextFill),
                    });
                }, () => noFill);
            }));
            // The arity rule — one machine of the activity's family for every sixty units.
            const impliedMachines = $.const(East.function([Ctx], Counted, ($, ctx) => {
                const noCount = $.const(none, Counted);
                $.if(ctx.row.qty.hasTag("value").not(), ($) => { $.return(noCount); });
                const supplied = $.const(ctx.row.qty.unwrap("value"));
                $.if(supplied.hasTag("some").not(), ($) => { $.return(noCount); });
                const qty = $.const(supplied.unwrap("some"));
                // ⌈qty ÷ 60⌉ by hand — `toInteger` refuses a fraction.
                const share = $.let(qty.divide(60.0));
                const frac = $.let(share.remainder(1.0));
                const needed = $.let(frac.equal(0.0).ifElse((_$) => share, (_$) => share.subtract(frac).add(1.0)).toInteger());
                return ctx.driver.match({
                    none: (_$) => noCount,
                    some: (_$, a) => a.family.equal("").or(() => qty.greater(0.0).not()).ifElse(
                        (_$2) => noCount,
                        (_$2) => East.value(some({ n: needed, key: a.family }), Counted)),
                });
            }));
            // capacity — the machines the quantity implies, counted.
            const capacity = $.const(East.function([Ctx], LinkFill, ($, ctx) => {
                const noFill = $.const(none, LinkFill);
                const noMembers = $.const([], ArrayType(Sheet.Types.Member));
                const implied = $.const(impliedMachines);
                return implied(ctx).match({
                    none: (_$) => noFill,
                    some: (_$, c) => East.value(some({ value: { from: [variant("counted", { n: c.n, key: c.key })], to: noMembers }, meta: "capacity · from the quantity" }), LinkFill),
                });
            }));
            // history — the work centres of the last like operation in the order.
            const lastMachines = $.const(East.function([Ctx], LinkFill, ($, ctx) => {
                const noFill = $.const(none, LinkFill);
                return ctx.row.activity.match({
                    value: ($, activity) => {
                        const similar = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) =>
                            r.activity.hasTag("value").and(() => r.activity.unwrap("value").equal(activity)).and(() => r.machines.hasTag("value"))));
                        return similar.size().equal(0n).ifElse(() => noFill, ($) => {
                            const link = $.let(similar.get(similar.size().subtract(1n)).machines.unwrap("value"));
                            return link.from.size().add(link.to.size()).equal(0n).ifElse(
                                () => noFill, () => some({ value: link, meta: "the work centres of the last like operation" }));
                        });
                    },
                }, () => noFill);
            }));
            // A member check — a machine on the From half runs the operation, so it is of the activity's family.
            const familyOf = $.let(activities.read().toDict((_$, a) => a.name, (_$, a) => a.family));
            const machineDict = $.let(machines.read());
            const familyFits = $.const(East.function([Sheet.Types.CheckContext(WorkshopOrder, "ops")], OptionType(StringType), ($, c) => {
                const noFlag = $.const(none, OptionType(StringType));
                return c.half.match({
                    to: (_$) => noFlag,
                    from: (_$) => c.member.match({
                        identified: (_$2, m) => c.row.activity.match({
                            value: (_$3, activity) => familyOf.has(activity)
                                .and(() => familyOf.get(activity).equal("").not())
                                .and(() => machineDict.has(m.key))
                                .and(() => machineDict.get(m.key).family.equal(familyOf.get(activity)).not())
                                .ifElse(
                                    (_$4) => East.value(some(East.str`${m.key} is a ${machineDict.get(m.key).family}, not a ${familyOf.get(activity)}`), OptionType(StringType)),
                                    (_$4) => noFlag),
                        }, (_$3) => noFlag),
                    }, (_$2) => noFlag),
                });
            }));
            // A pattern — panels cut are banded, then routed.
            const followUps = $.const(East.function([Ctx], Proposals, ($, ctx) => {
                const empty = $.const([], Proposals);
                return ctx.row.activity.hasTag("value")
                    .and(() => ctx.row.activity.unwrap("value").equal("Panel cutting"))
                    .and(() => ctx.row.end.hasTag("value"))
                    .and(() => ctx.row.end.unwrap("value").hasTag("some")).ifElse(($) => {
                        const end = $.const(ctx.row.end.unwrap("value").unwrap("some"));
                        return $.const([
                            { patch: Sheet.patch(WorkshopOperation, { activity: "Edge banding", start: some(end), end: some(end.addDays(1n)), notes: "Band the cut panels" }), meta: "edge banding after the cut" },
                            { patch: Sheet.patch(WorkshopOperation, { activity: "CNC routing", start: some(end.addDays(1n)), end: some(end.addDays(3n)), notes: "Route the banded panels" }), meta: "routing · end +1…+3 d" },
                        ], Proposals);
                    }, () => empty);
            }));
            // Learned from the order — what followed this activity in it, after how long.
            const lastFollower = $.const(East.function([Ctx], Proposals, ($, ctx) => {
                const empty = $.const([], Proposals);
                return ctx.row.activity.hasTag("value")
                    .and(() => ctx.row.start.hasTag("value"))
                    .and(() => ctx.row.start.unwrap("value").hasTag("some")).ifElse(($) => {
                        const activity = $.const(ctx.row.activity.unwrap("value"));
                        const start = $.const(ctx.row.start.unwrap("value").unwrap("some"));
                        const dated = $.const(ctx.rows.filter((_$, r) => r.start.hasTag("value")
                            .and(() => r.start.unwrap("value").hasTag("some"))
                            .and(() => r.activity.hasTag("value"))));
                        const upper = $.const(dated.size().greater(1n).ifElse(() => dated.size().subtract(1n), () => 0n));
                        const pairs = $.const(East.Array.range(0n, upper).filter((_$, i) =>
                            dated.get(i).activity.unwrap("value").equal(activity)
                                .and(() => dated.get(i.add(1n)).activity.unwrap("value").equal(activity).not())));
                        return pairs.size().equal(0n).ifElse(() => empty, ($) => {
                            const index = $.const(pairs.get(pairs.size().subtract(1n)));
                            const from = $.const(dated.get(index));
                            const next = $.const(dated.get(index.add(1n)));
                            const gap = $.const(next.start.unwrap("value").unwrap("some").toEpochMilliseconds()
                                .subtract(from.start.unwrap("value").unwrap("some").toEpochMilliseconds()));
                            return $.const([{ patch: Sheet.patch(WorkshopOperation, { activity: next.activity.unwrap("value"), start: some(start.addMilliseconds(gap)) }),
                                meta: "follower learned from the order" }], Proposals);
                        });
                    }, () => empty);
            }));
            // A model — an ASYNC proposer; the strip shows a pending chip, and a newer context cancels the wait.
            const modelProposals = $.const(East.asyncFunction([Ctx], Proposals, ($, ctx) => {
                const result = $.let([], Proposals);
                $.try(($) => { $.assign(result, workshopRecommend(ctx)); }).catch(($, message) => {
                    // The showcase has no model behind it; any other failure still reaches the sheet's provider diagnostic.
                    $.if(message.notEqual("Platform function 'sheet_workshop_recommend' is not available"), ($) => { $.error(message); });
                });
                return result;
            }));
            // The operations each kind of order starts with: the group templates' lines.
            const kitchen = $.let([
                { activity: "Panel cutting", start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Edge banding",  start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Assembly",      start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Spray finish",  start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
            ], ArrayType(WorkshopOperation));
            const wardrobe = $.let([
                { activity: "Panel cutting", start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Edge banding",  start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Drilling",      start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Assembly",      start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
            ], ArrayType(WorkshopOperation));
            const vanity = $.let([
                { activity: "Panel cutting", start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "CNC routing",   start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Spray finish",  start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
                { activity: "Assembly",      start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
            ], ArrayType(WorkshopOperation));
            // A new operation's and a new order's defaults, and the check every order passes before Apply.
            const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(WorkshopOperation), () =>
                Sheet.patch(WorkshopOperation, { start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "planner" })));
            const newGroup = $.const(East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(WorkshopOrder), () =>
                Sheet.patch(WorkshopOrder, { status: "PLANNED", due: none, ops: [] })));
            const readyOrder = $.const(East.function([Sheet.Types.DraftGroup(WorkshopOrder, "ops")], Sheet.Types.Readiness, ($, order) => {
                $.if(order.customer.hasTag("value").and(() => order.customer.unwrap("value").length().equal(0n)), $ => {
                    $.return(East.value(variant("incomplete", [{ field: "customer", message: "Name the customer" }]), Sheet.Types.Readiness));
                });
                return East.value(variant("ready", null), Sheet.Types.Readiness);
            }));
            return (
                <Box height="760px">
                    <Sheet
                        record={orders}
                        group={Sheet.group(WorkshopOrder, "ops", {
                            title: "name", sub: o => o.customer, noun: { singular: "order", plural: "orders" },
                            cells: { activity: Sheet.group.cell.enum(WorkshopOrder, "statuses", "status"),
                                     end:      Sheet.group.cell.date(WorkshopOrder, "due") },
                        })}
                        driver={Sheet.driver("activity", activities.read(), { key: a => a.name, label: a => a.name, meta: a => some(a.uom) })}
                        registers={{
                            machines: Sheet.register.concat([
                                // A Dict's key rides as the accessors' second argument.
                                Sheet.register.members(machines.read(), { kind: "machine", key: (_m, code) => code, label: (_m, code) => code,
                                    meta: m => some(m.family), parent: m => some(m.bay) }),
                                Sheet.register.members(bays, { kind: "bay", key: b => b.name, label: b => b.name, aliases: b => b.aliases,
                                    meta: _b => some("bay") }),
                                // Every machine names a family — duplicate keys fold, the first wins.
                                Sheet.register.members(machines.read(), { kind: "family", key: m => m.family, label: m => m.family,
                                    meta: _m => some("family") }),
                            ]),
                            statuses: Sheet.register.members(statuses, { kind: "status", key: s => s.word, label: s => s.word, tone: s => some(s.tone) }),
                        }}
                        columns={{
                            activity: Sheet.column.lookup(WorkshopOperation, { header: "Activity", width: "160px" }),
                            start:    Sheet.column.date(WorkshopOperation, { header: "Start", width: "96px", fill: [nextSlot] }),
                            end:      Sheet.column.date(WorkshopOperation, { header: "End", sub: "start + days", width: "96px",
                                          base: "start", fill: [endFromStart] }),
                            qty:      Sheet.column.quantity(WorkshopOperation, WorkshopActivity, { header: "Qty", sub: "unit per activity",
                                          width: "104px", uom: a => a.uom, format: Format.Number({ maximumFractionDigits: 0n }), fill: [lastQuantity, shiftQuantity] }),
                            machines: Sheet.column.link(WorkshopOperation, WorkshopActivity, "machines", {
                                          header: "Work centres", sub: "from → to · 2 x edge bander", width: "300px",
                                          members: [{ kind: "machine", identified: true },
                                                    { kind: "bay", countable: true, resolvesTo: "machine" },
                                                    { kind: "family", countable: true, resolvesTo: "machine" }],
                                          multiple: { forms: ["N x kind", "kind x N"], ops: ["x", "X", "*", "×"], appliesTo: "countable" },
                                          sides: { value: a => a.sides, locks: { from: { to: "external", in: "in place" }, to: { from: "external" } } },
                                          arity: Sheet.link.arity("from", impliedMachines),
                                          check: [Sheet.link.check.exists(), familyFits],
                                          fill: [lastMachines, capacity] }),
                            notes:    Sheet.column.text(WorkshopOperation, { header: "Notes", width: "240px", fill: [phrase] }),
                        }}
                        suggest={{ ahead: 2n, triggers: ["activity", "start", "end", "qty", "notes", "machines"],
                                   propose: [followUps, modelProposals, lastFollower] }}
                        // The inspector pane: every field of an operation; created_by, which no column shows, read only.
                        inspector
                        fields={{ created_by: Sheet.field.readonly() }}
                        templates={{
                            groups: [
                                { key: "kitchen", name: "Kitchen order", group: "Orders",
                                  values: Sheet.patch(WorkshopOrder, { status: "PLANNED", due: none, ops: kitchen }) },
                                { key: "wardrobe", name: "Wardrobe order", group: "Orders",
                                  values: Sheet.patch(WorkshopOrder, { status: "PLANNED", due: none, ops: wardrobe }) },
                                { key: "vanity", name: "Vanity unit", group: "Orders",
                                  values: Sheet.patch(WorkshopOrder, { status: "PLANNED", due: none, ops: vanity }) },
                            ],
                            rows: [
                                { key: "cut", name: "Panel cutting", group: "Operations",
                                  values: Sheet.patch(WorkshopOperation, { activity: "Panel cutting",
                                      machines: { from: [], to: [variant("counted", { n: 1n, key: "beam saw" })] } }) },
                                { key: "edge", name: "Edge banding", group: "Operations",
                                  values: Sheet.patch(WorkshopOperation, { activity: "Edge banding",
                                      machines: { from: [], to: [variant("counted", { n: 1n, key: "edge bander" })] } }) },
                                { key: "route", name: "CNC routing", group: "Operations",
                                  values: Sheet.patch(WorkshopOperation, { activity: "CNC routing",
                                      machines: { from: [], to: [variant("counted", { n: 1n, key: "CNC router" })] } }) },
                                { key: "sand", name: "Sanding", group: "Operations",
                                  values: Sheet.patch(WorkshopOperation, { activity: "Sanding" }) },
                                { key: "spray", name: "Spray finish", group: "Operations",
                                  values: Sheet.patch(WorkshopOperation, { activity: "Spray finish",
                                      machines: { from: [], to: [variant("counted", { n: 1n, key: "spray booth" })] } }) },
                                { key: "assemble", name: "Assembly", group: "Operations",
                                  values: Sheet.patch(WorkshopOperation, { activity: "Assembly" }) },
                                { key: "wrap", name: "Wrapping", group: "Dispatch",
                                  values: Sheet.patch(WorkshopOperation, { activity: "Wrapping" }) },
                                { key: "deliver", name: "Delivery", group: "Dispatch",
                                  values: Sheet.patch(WorkshopOperation, { activity: "Delivery" }) },
                            ],
                        }}
                        library={[
                            Sheet.library.rows(),
                            // The statuses an order takes: a card dropped on an order's band sets its status.
                            Sheet.library.tab(statuses, { name: "Statuses", icon: "flag",
                                key: s => s.word, label: s => s.word, drop: s => Sheet.patch(WorkshopOrder, { status: s.word }) }),
                            Sheet.library.columns(),
                        ]}
                        newRow={newRow}
                        newGroup={newGroup}
                        ready={{ group: readyOrder }}
                        slice={slice} affordances={["search", "filter"]}
                        views={views}
                        footer={[{ text: East.str`${operations.size()} operations` }]}
                        name="workshop"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetWeeks — one entry's rows (§3.4)
// ============================================================================

/** A plan row — what it is, when it starts (read at its own level) and when it
 *  really started, how many, its set-ups, the site it runs at, its status, the
 *  order code the ERP stamps on release, and the machines it runs on (a set
 *  of codes); `id` identifies it. */
export const WeekRow = StructType({
    id: StringType, task: StringType, start: OptionType(DateTimeType), qty: OptionType(FloatType),
    setups: OptionType(IntegerType), site: StringType, status: StringType, code: StringType,
    level: Sheet.Types.DateLevel, started: OptionType(DateTimeType), machines: Sheet.Types.Link,
});
/** One week's plan — when it starts, and its rows in the planner's order. */
export const WeekPlan = StructType({ starts: DateTimeType, rows: ArrayType(WeekRow) });
/** The plans, one per week, keyed 2026-W42, 2026-W43, … */
export const sheetWeekPlans = e3.record("sheet_week_plans", DictType(StringType, WeekPlan), new Map([
    ["2026-W42", { starts: new Date("2026-10-12T00:00:00Z"), rows: [
        { id: "w42-1", task: "Cut the kitchen carcasses", start: some(new Date("2026-10-12T00:00:00Z")), qty: some(48.0), setups: some(2n), site: "Machine shop",
          status: "PLANNED", code: "", level: variant("day", null), started: none,
          machines: { from: [], to: [variant("range", { from: "S101", to: "S103" })] } },
        { id: "w42-2", task: "Band the carcass edges", start: some(new Date("2026-10-13T00:00:00Z")), qty: some(120.0), setups: some(1n), site: "Machine shop",
          status: "RELEASED", code: "WO-2201", level: variant("day", null), started: some(new Date("2026-10-13T07:30:00Z")),
          machines: { from: [], to: [variant("identified", { key: "E201" })] } },
        { id: "w42-3", task: "Route the door panels", start: none, qty: some(24.0), setups: none, site: "Bench room",
          status: "PLANNED", code: "", level: variant("week", null), started: none,
          machines: { from: [], to: [] } },
    ] }],
    ["2026-W43", { starts: new Date("2026-10-19T00:00:00Z"), rows: [
        { id: "w43-1", task: "Assemble the wardrobes", start: some(new Date("2026-10-19T00:00:00Z")), qty: some(6.0), setups: none, site: "Fitting shop",
          status: "PLANNED", code: "", level: variant("day", null), started: none,
          machines: { from: [], to: [variant("identified", { key: "A701" })] } },
        { id: "w43-2", task: "Spray the vanity doors", start: none, qty: some(4.0), setups: none, site: "Spray shop",
          status: "PLANNED", code: "", level: variant("time", null), started: none,
          machines: { from: [], to: [] } },
    ] }],
]));
/** The plans' patch door — every Apply commits through it. */
export const sheetWeekPlansPatch = e3.mutation.patch(sheetWeekPlans);

/**
 * One entry's rows (§3.4) — the week the viewer picks, its rows in the
 * planner's order; each week keeps its own drafts until Apply or Discard, and
 * a week the record does not hold opens empty and read-only. Every column
 * kind the workshop does not draw, with its rules: a date read at each row's
 * own level, with the actual start once one is recorded; an integer; a
 * reference to the sites; a status whose menu an `options` rule narrows until
 * the row has an order code, the code its detail; the code itself stamped by
 * the ERP, the row it is on owned upstream; and the machines a set of codes,
 * runs of which are offered and printed as one range. A row is ready once its
 * quantity is positive. Every gesture is journalled with its provenance
 * (`onPatch`), and a new row's id is minted from a counter (`newRowId`). Its
 * one pane is the inspector, its Details the author's own (SB58): a row's
 * quantity on a slider, written back through `update` as one transaction —
 * while a row is still missing a field, the sheet's own form shows instead.
 */
export const sheetWeeks = example({
    keywords: ["Sheet", "BuilderFrame", "record", "entry", "one entry", "rows", "id", "week", "State", "SegmentGroup", "drafts per entry", "inspector", "update", "Field.Slider", "column", "date", "text", "quantity", "integer", "reference", "enum", "set", "stamped", "owned", "register", "options", "level", "actual", "detail", "ranged", "DateLevel", "week", "day", "range", "time", "rule", "ready", "row", "Readiness", "completeness", "validation", "onPatch", "PatchEvent", "provenance", "source", "newRowId", "newRow", "write-back"],
    description: "A sheet over one entry's rows — the week the viewer picks, its rows in the planner's order, each week its own drafts until Apply or Discard — with every column kind and its rules (a date at each row's level with its actual, an integer, a reference, an enum narrowed by an options rule with a detail, a stamped code owning its row, a set of machines in ranges), a row rule, a journal of every gesture, ids minted by a counter, and its own Details in the inspector pane, a row's quantity on a slider written back as one transaction",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const plans = $.let(Record.bind(sheetWeekPlans, [sheetWeekPlansPatch]));
            // The week the viewer picked, the journal and the id counter: a viewer's own state.
            const week = $.let(State.bind([StringType], "sheet.weeks.week", "2026-W42"));
            const log = $.let(State.bind([ArrayType(StringType)], "sheet.weeks.journal", []));
            const counter = $.let(State.bind([IntegerType], "sheet.weeks.counter", 1n));
            const weeks = $.let(["2026-W42", "2026-W43", "2026-W44"], ArrayType(StringType));
            const pick = $.const(East.function([StringType], NullType, ($, w) => { $(week.write(w)); }));
            const StatusType = StructType({ word: StringType, tone: StatusValueType });
            const statuses = $.let([
                { word: "PLANNED", tone: variant("neutral", null) }, { word: "RELEASED", tone: variant("info", null) },
                { word: "IN PROGRESS", tone: variant("warning", null) }, { word: "COMPLETE", tone: variant("success", null) },
            ], ArrayType(StatusType));
            const sites = $.let(["Machine shop", "Bench room", "Fitting shop", "Spray shop"], ArrayType(StringType));
            const machines = $.let(["S101", "S102", "S103", "E201", "E202", "R301", "R302", "R303", "A701", "A702"], ArrayType(StringType));
            const Ctx = Sheet.Types.DraftContext(WeekRow);
            // Until a row has an order code it may only be planned or released.
            const statusOptions = $.const(East.function([Ctx], OptionType(ArrayType(StringType)), ($, ctx) => {
                const whole = $.const(none, OptionType(ArrayType(StringType)));
                const early = $.const(some(["PLANNED", "RELEASED"]), OptionType(ArrayType(StringType)));
                return ctx.row.code.match({ value: (_$2, code) => code.length().equal(0n).ifElse(() => early, () => whole) }, () => early);
            }));
            // A row is ready once its quantity is positive.
            const readyRow = $.const(East.function([Sheet.Types.Draft(WeekRow), Ctx], Sheet.Types.Readiness, ($, row) => {
                $.if(row.qty.hasTag("value").and(() => row.qty.unwrap("value").match({ some: (_$2, q) => q.lessEqual(0.0), none: () => false })), $ => {
                    $.return(East.value(variant("incomplete", [{ field: "qty", message: "Quantity must be positive" }]), Sheet.Types.Readiness));
                });
                return East.value(variant("ready", null), Sheet.Types.Readiness);
            }));
            // Every gesture, journalled once with where it came from.
            const onPatch = $.const(East.function([Sheet.Types.PatchEvent(WeekRow)], NullType, ($, e) => {
                $(log.write(log.read().concat([East.str`${e.origin.getTag()} · ${e.label} · ${e.readiness.getTag()}`])));
            }));
            // The host mints a new row's id.
            const newRowId = $.const(East.function([], StringType, ($) => {
                const n = $.let(counter.read());
                $(counter.write(n.add(1n)));
                return East.str`new-${n}`;
            }));
            const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(WeekRow), () => Sheet.patch(WeekRow, {
                setups: none, site: "", status: "PLANNED", code: "", level: variant("day", null), started: none, machines: { from: [], to: [] },
            })));
            // A row's own Details: its task, and its quantity on a slider — released, the edited row goes back through `update`.
            const inspect = $.const(East.function([WeekRow, FunctionType([WeekRow], NullType)], UIComponentType, ($, row, update) => {
                const qty = $.let(row.qty.match({ none: () => 0.0, some: (_$, q) => q }));
                const setQty = $.const(East.function([FloatType], NullType, ($2, next) => {
                    // East has no struct spread: the row, rebuilt with its new quantity.
                    const edited = $2.const({
                        id: row.id, task: row.task, start: row.start, qty: some(next), setups: row.setups, site: row.site,
                        status: row.status, code: row.code, level: row.level, started: row.started, machines: row.machines,
                    }, WeekRow);
                    $2(update(edited));
                }));
                return (
                    <VStack gap="3" align="stretch">
                        <Text>{row.task}</Text>
                        <Field.Slider label="Quantity" value={qty} min={0} max={200} step={1}
                            helperText="Released, it is one step the history undoes" onChangeEnd={setQty} />
                    </VStack>
                );
            }));
            const entries = $.let(log.read());
            return (
                <VStack gap="3" align="stretch">
                    <SegmentGroup value={week.read()} onChange={pick} size="sm"
                        items={weeks.map((_$, w) => SegmentGroup.Item(w, <Text>{w}</Text>))} />
                    <Box height="480px">
                        <Sheet
                            record={plans}
                            entry={{ key: week.read(), rows: "rows", id: "id" }}
                            name="weeks"
                            inspector={inspect}
                            owned={r => r.code.length().greater(0n)}
                            registers={{
                                statuses: Sheet.register.members(statuses, { kind: "status", key: s => s.word, label: s => s.word, tone: s => some(s.tone) }),
                                sites:    Sheet.register.members(sites, { kind: "site", key: s => s, label: s => s }),
                                machines: Sheet.register.members(machines, { kind: "machine", key: m => m, label: m => m }),
                            }}
                            columns={{
                                task:     Sheet.column.text(WeekRow, { header: "Task", width: "260px" }),
                                start:    Sheet.column.date(WeekRow, { header: "Start", sub: "at the row's level", width: "168px", level: r => r.level, actual: r => r.started }),
                                qty:      Sheet.column.quantity(WeekRow, { header: "Qty", width: "96px" }),
                                setups:   Sheet.column.integer(WeekRow, { header: "Set-ups", width: "72px" }),
                                site:     Sheet.column.reference(WeekRow, "sites", { header: "Site", width: "128px" }),
                                status:   Sheet.column.enum(WeekRow, "statuses", { header: "Status", width: "132px", options: statusOptions, detail: r => r.code }),
                                code:     Sheet.column.stamped(WeekRow, { header: "Order code", sub: "stamped on release", owner: "ERP", width: "112px" }),
                                machines: Sheet.column.set(WeekRow, "machines", { header: "Machines", sub: "S101-03 · a run", width: "200px",
                                              members: [{ kind: "machine", identified: true, ranged: true }] }),
                            }}
                            ready={{ row: readyRow }}
                            onPatch={onPatch}
                            newRow={newRow}
                            newRowId={newRowId}
                        />
                    </Box>
                    <Text.MonoLabel>{East.str`EDITS · ${entries.length()}`}</Text.MonoLabel>
                    {entries.map((_$, l) => <Text textStyle="caption" color="fg.muted">{l}</Text>)}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetBatches — one entry's groups, in the planner's order (#1187)
// ============================================================================

/** A part a step works — shown as a sub row: its code, its name, its materials, and where it is done. */
export const BatchPart = StructType({ id: StringType, code: StringType, name: StringType, materials: ArrayType(StringType), station: OptionType(StringType) });
/** A booking a step makes — the labour or the equipment it claims, shown as a sub row arm by arm. */
export const BatchBooking = VariantType({
    labour:    StructType({ team: StringType, people: IntegerType, hours: FloatType }),
    equipment: StructType({ resource: StringType }),
});
/** A batch's step — what is done to it, and how many, with the parts it works and the bookings it makes (no columns: its sub rows). */
export const BatchStep = StructType({ task: StringType, qty: OptionType(FloatType), parts: ArrayType(BatchPart), bookings: ArrayType(BatchBooking) });
/** A batch — its id, its name, and its steps in order. */
export const Batch = StructType({ id: StringType, name: StringType, steps: ArrayType(BatchStep) });
/** One day's batches, in the planner's order. */
export const BatchDay = StructType({ batches: ArrayType(Batch) });
/** The days, keyed by date. */
export const sheetBatchDays = e3.record("sheet_batch_days", DictType(StringType, BatchDay), new Map([
    ["2026-10-12", { batches: [
        { id: "B-101", name: "Doors, oak", steps: [
            { task: "Cut doors", qty: some(12.0), parts: [
                { id: "B-101-1", code: "CUT", name: "Cut the door blanks", materials: ["Oak veneered board × 6"], station: some("S101") },
            ], bookings: [variant("labour", { team: "Cutting", people: 1n, hours: 3.0 })] },
            { task: "Band doors", qty: some(48.0), parts: [], bookings: [variant("equipment", { resource: "Edge bander E201" })] },
            { task: "Spray doors", qty: some(12.0), parts: [
                { id: "B-101-3", code: "SPR", name: "Seal and lacquer", materials: ["Sealer", "Matt lacquer"], station: none },
            ], bookings: [] },
        ] },
        { id: "B-102", name: "Carcasses, birch", steps: [
            { task: "Cut carcasses", qty: some(8.0), parts: [], bookings: [] },
            { task: "Drill carcasses", qty: some(8.0), parts: [], bookings: [variant("labour", { team: "Machining", people: 2n, hours: 2.5 })] },
        ] },
        { id: "B-103", name: "Shelves, ash", steps: [
            { task: "Cut shelves", qty: some(20.0), parts: [], bookings: [] },
            { task: "Sand shelves", qty: some(20.0), parts: [], bookings: [] },
        ] },
    ] }],
]));
/** The days' patch door — every Apply commits through it. */
export const sheetBatchDaysPatch = e3.mutation.patch(sheetBatchDays);

/**
 * One day's batches, in the planner's order (#1187, SB39, SB40, SB44) — a
 * grouped sheet over one entry's groups, each batch a group of its steps. A
 * template dragged from the library lands on the seam it is dropped on — a
 * step into the batch under the pointer, a whole batch between two — and a
 * grip moves a step within its batch or into another, or a whole batch to
 * another place in the day. A batch needs a name before Apply, and a new step
 * and a new batch start from their defaults. A step's own records hang under
 * it as sub rows, read only, sharing none of its columns: the parts it works
 * (a struct source — chips and labelled facets, a `none` facet dropping out)
 * and its bookings (a variant source matched arm by arm). Its chevron opens
 * them. Both panes: the library holds the templates and the columns, and the
 * inspector a step's form, which leaves the sub rows' fields out.
 */
export const sheetBatches = example({
    keywords: ["Sheet", "BuilderFrame", "drag", "drop", "move", "grip", "seam", "templates", "group", "grouped", "entry", "order", "Sheet.library.rows", "children", "newGroup", "newRow", "Patch", "defaults", "completeness", "fold", "undo", "redo", "ready", "subRows", "subRow", "sub rows", "SubRow", "Facet", "chips", "facets", "lead", "detail", "noun", "variant", "match", "read-only", "inspector", "Sheet.field", "hidden"],
    description: "A sheet over one day's batches in the planner's order — templates dragged from the library onto a seam, steps and whole batches moved to another seam by their grips, a batch named before Apply, new steps and batches from their defaults, and each step's parts and bookings as read-only sub rows under it, declared per array field like columns, beside a library and an inspector pane",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const days = $.let(Record.bind(sheetBatchDays, [sheetBatchDaysPatch]));
            // The steps a finishing batch starts with: the batch template's lines.
            const finishing = $.let([
                { task: "Sand", qty: none, parts: [], bookings: [] },
                { task: "Seal", qty: none, parts: [], bookings: [] },
                { task: "Spray", qty: none, parts: [], bookings: [] },
            ], ArrayType(BatchStep));
            // A batch needs a name before Apply.
            const readyBatch = $.const(East.function([Sheet.Types.DraftGroup(Batch, "steps")], Sheet.Types.Readiness, ($, batch) => {
                $.if(batch.name.hasTag("value").and(() => batch.name.unwrap("value").length().equal(0n)), $ => {
                    $.return(East.value(variant("incomplete", [{ field: "name", message: "Name the batch" }]), Sheet.Types.Readiness));
                });
                return East.value(variant("ready", null), Sheet.Types.Readiness);
            }));
            const newStep = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(BatchStep), () => Sheet.patch(BatchStep, { qty: none, parts: [], bookings: [] })));
            const newBatch = $.const(East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(Batch), () => Sheet.patch(Batch, { steps: [] })));
            return (
                <Box height="560px">
                    <Sheet
                        record={days}
                        entry={{ key: "2026-10-12", rows: "batches", id: "id" }}
                        group={Sheet.group(Batch, "steps", { title: "name", noun: { singular: "batch", plural: "batches" } })}
                        name="batches"
                        columns={{
                            task: Sheet.column.text(BatchStep, { header: "Step", width: "240px" }),
                            qty:  Sheet.column.quantity(BatchStep, { header: "Qty", width: "96px" }),
                        }}
                        subRows={Sheet.subRows(BatchStep, {
                            parts: (p) => Sheet.subRow({
                                code:   p.code,
                                name:   p.name,
                                chips:  p.materials,
                                facets: { station: p.station },   // a none drops out
                                id:     p.id,
                            }),
                            bookings: (b) => b.match({
                                labour:    (_$2, l) => Sheet.subRow({ code: "LABOUR", name: East.str`${l.team} · ${l.people} people · ${l.hours} hours` }),
                                equipment: (_$2, e) => Sheet.subRow({ code: "EQUIPMENT", name: e.resource }),
                            }),
                        })}
                        // The sub rows show a step's parts and bookings; the inspector's form leaves them out.
                        inspector
                        fields={{ parts: Sheet.field.hidden(), bookings: Sheet.field.hidden() }}
                        templates={{
                            groups: [{ key: "finishing", name: "Finishing batch", group: "Batches",
                                       values: Sheet.patch(Batch, { name: "Finishing", steps: finishing }) }],
                            rows:   [{ key: "sand", name: "Sand", group: "Steps", values: Sheet.patch(BatchStep, { task: "Sand", qty: none }) },
                                     { key: "seal", name: "Seal", group: "Steps", values: Sheet.patch(BatchStep, { task: "Seal", qty: none }) }],
                        }}
                        library={[Sheet.library.rows(), Sheet.library.columns()]}
                        ready={{ group: readyBatch }}
                        newRow={newStep}
                        newGroup={newBatch}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetLoose — loose rows between the groups (#846)
// ============================================================================

/** A task — a package's line, or a loose task that belongs to no package; `id` identifies a loose one. */
export const LooseTask = StructType({ id: StringType, task: StringType, qty: OptionType(FloatType), notes: StringType });
/** A work package — its name and its tasks. */
export const LoosePackage = StructType({ id: StringType, name: StringType, tasks: ArrayType(LooseTask) });
/** An entry of the week — a package with its tasks, or a loose task. */
export const LooseEntry = Sheet.Types.Entry(LoosePackage, "tasks");
/** A week's work — its entries, in the planner's order. */
export const LooseWork = StructType({ entries: ArrayType(LooseEntry) });
/** The work, one entry per week. */
export const sheetLooseWork = e3.record("sheet_loose_work", DictType(StringType, LooseWork), new Map([
    ["2026-W42", { entries: [
        variant("row", { id: "brief", task: "Check the drawings", qty: none, notes: "Before any cutting" }),
        variant("group", { id: "doors", name: "Kitchen doors", tasks: [
            { id: "doors-1", task: "Cut door blanks", qty: some(24.0), notes: "Oak veneered board" },
            { id: "doors-2", task: "Inspect the blanks", qty: some(4.0), notes: "Before finishing" },
        ] }),
        variant("row", { id: "handover", task: "Hand over to finishing", qty: none, notes: "" }),
        variant("group", { id: "finish", name: "Door finishing", tasks: [
            { id: "finish-1", task: "Spray the doors", qty: some(24.0), notes: "Matt lacquer" },
        ] }),
    ] }],
]));
/** The work's patch door — every Apply commits through it. */
export const sheetLooseWorkPatch = e3.mutation.patch(sheetLooseWork);

/**
 * Loose rows between the groups (#846) — the week's entries are
 * `Sheet.Types.Entry(LoosePackage, "tasks")`: a work package with its
 * tasks, or a task that belongs to no package. A loose task draws as a plain
 * row, numbered in the packages' sequence; the seam above a package's band,
 * or beside a loose task, inserts a loose task, and a task's seam inserts a
 * task into its package. `id` names a field of both types: a loose task is an
 * entry, identified like a package, and a new task's id is minted. A loose
 * task's grip moves it between the entries, as a package's moves the package.
 * It is given no pane.
 */
export const sheetLoose = example({
    keywords: ["Sheet", "BuilderFrame", "group", "grouped", "loose", "ungrouped", "Entry", "Types.Entry", "variant", "entries", "insert", "move", "newRow", "newGroup", "noun", "entry", "record"],
    description: "A sheet over one week's entries — work packages and loose tasks: a loose task is a plain row numbered in the packages' sequence, inserted at the seam above a package or beside another loose task, and moved between the entries by its grip",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const work = $.let(Record.bind(sheetLooseWork, [sheetLooseWorkPatch]));
            const newTask = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(LooseTask), () => Sheet.patch(LooseTask, { qty: none, notes: "" })));
            const newPackage = $.const(East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(LoosePackage), () => Sheet.patch(LoosePackage, { tasks: [] })));
            return (
                <Box height="480px">
                    <Sheet
                        record={work}
                        entry={{ key: "2026-W42", rows: "entries", id: "id" }}
                        group={Sheet.group(LoosePackage, "tasks", { title: "name", noun: { singular: "package", plural: "packages" } })}
                        name="loose"
                        columns={{
                            task:  Sheet.column.text(LooseTask, { header: "Task", width: "240px" }),
                            qty:   Sheet.column.quantity(LooseTask, { header: "Qty", width: "96px" }),
                            notes: Sheet.column.text(LooseTask, { header: "Notes", width: "260px" }),
                        }}
                        newRow={newTask}
                        newGroup={newPackage}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetPaged — a record read a window at a time (§3.4)
// ============================================================================

/**
 * A record read a window at a time (§3.4) — the jobs, paged in key order: the
 * key search seeks a job by its key, and the lens narrows the loaded rows. Its
 * `edits` let rows be added — from a gutter seam, the selection strip, or
 * Alt+Insert — and never removed: a job leaves through the record's own
 * process, not the sheet. It is given no pane.
 */
export const sheetPaged = example({
    keywords: ["Sheet", "BuilderFrame", "record", "window", "Data.bindPaged", "paged", "key order", "key search", "edits", "insertRows", "removeRows", "insert", "before", "after", "Undo"],
    description: "A sheet over a large record, read a window at a time in key order — Data.bindPaged over the same record its Apply commits to — whose edits add rows (gutter seams, the selection strip, Alt+Insert) and never remove one",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const jobs = $.let(Record.bind(sheetJobs, [sheetJobsPatch]));
            const page = $.let(Data.bindPaged(sheetJobs));
            return (
                <Box height="560px">
                    <Sheet
                        record={jobs}
                        window={page}
                        name="paged"
                        edits={{ insertRows: true, removeRows: false }}
                        columns={{
                            task:  Sheet.column.text(SheetJob, { header: "Task", width: "240px" }),
                            start: Sheet.column.date(SheetJob, { header: "Start", width: "96px" }),
                            qty:   Sheet.column.quantity(SheetJob, { header: "Qty", width: "96px" }),
                        }}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetUpkeep — the inspector's every field kind (#1220)
// ============================================================================

/** A machine's family — the kind of machine it is. */
export const UpkeepFamily = VariantType({ beam_saw: NullType, edge_bander: NullType, cnc_router: NullType, spray_booth: NullType });
/** One check of a service — what is checked, and whether it was done. */
export const UpkeepCheck = StructType({ text: StringType, done: BooleanType });
/** Who supplies a machine's parts. */
export const UpkeepSupplier = StructType({ name: StringType, phone: StringType });
/** A machine's upkeep — one field of each kind the inspector's form edits. */
export const MachineUpkeep = StructType({
    name:          StringType,                 // a text column
    bay:           StringType,                 // a reference column: a key of the bays
    hours:         IntegerType,                // an integer column: a number with its unit and bounds
    family:        UpkeepFamily,               // a select of the variant's cases
    wear:          OptionType(FloatType),      // a number with its unit, bounds and step, cleared to none
    crew:          OptionType(StringType),     // a text, emptied to none
    tickets:       SetType(StringType),        // tags, the tickets offered as they are typed
    checks:        ArrayType(UpkeepCheck),     // a checklist
    supplier:      UpkeepSupplier,             // a nested struct: its fields under its name
    in_service:    BooleanType,                // a checkbox
    guard_checked: OptionType(BooleanType),    // a checkbox, cleared to none: not recorded
    serviced:      DateTimeType,               // a date and a time
    next_service:  OptionType(DateTimeType),   // a date and a time, set or cleared
    serial:        StringType,                 // a stamped column: read only
});
/** The machines' upkeep, keyed by machine code. */
export const sheetMachineUpkeep = e3.record("sheet_machine_upkeep", DictType(StringType, MachineUpkeep), new Map([
    ["S101", { name: "Beam saw", bay: "Bay 1", hours: 1240n, family: variant("beam_saw", null), wear: some(35.5), crew: some("Cutting crew"),
        tickets: new Set(["Panel saw ticket", "Dust extraction"]),
        checks: [{ text: "Blade sharpened", done: true }, { text: "Fence squared", done: true }, { text: "Extraction cleaned", done: false }],
        supplier: { name: "Kestrelmoor Saw Works", phone: "01632 960 118" },
        in_service: true, guard_checked: some(true),
        serviced: new Date("2026-09-28T07:30:00Z"), next_service: some(new Date("2026-11-09T07:30:00Z")), serial: "BS-4410-0193" }],
    ["E201", { name: "Edge bander", bay: "Bay 2", hours: 860n, family: variant("edge_bander", null), wear: none, crew: none,
        tickets: new Set<string>(), checks: [], supplier: { name: "", phone: "" },
        in_service: true, guard_checked: none,
        serviced: new Date("2026-08-17T06:00:00Z"), next_service: none, serial: "EB-2207-0457" }],
    ["R301", { name: "CNC router", bay: "Bay 3", hours: 2210n, family: variant("cnc_router", null), wear: some(62.0), crew: some("Machining crew"),
        tickets: new Set(["Router ticket"]),
        checks: [{ text: "Spindle greased", done: true }, { text: "Bed vacuum tested", done: false }],
        supplier: { name: "Brindlecote Tooling", phone: "01632 960 342" },
        in_service: false, guard_checked: some(false),
        serviced: new Date("2026-07-06T13:15:00Z"), next_service: none, serial: "CR-5120-0088" }],
    ["F401", { name: "Spray booth", bay: "Bay 4", hours: 540n, family: variant("spray_booth", null), wear: none, crew: some("Finishing crew"),
        tickets: new Set(["Spray ticket", "First aid"]),
        checks: [{ text: "Filters changed", done: true }],
        supplier: { name: "Fennimarsh Coatings", phone: "01632 960 775" },
        in_service: true, guard_checked: some(true),
        serviced: new Date("2026-10-01T08:00:00Z"), next_service: some(new Date("2026-12-01T08:00:00Z")), serial: "SB-0391-0017" }],
]));
/** The upkeep's patch door — every Apply commits through it. */
export const sheetMachineUpkeepPatch = e3.mutation.patch(sheetMachineUpkeep);

/**
 * The inspector's every field kind (#1220) — the workshop's machines' upkeep,
 * a record keyed by machine code. The grid shows four columns: a machine's
 * name, its bay, the hours it has run and its serial, stamped by its maker.
 * The inspector pane shows every field of the selected machine through
 * `Fields`' form: a column's field through its column's kind, a field no
 * column shows by its type, each hinted with `Sheet.field.*` where its type
 * cannot say enough — a number with its unit, bounds and step, a select of a
 * variant's cases, a reference to the bays, a text emptied to none, tags
 * offered from a list, a checklist, a nested struct's fields under its name,
 * a checkbox, a date and a time, and Options set and cleared. The hinted
 * fields lead, in hint order, and the rest follow in declared order. A
 * machine out of service needs its next service booked before Apply. It is
 * given no library.
 */
export const sheetUpkeep = example({
    keywords: ["Sheet", "BuilderFrame", "inspector", "fields", "Sheet.field", "Fields", "form", "text", "placeholder", "number", "unit", "min", "max", "step", "select", "labels", "reference", "register", "checkbox", "datetime", "Option", "Set", "Clear", "tags", "options", "checklist", "nested", "struct", "stamped", "readonly", "integer", "ready", "row", "Readiness", "record"],
    description: "A sheet whose inspector pane edits one field of every kind over the workshop's machines' upkeep — a number with its unit and bounds, a select of a variant's cases, a reference, a text emptied to none, tags, a checklist, a nested struct's fields under its name, a checkbox, a date and a time, Options set and cleared, and a stamped code read only — the hinted fields leading, with a row rule's issue",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const upkeep = $.let(Record.bind(sheetMachineUpkeep, [sheetMachineUpkeepPatch]));
            const bays = $.let(["Bay 1", "Bay 2", "Bay 3", "Bay 4", "Bay 7"], ArrayType(StringType));
            // A machine out of service needs its next service booked.
            const readyMachine = $.const(East.function([Sheet.Types.Draft(MachineUpkeep), Sheet.Types.DraftContext(MachineUpkeep)], Sheet.Types.Readiness, ($, row) => {
                const out = $.const(row.in_service.match({ value: (_$2, on) => on.not() }, () => false));
                const unbooked = $.const(row.next_service.match({ value: (_$2, next) => next.hasTag("none") }, () => false));
                $.if(out.and(() => unbooked), $ => {
                    $.return(East.value(variant("incomplete", [{ field: "next_service", message: "Out of service — book its next service" }]), Sheet.Types.Readiness));
                });
                return East.value(variant("ready", null), Sheet.Types.Readiness);
            }));
            return (
                <Box height="640px">
                    <Sheet
                        record={upkeep}
                        name="upkeep"
                        registers={{ bays: Sheet.register.members(bays, { kind: "bay", key: b => b, label: b => b }) }}
                        columns={{
                            name:   Sheet.column.text(MachineUpkeep, { header: "Machine", width: "200px" }),
                            bay:    Sheet.column.reference(MachineUpkeep, "bays", { header: "Bay", width: "96px" }),
                            hours:  Sheet.column.integer(MachineUpkeep, { header: "Hours", sub: "run since new", width: "96px" }),
                            serial: Sheet.column.stamped(MachineUpkeep, { header: "Serial", sub: "on the maker's plate", owner: "Maker", width: "140px" }),
                        }}
                        // The inspector pane: every field of a machine — the hinted ones first, in this order.
                        inspector
                        fields={{
                            name:     Sheet.field.text({ placeholder: "Its name on the floor" }),
                            bay:      Sheet.field.reference({ of: "bays", help: "Where it stands" }),
                            hours:    Sheet.field.number({ unit: "h", min: 0n, step: 10n }),
                            family:   Sheet.field.select({ labels: { beam_saw: "Beam saw", edge_bander: "Edge bander", cnc_router: "CNC router", spray_booth: "Spray booth" } }),
                            wear:     Sheet.field.number({ label: "Blade wear", unit: "%", min: 0, max: 100, step: 0.5 }),
                            crew:     Sheet.field.text({ placeholder: "Which crew runs it" }),
                            tickets:  Sheet.field.tags({ options: ["Panel saw ticket", "Router ticket", "Spray ticket", "Dust extraction", "First aid"] }),
                            checks:   Sheet.field.checklist({ help: "Signed off at the last service" }),
                            supplier: { name: Sheet.field.text({ placeholder: "Who supplies its parts" }), phone: Sheet.field.text({ placeholder: "01632 960 000" }) },
                        }}
                        ready={{ row: readyMachine }}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
