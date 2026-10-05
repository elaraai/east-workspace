/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import {
    East, ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, StringType, StructType,
    example, none, some, variant,
} from "@elaraai/east";
import {
    Badge, Box, Configurator, Format, HStack, Input, Reactive, SegmentGroup, Slice, State, Style, Switch, Text, UIComponentType,
} from "@elaraai/east-ui";
import { Data, Record, Sheet } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// The Sheet's `Sheet.View` examples — the slots of EXAMPLES_AUTHORING.md §8
// for a sheet with no chrome around it, in the app's own layout (#1189):
// `sheetBasic`, the smallest; `sheetVariants`, THE configurator; and
// `sheetStress`, two thousand rows with the lens over them. Everything else a
// sheet does is shown in its frame, on `Sheet.Builder`
// (`sheet-builder.examples.tsx`): the flagship, the column kinds and their
// rules, groups and loose rows, a paged record. The fixtures are synthetic: a
// joinery workshop (machines in bays, panels moving between them), no
// customer, site or product names.
//
// Every sheet binds its rows from e3, so each runs on e3-web in the showcase
// (#1180). A sheet that writes reads one entry of an `e3.record` declared
// beside it, the entry's Array field its rows in the planner's order and the
// record's small literal default its genesis commit; Apply commits the drafts
// through the record's patch door (`Record.onApply` over that entry's rows). A
// sheet that only reads binds a task's output with `Data.bind`: its rows are
// made where data is made, by an `e3.task` over a count. `State` holds only
// what the viewer owns: a configurator's axes, saved views. Everything else an
// example needs — its registers, fills, rules — is an East value bound once in
// its body. The declarations an example reaches travel with it into its docs
// and the plugin index.
// ============================================================================

// ============================================================================
// sheetBasic — the smallest sheet
// ============================================================================

/** A job — when it starts, what it is and how many. */
export const BasicJob = StructType({
    id:    StringType,
    start: OptionType(DateTimeType),   // none = blank cell
    task:  StringType,                 // "" = blank cell
    qty:   OptionType(FloatType),
});
/** A plan — its jobs, in the planner's order. */
export const BasicPlan = StructType({ jobs: ArrayType(BasicJob) });
/** The plans — the sheet edits the week's jobs; the record's default is its genesis commit. */
export const sheetBasicPlans = e3.record("sheet_basic_plans", DictType(StringType, BasicPlan), new Map([
    ["week", { jobs: [
        { id: "j1", start: none, task: "Routing", qty: none },
    ] }],
]));
/** The record's patch door — every Apply commits through it. */
export const sheetBasicPlansPatch = e3.mutation.patch(sheetBasicPlans);

/**
 * The smallest sheet (§3.1) — three typed columns over the host's structs:
 * the week's jobs, read from an e3 record. Every change is a draft the
 * history bar applies as one checked batch — one commit through the record's
 * patch door (`Record.onApply` over the entry's rows).
 */
export const sheetBasic = example({
    keywords: ["Sheet", "Root", "basic", "column", "date", "text", "quantity", "onApply", "Record", "Record.bind", "Record.onApply", "e3.record", "patch", "commit", "bound", "Reactive", "id"],
    description: "The smallest sheet — three typed columns over the jobs an e3 record holds, draft changes reviewed together and applied as one commit through the record's patch door",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The plans, bound with their patch door: the sheet reads the
            // week's jobs, and Apply commits the drafts to them.
            const plans = $.let(Record.bind(sheetBasicPlans, [sheetBasicPlansPatch]));
            const jobs = $.let(plans.read().get("week").jobs);
            const onApply = $.const(Record.onApply(plans, {
                entry: "week",
                get: East.function([BasicPlan], ArrayType(BasicJob), (_$, held) => held.jobs),
                set: East.function([BasicPlan, ArrayType(BasicJob)], BasicPlan, (_$, _held, next) => ({ jobs: next })),
                idField: "id",
            }));
            return (
                <Sheet.View
                    data={jobs}
                    id="id"
                    columns={{
                        start: Sheet.column.date(BasicJob, { header: "Start", sub: "dd / mm / yyyy" }),
                        task:  Sheet.column.text(BasicJob, { header: "Task" }),
                        qty:   Sheet.column.quantity(BasicJob, { header: "Qty" }),   // no driver on this sheet — the two-argument form
                    }}
                    onApply={onApply}
                />
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
 * THE Sheet configurator — ONE live sheet; every axis is an expression-fed
 * prop on that single instance: density, the blank tail, read-only, the size
 * mode (auto / scroll / fill) and the copilot switch (a fill provider that
 * reads the switch through its captured bind handle). Selection and edits
 * log to the reactive aside. The sheet reads its jobs from an e3 record and
 * Apply commits to it; the configurator's axes are the viewer's own state.
 */
export const sheetVariants = example({
    keywords: ["Sheet", "Root", "configurator", "density", "blanks", "readOnly", "height", "fill", "scroll", "#320", "copilot", "fill", "provider", "onSelect", "onPatch", "onApply", "Record", "Record.onApply", "e3.record", "bound", "Configurator", "SegmentGroup", "Switch", "Input", "Reactive", "State"],
    description: "Sheet configurator — density, the blank tail, read-only, size mode (auto / scroll / fill) and the copilot switch all expression-fed into one live sheet over an e3 record; selection and edits log to the aside",
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
            const sizeModes = $.const(["auto", "scroll", "fill"], ArrayType(StringType));

            const densityBind  = $.let(State.bind([StringType], "sheet_variants_density", "compact"));
            const blanksBind   = $.let(State.bind([IntegerType], "sheet_variants_blanks", 18n));
            const readOnlyBind = $.let(State.bind([BooleanType], "sheet_variants_readonly", false));
            const sizeBind     = $.let(State.bind([StringType], "sheet_variants_size", "scroll"));
            const copilotBind  = $.let(State.bind([BooleanType], "sheet_variants_copilot", true));
            const lastEventBind = $.let(State.bind([StringType], "sheet_variants_last_event", ""));

            const dKey = $.let(densityBind.read());
            const blanks = $.let(blanksBind.read());
            const readOnly = $.let(readOnlyBind.read());
            const sKey = $.let(sizeBind.read());
            const copilotOn = $.let(copilotBind.read());
            const lastEvent = $.let(lastEventBind.read());

            const onDensity  = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const onBlanks   = $.const(East.function([IntegerType], NullType, ($, next) => { $(blanksBind.write(next)); }));
            const onReadOnly = $.const(East.function([BooleanType], NullType, ($, next) => { $(readOnlyBind.write(next)); }));
            const onSize     = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
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
            // Size mode — an empty height reads as unbounded, so ONE sheet
            // covers auto / scroll / fill; the wrapper Box bounds fill mode only.
            const boxHeight = $.let(sKey.equal("fill").ifElse((_$) => "320px", (_$) => ""));
            const sheetHeight = $.let(sKey.equal("scroll").ifElse(
                (_$) => "360px",
                (_$) => sKey.equal("fill").ifElse((_$) => "fill", (_$) => ""),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Size", sKey,
                            <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                items={sizeModes.map((_$, m) => SegmentGroup.Item(m, <Text>{m.upperCase()}</Text>))} />),
                        Configurator.Control("Blank tail", East.print(blanks),
                            <Input.Integer value={blanks} min={0n} max={40n} step={2n} size="sm" onChange={onBlanks} />),
                        Configurator.Slot("Chrome",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={readOnly} label="Read-only" onChange={onReadOnly} />
                                <Switch checked={copilotOn} label="Copilot" onChange={onCopilot} />
                            </HStack>),
                    ]}
                    preview={
                        <Box width="100%" height={boxHeight} overflow="hidden">
                            <Sheet.View
                                data={rows}
                                id="id"
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
                                style={{ height: sheetHeight }}
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
 * Stress, and the lens (§3.8) — two thousand jobs an e3 task generates, read
 * only, every row virtualised. Search and filter run through the bound slice;
 * the sheet never narrows, it draws the rows the narrowing leaves as
 * collapsed context bands while hits keep their row numbers. The work
 * centres are a set column searched through its display form
 * (`text: r => Sheet.link.print(r.stations)`); saved views are slice-state
 * snapshots evaluated live, with their context and reveals, the first one
 * open. The rows are a task's output, made where data is made, so the sheet
 * only reads them; the views are the viewer's own.
 */
export const sheetStress = example({
    keywords: ["Sheet", "Root", "stress", "virtualization", "2000", "rows", "performance", "readOnly", "slice", "search", "filter", "lens", "bands", "context", "reveal", "views", "onViewsChange", "activeView", "text", "Sheet.link.print", "set", "register", "concat", "footer", "Slice", "config", "bind", "state", "Data.bind", "bound", "e3.task", "generated", "Reactive", "State"],
    description: "Two thousand jobs an e3 task generates, read only and virtualised, with the lens over them — search and filter through the bound slice drawn as context bands (hits keep their row numbers), a set column searched through its display text, and saved views as slice-state snapshots with their context and reveals",
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
                <Sheet.View
                    data={jobs}
                    id="id"
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
                    views={views.read()} onViewsChange={views.write} activeView={some("spraying")}
                    readOnly
                    footer={[{ text: East.str`${count} rows · virtualised` }]}
                    style={{ height: "480px" }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
