/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import {
    East, ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
    example, none, some, variant,
} from "@elaraai/east";
import {
    Badge, Box, Configurator, Format, HStack, Input, Reactive, SegmentGroup, Slice, State, Status, Style, Switch, Text, UIComponentType, VStack,
} from "@elaraai/east-ui";
import { Data, Record, Sheet } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// The Sheet corpus — the five slots of EXAMPLES_AUTHORING.md §8 (Sheet Spec.md §8 P1):
// `sheetBasic` · `sheetVariants` (THE configurator) · `sheetPlan` (the flagship)
// · the behavioural isolates `sheetCopilot` / `sheetLens` / `sheetWriteBack` /
// `sheetGrouped` / `sheetReadiness` / `sheetInsertion` /
// `sheetSubRows` / `sheetRules` / `sheetRegisters` / `sheetLoose` · `sheetStress`. The paged
// sheet is `dataBindPagedSheet` in the data examples, and a sheet over a
// record's own entries `recordSheetApply` in the record examples. The fixtures
// are the prototype's synthetic registers and rows: a discrete manufacturing
// plant (machines on lines, work orders moving parts between them), no
// customer, site or product names.
//
// Every sheet binds its rows from e3, so each runs on e3-web in the showcase
// (#1180). A sheet that writes reads one entry of an `e3.record` declared
// beside it, the entry's Array field its rows in the planner's order and the
// record's small literal default its genesis commit; Apply commits the drafts
// through the record's patch door (`Record.onApply` over that entry's rows). A
// sheet that only reads binds an input or a task's output with `Data.bind`, and
// rows made by a rule rather than written out — the lens's sixty, the stress
// sheet's two thousand — are made where data is made, by an `e3.task` over a
// count. `State` holds only what the viewer owns: a configurator's axes, a
// gesture log, saved views, an id counter. Everything else an example needs —
// its registers, fills, proposers and rules — is an East value bound once in
// its body. The declarations an example reaches travel with it into its docs
// and the plugin index.
// ============================================================================

// ============================================================================
// The production plan's rows — sheetPlan and sheetCopilot
// ============================================================================

/** A plan row — the raw record: when it runs, its activity (the driver), how
 *  many, its notes, its work centres (a typed link, from → to), its setups, the
 *  sites it moves between and the ERP's stamps. */
export const PlanRow = StructType({
    id: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), activity: StringType,
    qty: OptionType(FloatType), notes: StringType, stations: Sheet.Types.Link, setups: OptionType(IntegerType),
    fromSite: StringType, toSite: StringType, orderCode: StringType, status: StringType,
});
/** An activity — the driver's row: its unit, rate, crew, duration and the
 *  halves of a link it makes live. */
export const PlanActivity = StructType({
    name: StringType, uom: StringType, rate: FloatType, fte: IntegerType, days: IntegerType, sides: Sheet.Types.Sides,
});
/** A production plan — its rows, in the planner's order. */
export const ProductionPlan = StructType({ rows: ArrayType(PlanRow) });

/** The model behind an async proposer — an e3 function, a service, a notebook; the Sheet only needs the types. */
const planRecommend = East.asyncPlatform(
    "sheet_plan_recommend",
    [Sheet.Types.DraftContext(PlanRow, PlanActivity)],
    ArrayType(Sheet.Types.Proposal(PlanRow)),
    { optional: true },
);

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
        { id: "j1", start: none, task: "Machining", qty: none },
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
        { id: "j1", start: some(new Date("2026-02-16T00:00:00Z")), task: "Machining", qty: some(1200.0), notes: "Rough the P-40 blanks" },
        { id: "j2", start: some(new Date("2026-03-09T00:00:00Z")), task: "Painting", qty: some(250.0), notes: "" },
        { id: "j3", start: none, task: "Packaging", qty: none, notes: "" },
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
// sheetPlan — the flagship
// ============================================================================

/** The plans — the flagship edits Q3's rows: the prototype's seed, as typed data (a Link is a value, never a string). */
export const sheetPlanPlans = e3.record("sheet_plan_plans", DictType(StringType, ProductionPlan), new Map([
    ["q3", { rows: [
        { id: "1", start: some(new Date("2026-02-16T00:00:00Z")), end: some(new Date("2026-02-20T00:00:00Z")), activity: "Machining - Roughing", qty: some(1200.0), notes: "Rough 1,200 P-40 blanks on 4 lathes for the Q3 build", stations: { from: [], to: [variant("identified", { key: "M2140" }), variant("identified", { key: "M2141" }), variant("identified", { key: "M2145" }), variant("identified", { key: "M2150" })] }, setups: some(4n), fromSite: "", toSite: "South plant", orderCode: "WO-26001", status: "RELEASED" },
        { id: "2", start: some(new Date("2026-02-16T00:00:00Z")), end: some(new Date("2026-02-20T00:00:00Z")), activity: "Inspection", qty: some(4.0), notes: "Inspect the 4 roughing lots at the south plant", stations: { from: [], to: [variant("counted", { n: 4n, key: "CNC lathe" })] }, setups: none, fromSite: "", toSite: "", orderCode: "WO-26002", status: "RELEASED" },
        { id: "3", start: some(new Date("2026-03-09T00:00:00Z")), end: some(new Date("2026-03-13T00:00:00Z")), activity: "Assembly", qty: some(280.0), notes: "Assemble 280 units on line 7", stations: { from: [variant("identified", { key: "M2151" }), variant("identified", { key: "M2160" })], to: [variant("identified", { key: "M7301" }), variant("identified", { key: "M7302" })] }, setups: none, fromSite: "South plant", toSite: "North plant", orderCode: "WO-26003", status: "RELEASED" },
        { id: "4", start: some(new Date("2026-04-20T00:00:00Z")), end: some(new Date("2026-04-24T00:00:00Z")), activity: "Rework", qty: some(96.0), notes: "Rework 96 rejected housings", stations: { from: [], to: [variant("placeholder", null)] }, setups: none, fromSite: "", toSite: "", orderCode: "WO-26005", status: "RELEASED" },
        { id: "5", start: some(new Date("2026-06-22T00:00:00Z")), end: some(new Date("2026-06-26T00:00:00Z")), activity: "Sub-assembly", qty: some(180.0), notes: "sub-assemble at cell A", stations: { from: [], to: [] }, setups: none, fromSite: "", toSite: "", orderCode: "", status: "RELEASED" },
        { id: "6", start: some(new Date("2026-06-29T00:00:00Z")), end: some(new Date("2026-07-03T00:00:00Z")), activity: "Sub-assembly", qty: some(180.0), notes: "Sub-assemble the second lot", stations: { from: [], to: [] }, setups: none, fromSite: "", toSite: "", orderCode: "", status: "RELEASED" },
        { id: "7", start: some(new Date("2026-07-06T00:00:00Z")), end: some(new Date("2026-07-10T00:00:00Z")), activity: "Machining - Roughing", qty: some(1600.0), notes: "1,600 P-40 blanks", stations: { from: [], to: [] }, setups: none, fromSite: "", toSite: "", orderCode: "", status: "RELEASED" },
        { id: "8", start: some(new Date("2026-07-13T00:00:00Z")), end: some(new Date("2026-07-17T00:00:00Z")), activity: "Machining", qty: some(1600.0), notes: "Finish 1,600 P-40 blanks", stations: { from: [], to: [] }, setups: none, fromSite: "", toSite: "", orderCode: "", status: "RELEASED" },
        { id: "9", start: some(new Date("2026-07-13T00:00:00Z")), end: some(new Date("2026-07-17T00:00:00Z")), activity: "Painting", qty: some(250.0), notes: "paint 250 P-40 housings", stations: { from: [], to: [] }, setups: none, fromSite: "", toSite: "", orderCode: "", status: "CANCELLED" },
        { id: "10", start: some(new Date("2026-09-07T00:00:00Z")), end: some(new Date("2026-09-11T00:00:00Z")), activity: "Painting", qty: some(180.0), notes: "paint the sub-assemblies next week", stations: { from: [variant("identified", { key: "M1104" })], to: [variant("identified", { key: "Test bay" })] }, setups: none, fromSite: "North plant", toSite: "", orderCode: "WO-26008", status: "RELEASED" },
        { id: "11", start: some(new Date("2026-09-07T00:00:00Z")), end: some(new Date("2026-09-11T00:00:00Z")), activity: "Painting", qty: some(140.0), notes: "paint 140 housings", stations: { from: [], to: [] }, setups: none, fromSite: "", toSite: "", orderCode: "", status: "" },
    ] }],
]));
/** The record's patch door — every Apply commits through it. */
export const sheetPlanPlansPatch = e3.mutation.patch(sheetPlanPlans);

/**
 * The flagship (§3.11) — every column kind, three registers and a driver,
 * the copilot's fills and proposers as author functions, the slice lens with
 * saved views (the viewer's own), a footer, and Apply committing to an e3
 * record through its patch door, on one sheet.
 */
export const sheetPlan = example({
    keywords: ["Sheet", "Root", "plan", "flagship", "driver", "register", "lookup", "reference", "enum", "link", "stamped", "quantity", "uom", "sides", "arity", "check", "fill", "propose", "suggest", "asyncFunction", "asyncPlatform", "slice", "search", "filter", "lens", "views", "text", "Sheet.link.print", "footer", "owned", "onApply", "Record", "Record.bind", "Record.onApply", "e3.record", "patch", "bound", "Reactive", "State"],
    description: "The flagship production plan — every column kind over one raw source, registers and a driver, the copilot's fills and proposers as author functions (one async), the slice lens with saved views, a footer and Apply committing to an e3 record",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const MachineType  = StructType({ code: StringType, family: StringType, line: StringType, site: StringType });
            const LineType     = StructType({ code: StringType, name: StringType, machines: IntegerType, aliases: ArrayType(StringType) });
            const FamilyType   = StructType({ name: StringType, aliases: ArrayType(StringType) });
            const StatusType   = StructType({ word: StringType, tone: Status.Types.Value });
            const Ctx = Sheet.Types.DraftContext(PlanRow, PlanActivity);
            const Proposals = ArrayType(Sheet.Types.Proposal(PlanRow));

            // The synthetic registers — a discrete manufacturing plant: machines on
            // lines, work orders moving parts between them.
            const activities = $.const([
                { name: "Machining", uom: "pcs", rate: 60.0, fte: 2n, days: 4n, sides: variant("both", null) },
                { name: "Machining - Roughing", uom: "pcs", rate: 80.0, fte: 2n, days: 4n, sides: variant("both", null) },
                { name: "Assembly", uom: "units", rate: 30.0, fte: 3n, days: 4n, sides: variant("both", null) },
                { name: "Sub-assembly", uom: "units", rate: 45.0, fte: 2n, days: 4n, sides: variant("both", null) },
                { name: "Painting", uom: "pcs", rate: 50.0, fte: 3n, days: 4n, sides: variant("both", null) },
                { name: "Painting - Primer", uom: "pcs", rate: 70.0, fte: 2n, days: 4n, sides: variant("both", null) },
                { name: "Packaging", uom: "cartons", rate: 120.0, fte: 1n, days: 3n, sides: variant("both", null) },
                { name: "Deburring", uom: "pcs", rate: 90.0, fte: 1n, days: 3n, sides: variant("both", null) },
                { name: "Heat treatment", uom: "pcs", rate: 40.0, fte: 2n, days: 3n, sides: variant("both", null) },
                { name: "Rework", uom: "pcs", rate: 20.0, fte: 2n, days: 3n, sides: variant("in", null) },
                { name: "Inspection", uom: "lots", rate: 4.0, fte: 2n, days: 4n, sides: variant("in", null) },
                { name: "Calibration", uom: "machines", rate: 2.0, fte: 2n, days: 4n, sides: variant("in", null) },
                { name: "Changeover", uom: "h", rate: 1.0, fte: 1n, days: 1n, sides: variant("in", null) },
                { name: "Receiving", uom: "pallets", rate: 20.0, fte: 1n, days: 1n, sides: variant("to", null) },
                { name: "Shipping", uom: "pallets", rate: 20.0, fte: 1n, days: 1n, sides: variant("from", null) },
                { name: "Maintenance", uom: "h", rate: 1.0, fte: 1n, days: 1n, sides: variant("in", null) },
            ], ArrayType(PlanActivity));
            const machines = $.const([
                { code: "M1104", family: "120 t press", line: "Line 1", site: "North plant" }, { code: "M1120", family: "120 t press", line: "Line 1", site: "North plant" },
                { code: "M2140", family: "CNC lathe", line: "Line 2", site: "South plant" }, { code: "M2141", family: "CNC lathe", line: "Line 2", site: "South plant" },
                { code: "M2142", family: "CNC lathe", line: "Line 2", site: "South plant" }, { code: "M2145", family: "CNC lathe", line: "Line 2", site: "South plant" },
                { code: "M2150", family: "CNC lathe", line: "Line 2", site: "South plant" }, { code: "M2151", family: "CNC lathe", line: "Line 2", site: "South plant" },
                { code: "M2160", family: "CNC lathe", line: "Line 2", site: "South plant" }, { code: "M2162", family: "CNC lathe", line: "Line 2", site: "South plant" },
                { code: "M3210", family: "5-axis mill", line: "Line 3", site: "North plant" }, { code: "M3215", family: "5-axis mill", line: "Line 3", site: "North plant" },
                { code: "M5010", family: "gantry mill", line: "Line 5", site: "East plant" }, { code: "M5011", family: "gantry mill", line: "Line 5", site: "East plant" },
                { code: "M7301", family: "assembly bench", line: "Line 7", site: "North plant" }, { code: "M7302", family: "assembly bench", line: "Line 7", site: "North plant" },
                { code: "M7305", family: "assembly bench", line: "Line 7", site: "North plant" }, { code: "M7310", family: "assembly bench", line: "Line 7", site: "West plant" },
                { code: "M7311", family: "assembly bench", line: "Line 7", site: "West plant" }, { code: "M7320", family: "assembly bench", line: "Line 7", site: "West plant" },
                { code: "M7322", family: "assembly bench", line: "Line 7", site: "West plant" }, { code: "M8001", family: "test rig", line: "Line 8", site: "East plant" },
            ], ArrayType(MachineType));
            const lines = $.const([
                { code: "L2", name: "Line 2", machines: 96n, aliases: ["line 2", "l2", "the 2 line"] },
                { code: "L1", name: "Line 1", machines: 24n, aliases: ["line 1", "l1"] },
                { code: "L3", name: "Line 3", machines: 40n, aliases: ["line 3", "l3"] },
                { code: "L5", name: "Line 5", machines: 18n, aliases: ["line 5", "l5"] },
                { code: "L7", name: "Line 7", machines: 72n, aliases: ["line 7", "l7"] },
                { code: "L8", name: "Line 8", machines: 12n, aliases: ["line 8", "l8"] },
                { code: "CA", name: "Cell A", machines: 150n, aliases: ["cell a", "a cell", "the a cell"] },
                { code: "GIN", name: "Goods in", machines: 36n, aliases: ["goods in", "inbound"] },
                { code: "FH1", name: "Finishing hall", machines: 64n, aliases: ["finishing", "finishing hall"] },
                { code: "PKL", name: "Pack line", machines: 20n, aliases: ["pack", "packing"] },
                { code: "TB", name: "Test bay", machines: 9n, aliases: ["test bay", "the test bay", "bay"] },
            ], ArrayType(LineType));
            // A countable-by-attribute kind: the machine family — a count of a kind, resolved to machines later.
            const families = $.const([
                { name: "CNC lathe", aliases: ["lathe", "lathes", "cnc"] },
                { name: "5-axis mill", aliases: ["mill", "mills", "5 axis", "5axis"] },
                { name: "120 t press", aliases: ["press", "presses", "120t", "120 t"] },
                { name: "assembly bench", aliases: ["bench", "benches"] },
                { name: "gantry mill", aliases: ["gantry"] },
                { name: "test rig", aliases: ["rig", "rigs"] },
            ], ArrayType(FamilyType));
            const sites = $.const(["North plant", "South plant", "East plant", "West plant", "Central store", "River depot", "Harbour bay", "Hill site"], ArrayType(StringType));
            const statuses = $.const([
                { word: "PLANNED", tone: variant("neutral", null) }, { word: "RELEASED", tone: variant("info", null) },
                { word: "IN PROGRESS", tone: variant("warning", null) }, { word: "COMPLETE", tone: variant("success", null) },
                { word: "CANCELLED", tone: variant("danger", null) },
            ], ArrayType(StatusType));
            const machineSites = $.const(machines.toDict((_$, m) => m.code, (_$, m) => m.site), DictType(StringType, StringType));

            // The plan's rows, read from an e3 record bound with its patch door —
            // Apply commits the drafts to them.
            const plans = $.let(Record.bind(sheetPlanPlans, [sheetPlanPlansPatch]));
            const onApply = $.const(Record.onApply(plans, {
                entry: "q3",
                get: East.function([ProductionPlan], ArrayType(PlanRow), (_$, held) => held.rows),
                set: East.function([ProductionPlan, ArrayType(PlanRow)], ProductionPlan, (_$, _held, next) => ({ rows: next })),
                idField: "id",
            }));
            const views = $.let(State.bind([ArrayType(Sheet.Types.View)], "sheet_plan_views", []));
            const rows = $.let(plans.read().get("q3").rows);

            // The slice — search runs THROUGH it; the sheet draws the narrowing as a lens (§3.8).
            // A Link is searched by its display form (`M2140 > 4 x CNC lathe`), never its `.east` text.
            const cfg = $.const(Slice.config(PlanRow, {
                fields: { activity: { label: "Activity" }, notes: { label: "Notes" }, status: { label: "Status" },
                          stations: { label: "Work centres", text: r => Sheet.link.print(r.stations) } },
                searchFieldIds: ["activity", "notes", "stations"],
            }));
            const slice = $.let(Slice.bind([PlanRow], "sheet_plan_slice", cfg, Slice.state(), rows, none));

            // The arity rule (§3.4) — how many machines the To half should hold, from the quantity.
            const impliedStations = $.const(East.function([Ctx], OptionType(Sheet.Types.Counted), ($, ctx) => {
                const noCount = $.const(none, OptionType(Sheet.Types.Counted));
                $.if(ctx.row.qty.hasTag("value").not(), ($) => { $.return(noCount); });
                const supplied = $.const(ctx.row.qty.unwrap("value"));
                $.if(supplied.hasTag("some").not(), ($) => { $.return(noCount); });
                const qty = $.const(supplied.unwrap("some"));
                const piecesPerMachine = $.const(300.0);
                // ⌈qty ÷ 300⌉ and round(qty) by hand — `toInteger` refuses a fraction.
                const share = $.let(qty.divide(piecesPerMachine));
                const frac = $.let(share.remainder(1.0));
                const needed = $.let(frac.equal(0.0).ifElse((_$) => share, (_$) => share.subtract(frac).add(1.0)).toInteger());
                const half = $.let(qty.add(0.5));
                const whole = $.let(half.subtract(half.remainder(1.0)).toInteger());
                return ctx.driver.match({
                    none: (_$) => noCount,
                    some: (_$, d) => d.uom.equal("lots").ifElse(
                        (_$2) => East.value(some({ n: whole, key: "CNC lathe" }), OptionType(Sheet.Types.Counted)),      // one lot per machine
                        (_$2) => d.uom.equal("pcs").or(() => d.uom.equal("units")).ifElse(
                            (_$3) => qty.greater(0.0).ifElse(
                                (_$4) => East.value(some({ n: needed, key: "CNC lathe" }), OptionType(Sheet.Types.Counted)),
                                (_$4) => noCount),
                            (_$3) => noCount)),                                                                       // hours, cartons, pallets name no machines
                });
            }));
            // A member check — a machine named on a half must sit at that half's site.
            const CheckCtx = Sheet.Types.CheckContext(PlanRow);
            const siteMatches = $.const(East.function([CheckCtx], OptionType(StringType), ($, c) => {
                const noFlag = $.const(none, OptionType(StringType));
                const site = $.let(c.half.match({ from: (_$) => c.row.fromSite, to: (_$) => c.row.toSite }));
                return site.hasTag("value").ifElse(() => c.member.match({
                    identified: (_$, m) => site.unwrap("value").equal("").not()
                        .and(() => machineSites.has(m.key))
                        .and(() => machineSites.get(m.key).equal(site.unwrap("value")).not())
                        .ifElse((_$2) => East.value(some(East.str`${m.key} is not at ${site.unwrap("value")}`), OptionType(StringType)), (_$2) => noFlag),
                }, (_$) => noFlag), () => noFlag);
            }));

            // The fills (§3.5) — derive, history, sequence, default, phrase, capacity — as author functions.
            const DateFill = OptionType(Sheet.Types.Fill(DateTimeType));
            const FloatFill = OptionType(Sheet.Types.Fill(FloatType));
            const TextFill = OptionType(Sheet.Types.Fill(StringType));
            const LinkFill = OptionType(Sheet.Types.Fill(Sheet.Types.Link));
            const endFromStart = $.const(East.function([Ctx], DateFill, ($, ctx) => {
                const noFill = $.const(none, DateFill);
                return ctx.row.start.match({
                    value: (_$, supplied) => supplied.match({
                        none: () => noFill,
                        some: (_$, start) => ctx.driver.match({
                            none: () => noFill,
                            some: (_$, d) => some({ value: start.addDays(d.days), meta: East.str`+${d.days}d · ${d.name}` }),
                        }),
                    }),
                }, () => noFill);
            }));
            const lastSimilar = $.const(East.function([Ctx], OptionType(Sheet.Types.Draft(PlanRow)), ($, ctx) => {
                const noRow = $.const(none, OptionType(Sheet.Types.Draft(PlanRow)));
                return ctx.row.activity.match({
                    value: ($, activity) => {
                        const similar = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) =>
                            r.activity.hasTag("value").and(() => r.activity.unwrap("value").equal(activity))));
                        return similar.size().equal(0n).ifElse(() => noRow, () => some(similar.get(similar.size().subtract(1n))));
                    },
                }, () => noRow);
            }));
            const lastQuantity = $.const(East.function([Ctx], FloatFill, ($, ctx) => {
                const noFill = $.const(none, FloatFill);
                return ctx.row.activity.match({
                    value: ($, activity) => {
                        const similar = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) =>
                            r.activity.hasTag("value").and(() => r.activity.unwrap("value").equal(activity))
                                .and(() => r.qty.hasTag("value")).and(() => r.qty.unwrap("value").hasTag("some"))));
                        return similar.size().equal(0n).ifElse(() => noFill, ($) => {
                            const row = $.let(similar.get(similar.size().subtract(1n)));
                            return some({ value: row.qty.unwrap("value").unwrap("some"), meta: "last supplied quantity for this activity" });
                        });
                    },
                }, () => noFill);
            }));
            const lastStations = $.const(East.function([Ctx], LinkFill, ($, ctx) => {
                const noFill = $.const(none, LinkFill);
                const similar = $.const(lastSimilar);
                return similar(ctx).match({
                    none: () => noFill,
                    some: (_$, r) => r.stations.match({
                        value: (_$, stations) => stations.from.size().add(stations.to.size()).equal(0n).ifElse(
                            () => noFill, () => some({ value: stations, meta: "same stations as the last similar row" })),
                    }, () => noFill),
                });
            }));
            const nextSlot = $.const(East.function([Ctx], DateFill, ($, ctx) => {
                const dated = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) => r.start.hasTag("value").and(() => r.start.unwrap("value").hasTag("some"))));
                return dated.length().greater(0n).ifElse(
                    ($2) => {
                        const last = $2.let(dated.get(dated.length().subtract(1n)));
                        return East.value(some({ value: last.start.unwrap("value").unwrap("some").addDays(7n), meta: East.str`week after ${last.id.match({ value: (_$, id) => id }, () => "previous row")}` }), DateFill);
                    },
                    ($2) => {
                        const daysToMonday = $2.let(East.value(8n, IntegerType).subtract(ctx.today.getDayOfWeek()).remainder(7n));
                        const monday = $2.let(ctx.today.addDays(daysToMonday.equal(0n).ifElse((_$) => 7n, (_$) => daysToMonday)));
                        return East.value(some({ value: monday, meta: "next Monday" }), DateFill);
                    });
            }));
            const shiftQuantity = $.const(East.function([Ctx], FloatFill, ($, ctx) => {
                const noFill = $.const(none, FloatFill);
                return ctx.driver.match({
                    none: (_$) => noFill,
                    some: (_$, d) => East.value(some({ value: d.rate.multiply(8.0), meta: East.str`${d.rate}/h × 8 h` }), FloatFill),
                });
            }));
            const phrase = $.const(East.function([Ctx], TextFill, ($, ctx) => {
                const noFill = $.const(none, TextFill);
                return ctx.row.activity.hasTag("value").and(() => ctx.row.qty.hasTag("value"))
                    .and(() => ctx.row.qty.unwrap("value").hasTag("some")).ifElse(($) => {
                        const activity = $.const(ctx.row.activity.unwrap("value"));
                        const qty = $.const(ctx.row.qty.unwrap("value").unwrap("some"));
                        return activity.startsWith("Machining").ifElse(
                            () => some({ value: East.str`Machine ${qty} P-40 blanks`, meta: "phrasing from supplied activity and quantity" }),
                            () => activity.startsWith("Painting").ifElse(
                                () => some({ value: East.str`Paint ${qty} P-40 housings`, meta: "phrasing from supplied activity and quantity" }), () => noFill));
                    }, () => noFill);
            }));
            const countedByQuantity = $.const(East.function([Ctx], LinkFill, ($, ctx) => {
                const noFill = $.const(none, LinkFill);
                const noMembers = $.const([], ArrayType(Sheet.Types.Member));
                const implied = $.const(impliedStations);
                return implied(ctx).match({
                    none: (_$) => noFill,
                    some: (_$, c) => East.value(some({ value: { from: noMembers, to: [variant("counted", { n: c.n, key: c.key })] }, meta: "capacity · from the quantity" }), LinkFill),
                });
            }));

            // The proposers (§3.6) — a domain pattern, a learned follower, and an ASYNC model call.
            const roughingFollowUps = $.const(East.function([Ctx], Proposals, ($, ctx) => {
                const empty = $.const([], Proposals);
                return ctx.row.activity.hasTag("value")
                    .and(() => ctx.row.activity.unwrap("value").equal("Machining - Roughing"))
                    .and(() => ctx.row.end.hasTag("value"))
                    .and(() => ctx.row.end.unwrap("value").hasTag("some")).ifElse(($) => {
                        const end = $.const(ctx.row.end.unwrap("value").unwrap("some"));
                        return $.const([
                            { patch: Sheet.patch(PlanRow, { activity: "Inspection", start: some(end), end: some(end), qty: some(4.0), notes: "Inspect 4 lots" }), meta: "inspection at the supplied end" },
                            { patch: Sheet.patch(PlanRow, { activity: "Machining", start: some(end.addDays(3n)), end: some(end.addDays(7n)), notes: "Finish the roughed blanks" }), meta: "finishing · end +3…+7 d" },
                        ], Proposals);
                    }, () => empty);
            }));
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
                            return $.const([{ patch: Sheet.patch(PlanRow, { activity: next.activity.unwrap("value"), start: some(start.addMilliseconds(gap)) }),
                                meta: "follower learned from supplied activities and dates" }], Proposals);
                        });
                    }, () => empty);
            }));
            const modelProposals = $.const(East.asyncFunction([Ctx], Proposals, ($, ctx) => {
                const result = $.let([], Proposals);
                $.try(($) => { $.assign(result, planRecommend(ctx)); }).catch(($, message) => {
                    // The standalone showcase has no model backend. Other failures
                    // still reach the Sheet's provider diagnostic.
                    $.if(message.notEqual("Platform function 'sheet_plan_recommend' is not available"), ($) => { $.error(message); });
                });
                return result;
            }));

            const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(PlanRow), () => Sheet.patch(PlanRow, {
                notes: "", stations: { from: [], to: [] }, fromSite: "", toSite: "", orderCode: "", status: "PLANNED",
            })));
            const planned = $.let(rows.filter((_$, r) => r.activity.length().greater(0n)).length());

            return (
                <Sheet.View
                    data={rows}
                    id="id"
                    owned={r => r.orderCode.length().greater(0n).or(() => r.status.equal("CANCELLED"))}
                    driver={Sheet.driver("activity", activities, { key: a => a.name, label: a => a.name })}
                    registers={{
                        stations: Sheet.register.concat([
                            Sheet.register.members(machines, { kind: "machine", key: m => m.code, label: m => m.code,
                                meta: m => some(m.family), parent: m => some(m.line) }),
                            Sheet.register.members(lines, { kind: "line", key: l => l.name, label: l => l.name,
                                aliases: l => l.aliases, meta: l => some(East.str`line · ${l.machines}`) }),
                            // The countable-by-attribute kind: a family names a count of machines, resolved to codes later.
                            Sheet.register.members(families, { kind: "family", key: f => f.name, label: f => f.name,
                                aliases: f => f.aliases, meta: _f => some("family") }),
                        ]),
                        sites:    Sheet.register.members(sites, { kind: "site", key: s => s, label: s => s }),
                        statuses: Sheet.register.members(statuses, { kind: "status", key: s => s.word, label: s => s.word, tone: s => some(s.tone) }),
                    }}
                    columns={{
                        start:     Sheet.column.date(PlanRow, { header: "Start", sub: "dd / mm / yyyy", width: "96px", fill: [nextSlot] }),
                        end:       Sheet.column.date(PlanRow, { header: "End", sub: "4d = start+4", width: "96px", base: "start", fill: [endFromStart] }),
                        activity:  Sheet.column.lookup(PlanRow, { header: "Activity", sub: "activity register", width: "214px" }),
                        qty:       Sheet.column.quantity(PlanRow, PlanActivity, {
                                       header: "Qty", sub: "uom per activity", width: "112px", uom: d => d.uom,
                                       format: Format.Number({ maximumFractionDigits: 0n }), fill: [lastQuantity, shiftQuantity] }),
                        notes:     Sheet.column.text(PlanRow, { header: "Notes", sub: "free text", width: "250px", fill: [phrase] }),
                        stations:  Sheet.column.link(PlanRow, PlanActivity, "stations", {
                                       header: "Work centres", sub: "from → to · 4 x lathe · machine · line", width: "352px",
                                       members: [{ kind: "machine", identified: true }, { kind: "range", identified: true },
                                                 { kind: "line", countable: true, resolvesTo: "machine" },
                                                 { kind: "family", countable: true, resolvesTo: "machine" }],
                                       multiple: { forms: ["N x kind", "kind x N"], ops: ["x", "X", "*", "×"], appliesTo: "countable" },
                                       sides: { value: d => d.sides, locks: { from: { to: "external", in: "in place" }, to: { from: "external" } } },
                                       arity: Sheet.link.arity("to", impliedStations),
                                       check: [Sheet.link.check.exists(), siteMatches],
                                       fill: [lastStations, countedByQuantity] }),
                        setups:    Sheet.column.integer(PlanRow, { header: "Setups", sub: "n", width: "64px" }),
                        fromSite:  Sheet.column.reference(PlanRow, "sites", { header: "From site", sub: "site register", width: "112px" }),
                        toSite:    Sheet.column.reference(PlanRow, "sites", { header: "To site", sub: "site register", width: "112px" }),
                        orderCode: Sheet.column.stamped(PlanRow, { header: "Order code", sub: "stamped on release", owner: "ERP", width: "104px" }),
                        status:    Sheet.column.enum(PlanRow, "statuses", { header: "Status", sub: "erp", width: "124px" }),
                    }}
                    suggest={{ ahead: 2n, triggers: ["activity", "start", "end", "qty", "notes", "stations"],
                               propose: [roughingFollowUps, modelProposals, lastFollower] }}
                    slice={slice} affordances={["search", "filter"]}
                    views={views.read()} onViewsChange={views.write}
                    newRow={newRow}
                    onApply={onApply}
                    footer={[{ text: East.str`${planned} planned` }]}
                    style={{ height: "fill" }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetCopilot — the copilot in isolation
// ============================================================================

/** The plans — the copilot's sheet edits the week's rows. */
export const sheetCopilotPlans = e3.record("sheet_copilot_plans", DictType(StringType, ProductionPlan), new Map([
    ["week", { rows: [
        { id: "1", start: some(new Date("2026-02-16T00:00:00Z")), end: some(new Date("2026-02-20T00:00:00Z")), activity: "Machining - Roughing", qty: some(1200.0), notes: "Rough the P-40 blanks", stations: { from: [], to: [] }, setups: none, fromSite: "", toSite: "", orderCode: "", status: "PLANNED" },
        { id: "2", start: some(new Date("2026-02-16T00:00:00Z")), end: some(new Date("2026-02-20T00:00:00Z")), activity: "Inspection", qty: some(4.0), notes: "Inspect the 4 lots", stations: { from: [], to: [] }, setups: none, fromSite: "", toSite: "", orderCode: "", status: "PLANNED" },
        { id: "3", start: some(new Date("2026-03-09T00:00:00Z")), end: none, activity: "Painting", qty: some(250.0), notes: "", stations: { from: [], to: [] }, setups: none, fromSite: "", toSite: "", orderCode: "", status: "PLANNED" },
    ] }],
]));
/** The record's patch door — every Apply commits through it. */
export const sheetCopilotPlansPatch = e3.mutation.patch(sheetCopilotPlans);

/**
 * The copilot in isolation (§3.5–§3.6) — the prototype's rules as author
 * functions: derive (End from Start + the driver's days), history (the last
 * similar row's quantity), sequence (a week after the last dated row), default
 * (eight hours at the driver's rate), a domain pattern proposer, a learned
 * follower, and an ASYNC proposer behind a platform function; every take
 * logs its provenance through `onPatch`. The rows are an e3 record's, and
 * Apply commits to it.
 */
export const sheetCopilot = example({
    keywords: ["Sheet", "Root", "copilot", "fill", "provider", "propose", "proposer", "suggest", "derive", "history", "sequence", "default", "learned", "follower", "asyncFunction", "asyncPlatform", "pending", "latest wins", "provenance", "onPatch", "source", "Context", "Fill", "Patch", "Proposal", "onApply", "Record", "Record.onApply", "e3.record", "bound", "Reactive", "State"],
    description: "The copilot in isolation — derive, history, sequence and default fills, a pattern proposer, a learned follower and an async model proposer, all author East functions over the typed context, over rows an e3 record holds; takes log their provenance",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const Ctx = Sheet.Types.DraftContext(PlanRow, PlanActivity);
            const Proposals = ArrayType(Sheet.Types.Proposal(PlanRow));
            const activities = $.const([
                { name: "Machining", uom: "pcs", rate: 60.0, fte: 2n, days: 4n, sides: variant("both", null) },
                { name: "Machining - Roughing", uom: "pcs", rate: 80.0, fte: 2n, days: 4n, sides: variant("both", null) },
                { name: "Painting", uom: "pcs", rate: 50.0, fte: 3n, days: 4n, sides: variant("both", null) },
                { name: "Inspection", uom: "lots", rate: 4.0, fte: 2n, days: 4n, sides: variant("in", null) },
                { name: "Packaging", uom: "cartons", rate: 120.0, fte: 1n, days: 3n, sides: variant("both", null) },
            ], ArrayType(PlanActivity));
            // The rows, read from an e3 record bound with its patch door.
            const plans = $.let(Record.bind(sheetCopilotPlans, [sheetCopilotPlansPatch]));
            const rows = $.let(plans.read().get("week").rows);
            const onApply = $.const(Record.onApply(plans, {
                entry: "week",
                get: East.function([ProductionPlan], ArrayType(PlanRow), (_$, held) => held.rows),
                set: East.function([ProductionPlan, ArrayType(PlanRow)], ProductionPlan, (_$, _held, next) => ({ rows: next })),
                idField: "id",
            }));
            const log = $.let(State.bind([ArrayType(StringType)], "sheet_copilot_log", []));

            const DateFill = OptionType(Sheet.Types.Fill(DateTimeType));
            const FloatFill = OptionType(Sheet.Types.Fill(FloatType));
            // derive — End = Start + the driver's days.
            const endFromStart = $.const(East.function([Ctx], DateFill, ($, ctx) => {
                const noFill = $.const(none, DateFill);
                return ctx.row.start.match({
                    value: (_$, supplied) => supplied.match({
                        none: () => noFill,
                        some: (_$, start) => ctx.driver.match({
                            none: () => noFill,
                            some: (_$, d) => some({ value: start.addDays(d.days), meta: East.str`+${d.days}d · ${d.name}` }),
                        }),
                    }),
                }, () => noFill);
            }));
            // history — the last row above with this activity.
            const lastQuantity = $.const(East.function([Ctx], FloatFill, ($, ctx) => {
                const noFill = $.const(none, FloatFill);
                return ctx.row.activity.match({
                    value: ($, activity) => {
                        const similar = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) =>
                            r.activity.hasTag("value").and(() => r.activity.unwrap("value").equal(activity))
                                .and(() => r.qty.hasTag("value")).and(() => r.qty.unwrap("value").hasTag("some"))));
                        return similar.size().equal(0n).ifElse(() => noFill, ($) => {
                            const row = $.let(similar.get(similar.size().subtract(1n)));
                            return some({ value: row.qty.unwrap("value").unwrap("some"), meta: "last supplied quantity for this activity" });
                        });
                    },
                }, () => noFill);
            }));
            // sequence — a week after the nearest dated row above; else next Monday.
            const nextSlot = $.const(East.function([Ctx], DateFill, ($, ctx) => {
                const dated = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) => r.start.hasTag("value").and(() => r.start.unwrap("value").hasTag("some"))));
                return dated.length().greater(0n).ifElse(
                    ($2) => {
                        const last = $2.let(dated.get(dated.length().subtract(1n)));
                        return East.value(some({ value: last.start.unwrap("value").unwrap("some").addDays(7n), meta: East.str`week after ${last.id.match({ value: (_$, id) => id }, () => "previous row")}` }), DateFill);
                    },
                    ($2) => {
                        const daysToMonday = $2.let(East.value(8n, IntegerType).subtract(ctx.today.getDayOfWeek()).remainder(7n));
                        const monday = $2.let(ctx.today.addDays(daysToMonday.equal(0n).ifElse((_$) => 7n, (_$) => daysToMonday)));
                        return East.value(some({ value: monday, meta: "next Monday" }), DateFill);
                    });
            }));
            // default — eight hours at the driver's rate when nothing similar exists.
            const shiftQuantity = $.const(East.function([Ctx], FloatFill, ($, ctx) => {
                const noFill = $.const(none, FloatFill);
                return ctx.driver.match({
                    none: (_$) => noFill,
                    some: (_$, d) => East.value(some({ value: d.rate.multiply(8.0), meta: East.str`${d.rate}/h × 8 h` }), FloatFill),
                });
            }));
            // A domain pattern — a roughing run is followed by an inspection and a finishing run.
            const roughingFollowUps = $.const(East.function([Ctx], Proposals, ($, ctx) => {
                const empty = $.const([], Proposals);
                return ctx.row.activity.hasTag("value")
                    .and(() => ctx.row.activity.unwrap("value").equal("Machining - Roughing"))
                    .and(() => ctx.row.end.hasTag("value"))
                    .and(() => ctx.row.end.unwrap("value").hasTag("some")).ifElse(($) => {
                        const end = $.const(ctx.row.end.unwrap("value").unwrap("some"));
                        return $.const([
                            { patch: Sheet.patch(PlanRow, { activity: "Inspection", start: some(end), end: some(end), qty: some(4.0), notes: "Inspect 4 lots" }), meta: "inspection at the supplied end" },
                            { patch: Sheet.patch(PlanRow, { activity: "Machining", start: some(end.addDays(3n)), end: some(end.addDays(7n)), notes: "Finish the roughed blanks" }), meta: "finishing · end +3…+7 d" },
                        ], Proposals);
                    }, () => empty);
            }));
            // Learned from the sheet — what followed this activity last time, after how long.
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
                            return $.const([{ patch: Sheet.patch(PlanRow, { activity: next.activity.unwrap("value"), start: some(start.addMilliseconds(gap)) }),
                                meta: "follower learned from supplied activities and dates" }], Proposals);
                        });
                    }, () => empty);
            }));
            // A model — an ASYNC proposer; the strip shows a pending chip and a newer context cancels the wait.
            const modelProposals = $.const(East.asyncFunction([Ctx], Proposals, ($, ctx) => {
                const result = $.let([], Proposals);
                $.try(($) => { $.assign(result, planRecommend(ctx)); }).catch(($, message) => {
                    // The standalone showcase has no model backend. Other failures
                    // still reach the Sheet's provider diagnostic.
                    $.if(message.notEqual("Platform function 'sheet_plan_recommend' is not available"), ($) => { $.error(message); });
                });
                return result;
            }));

            // Every gesture logs once, including incomplete drafts and undo.
            const onPatch = $.const(East.function([Sheet.Types.PatchEvent(PlanRow)], NullType, ($, e) => {
                $(log.write(log.read().concat([East.str`${e.origin.getTag()} · ${e.label} · ${e.draftChanges.length()} entries`])));
            }));
            const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(PlanRow), () => Sheet.patch(PlanRow, {
                notes: "", stations: { from: [], to: [] }, fromSite: "", toSite: "", orderCode: "", status: "PLANNED",
            })));
            const entries = $.let(log.read());

            return (
                <VStack gap="3" align="stretch">
                    <Sheet.View
                        data={rows}
                        id="id"
                        driver={Sheet.driver("activity", activities, { key: a => a.name, label: a => a.name })}
                        columns={{
                            start:    Sheet.column.date(PlanRow, { header: "Start", sub: "sequence", width: "96px", fill: [nextSlot] }),
                            end:      Sheet.column.date(PlanRow, { header: "End", sub: "derive", width: "96px", base: "start", fill: [endFromStart] }),
                            activity: Sheet.column.lookup(PlanRow, { header: "Activity", sub: "activity register", width: "214px" }),
                            qty:      Sheet.column.quantity(PlanRow, PlanActivity, { header: "Qty", sub: "history · default", width: "112px", uom: d => d.uom, fill: [lastQuantity, shiftQuantity] }),
                            notes:    Sheet.column.text(PlanRow, { header: "Notes", width: "260px" }),
                        }}
                        suggest={{ ahead: 2n, triggers: ["activity", "start", "end", "qty"], propose: [roughingFollowUps, modelProposals, lastFollower] }}
                        onPatch={onPatch}
                        newRow={newRow}
                        onApply={onApply}
                        style={{ height: "420px" }}
                    />
                    <Text.MonoLabel>{East.str`COPILOT LOG · ${entries.length()} edits · ${entries.filter((_$, l) => l.startsWith("typed").not()).length()} from the copilot`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetLens — the lens over a narrowing
// ============================================================================

/** A job on the lens's sheet — its start, activity, notes, work centres (a
 *  machine by code, or a count of a family), status and quantity. */
export const LensJob = StructType({ id: StringType, start: OptionType(DateTimeType), activity: StringType, notes: StringType, stations: Sheet.Types.Link, status: StringType, qty: OptionType(FloatType) });

/** How many jobs the lens's sheet holds — a small authored constant;
 *  {@link sheetLensJobs} makes the rows. */
export const sheetLensJobCount = e3.input("sheet_lens_job_count", IntegerType, variant("value", 60n));

/**
 * The jobs, generated from their count — three days apart from 2 February,
 * the activities in turn: every fifth a machining run naming a count of
 * lathes, the rest a machine by code, and every seventh urgent.
 */
export const generateLensJobs = East.function([IntegerType], ArrayType(LensJob), ($, count) => {
    const activities = $.const(["Machining", "Painting", "Packaging", "Changeover", "Maintenance"], ArrayType(StringType));
    const words = $.const(["PLANNED", "RELEASED", "COMPLETE"], ArrayType(StringType));
    const codes = $.const(["M2140", "M2141", "M2145", "M3210", "M7301"], ArrayType(StringType));
    const first = $.const(new Date("2026-02-02T00:00:00Z"), DateTimeType);
    const noMembers = $.const([], ArrayType(Sheet.Types.Member));
    return East.Array.generate(count, LensJob, (_$, i) => ({
        id: East.str`j${i}`,
        start: some(first.addDays(i.multiply(3n))),
        activity: activities.get(i.remainder(5n)),
        notes: i.remainder(7n).equal(0n).ifElse((_$2) => "urgent — inspect before shipping", (_$2) => East.str`lot ${i.add(100n)}`),
        // Machining runs name a count of lathes; the rest a machine by code.
        stations: i.remainder(5n).equal(0n).ifElse(
            (_$2) => East.value({ from: noMembers, to: [variant("counted", { n: i.remainder(3n).add(2n), key: "CNC lathe" })] }, Sheet.Types.Link),
            (_$2) => East.value({ from: noMembers, to: [variant("identified", { key: codes.get(i.remainder(5n)) })] }, Sheet.Types.Link)),
        status: words.get(i.remainder(3n)),
        qty: some(i.multiply(40n).toFloat().add(180.0)),
    }));
});

/** The task that generates the jobs — its output is what the lens's sheet reads. */
export const sheetLensJobs = e3.task("sheet_lens_jobs", [sheetLensJobCount], generateLensJobs);

/**
 * The lens (§3.8) — search and filter run through the bound slice; the sheet
 * never narrows, it draws non-matching rows as collapsed context bands
 * while hits keep their row numbers; a Link column is searched through its
 * display form (`text: r => Sheet.link.print(r.stations)`); views are
 * slice-state snapshots evaluated live, with their context and reveals. The
 * sixty jobs are an e3 task's output, made from their count; the views are
 * the viewer's own.
 */
export const sheetLens = example({
    keywords: ["Sheet", "Root", "slice", "search", "filter", "lens", "bands", "context", "reveal", "views", "onViewsChange", "activeView", "text", "Sheet.link.print", "set", "Slice", "config", "bind", "state", "Data.bind", "bound", "e3.task", "generated", "Reactive", "State"],
    description: "The lens — search and filter through the bound slice over sixty jobs an e3 task generates, drawn as context bands (hits keep their row numbers), a Link column searched through its display text, and saved views as slice-state snapshots with their context and reveals",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const MachineType = StructType({ code: StringType, family: StringType });
            // Sixty jobs an e3 task generates — enough for a narrowing to collapse into bands.
            const jobs = $.let(Data.bind(sheetLensJobs));
            const machines = $.const([
                { code: "M2140", family: "CNC lathe" }, { code: "M2141", family: "CNC lathe" }, { code: "M2145", family: "CNC lathe" },
                { code: "M3210", family: "5-axis mill" }, { code: "M7301", family: "assembly bench" },
            ], ArrayType(MachineType));
            // The Link is searched through its display form — `3 x CNC lathe`, `M7301` — not its `.east` text.
            const cfg = $.const(Slice.config(LensJob, {
                fields: {
                    activity: { label: "Activity", hints: ["Machining", "Painting", "Packaging", "Changeover", "Maintenance"] },
                    notes:    { label: "Notes" },
                    stations: { label: "Work centres", text: r => Sheet.link.print(r.stations) },
                    status:   { label: "Status" },
                },
                searchFieldIds: ["activity", "notes", "stations"],
            }));
            const slice = $.let(Slice.bind([LensJob], "sheet_lens_slice", cfg, Slice.state(), jobs.read(), none));
            const views = $.let(State.bind([ArrayType(Sheet.Types.View)], "sheet_lens_views", [
                { id: "painting", name: "PAINTING", narrowing: Slice.state({ search: some("painting") }), context: 1n, reveals: [], folds: new Map() },
                { id: "lathes", name: "LATHES", narrowing: Slice.state({ search: some("lathe") }), context: 0n, reveals: [], folds: new Map() },
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
                        start:    Sheet.column.date(LensJob, { header: "Start", width: "96px" }),
                        activity: Sheet.column.text(LensJob, { header: "Activity", width: "160px" }),
                        notes:    Sheet.column.text(LensJob, { header: "Notes", sub: "free text", width: "240px" }),
                        stations: Sheet.column.set(LensJob, "stations", { header: "Work centres", sub: "3 x lathe · machine", width: "220px",
                                      members: [{ kind: "machine", identified: true }, { kind: "family", countable: true, resolvesTo: "machine" }] }),
                        status:   Sheet.column.text(LensJob, { header: "Status", width: "120px" }),
                        qty:      Sheet.column.quantity(LensJob, { header: "Qty", width: "112px", format: Format.Number({ maximumFractionDigits: 0n }) }),
                    }}
                    slice={slice} affordances={["search", "filter"]}
                    views={views.read()} onViewsChange={views.write} activeView={some("painting")}
                    style={{ height: "420px" }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetWriteBack — one journal entry per gesture, one commit per Apply
// ============================================================================

/** A job — its task, quantity, and who made it (no column: `newRow` supplies it). */
export const WriteBackJob = StructType({ id: StringType, task: StringType, qty: OptionType(FloatType), createdBy: StringType });
/** A plan — its jobs, in the planner's order. */
export const WriteBackPlan = StructType({ jobs: ArrayType(WriteBackJob) });
/** The plans — the sheet edits the week's jobs. */
export const sheetWriteBackPlans = e3.record("sheet_writeback_plans", DictType(StringType, WriteBackPlan), new Map([
    ["week", { jobs: [
        { id: "j1", task: "Machining", qty: some(1200.0), createdBy: "planner" },
        { id: "j2", task: "Painting", qty: none, createdBy: "planner" },
    ] }],
]));
/** The record's patch door — every Apply commits through it. */
export const sheetWriteBackPlansPatch = e3.mutation.patch(sheetWriteBackPlans);

/**
 * Write-back (§3.7) — onPatch journals one complete gesture, while Apply
 * commits the composed batch to an e3 record through its patch door, once.
 * The Sheet holds local drafts until Apply changes is pressed; the journal
 * and the id counter are the viewer's own.
 */
export const sheetWriteBack = example({
    keywords: ["Sheet", "Root", "onPatch", "onApply", "write-back", "commit", "insert", "remove", "source", "provenance", "PatchEvent", "staged", "newRowId", "Record", "Record.onApply", "e3.record", "patch", "bound", "Reactive", "State"],
    description: "Write-back — one onPatch event per gesture with provenance and readiness, beside an Apply committing the checked batch to an e3 record through its patch door",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The jobs, read from an e3 record bound with its patch door.
            const plans = $.let(Record.bind(sheetWriteBackPlans, [sheetWriteBackPlansPatch]));
            const jobs = $.let(plans.read().get("week").jobs);
            const onApply = $.const(Record.onApply(plans, {
                entry: "week",
                get: East.function([WriteBackPlan], ArrayType(WriteBackJob), (_$, held) => held.jobs),
                set: East.function([WriteBackPlan, ArrayType(WriteBackJob)], WriteBackPlan, (_$, _held, next) => ({ jobs: next })),
                idField: "id",
            }));
            const log = $.let(State.bind([ArrayType(StringType)], "sheet_writeback_log", []));
            const counter = $.let(State.bind([IntegerType], "sheet_writeback_counter", 3n));
            // Draft patches include hidden fields without inventing their values.
            // This observer journals gestures; Apply commits ready batches.
            const onPatch = $.const(East.function([Sheet.Types.PatchEvent(WriteBackJob)], NullType, ($, e) => {
                $(log.write(log.read().concat([East.str`${e.origin.getTag()} · ${e.label} · ${e.readiness.getTag()}`])));
            }));
            // The host mints ids for inserted rows.
            const newRowId = $.const(East.function([], StringType, ($) => {
                const n = $.let(counter.read());
                $(counter.write(n.add(1n)));
                return East.str`j${n}`;
            }));
            const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(WriteBackJob), () => Sheet.patch(WriteBackJob, { createdBy: "planner" })));
            const entries = $.let(log.read());
            return (
                <VStack gap="3" align="stretch">
                    <Sheet.View
                        data={jobs}
                        id="id"
                        columns={{
                            task: Sheet.column.text(WriteBackJob, { header: "Task", width: "200px" }),
                            qty:  Sheet.column.quantity(WriteBackJob, { header: "Qty", width: "112px" }),
                        }}
                        onPatch={onPatch}
                        onApply={onApply}
                        newRow={newRow}
                        newRowId={newRowId}
                        blanks={6n}
                    />
                    <Text.MonoLabel>{East.str`EDITS · ${entries.length()}`}</Text.MonoLabel>
                    {entries.map((_$, l) => <Text textStyle="caption" color="fg.muted">{l}</Text>)}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetGrouped — grouped editing
// ============================================================================

/** A job — a work package's line: its task, quantity, notes, and who made it (no column). */
export const GroupedJob = StructType({ task: StringType, qty: OptionType(FloatType), notes: StringType, createdBy: StringType });
/** A work package — its name, its owner (no column) and its jobs, in order. */
export const GroupedPackage = StructType({ id: StringType, name: StringType, owner: StringType, jobs: ArrayType(GroupedJob) });
/** A quarter's work — its packages, in the planner's order. */
export const GroupedWork = StructType({ packages: ArrayType(GroupedPackage) });
/** The work — the sheet edits Q3's packages. */
export const sheetGroupedWork = e3.record("sheet_grouped_work", DictType(StringType, GroupedWork), new Map([
    ["q3", { packages: [
        { id: "roughing", name: "P-40 · Roughing", owner: "planner", jobs: [
            { task: "Machine blanks", qty: some(1200.0), notes: "Four CNC lathes", createdBy: "planner" },
            { task: "Inspect lots", qty: some(4.0), notes: "Check before finishing", createdBy: "planner" },
        ] },
        { id: "finishing", name: "P-40 · Finishing", owner: "planner", jobs: [
            { task: "Finish housings", qty: some(1200.0), notes: "After inspection", createdBy: "planner" },
            { task: "Pack for assembly", qty: some(100.0), notes: "Twelve per carton", createdBy: "planner" },
        ] },
    ] }],
]));
/** The record's patch door — every Apply commits through it. */
export const sheetGroupedWorkPatch = e3.mutation.patch(sheetGroupedWork);

/**
 * Grouped editing — named work packages with ordered child rows. Explicit
 * constructors supply hidden metadata; the schema determines completeness.
 * The packages are an e3 record's, and Apply commits to it.
 */
export const sheetGrouped = example({
    keywords: ["Sheet", "group", "grouped", "children", "newGroup", "newRow", "Patch", "defaults", "completeness", "fold", "undo", "redo", "onApply", "Record", "Record.onApply", "e3.record", "bound", "Reactive"],
    description: "Grouped work packages — edit names and child rows, fold groups, create drafts with explicit defaults, then apply the batch to an e3 record or undo it",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The packages, read from an e3 record bound with its patch door.
            const work = $.let(Record.bind(sheetGroupedWork, [sheetGroupedWorkPatch]));
            const packages = $.let(work.read().get("q3").packages);
            const onApply = $.const(Record.onApply(work, {
                entry: "q3",
                get: East.function([GroupedWork], ArrayType(GroupedPackage), (_$, held) => held.packages),
                set: East.function([GroupedWork, ArrayType(GroupedPackage)], GroupedWork, (_$, _held, next) => ({ packages: next })),
                idField: "id",
            }));
            // A package needs a name before Apply.
            const readyGroup = $.const(East.function([Sheet.Types.DraftGroup(GroupedPackage, "jobs")], Sheet.Types.Readiness, ($, group) => {
                $.if(group.name.hasTag("value").and(() => group.name.unwrap("value").length().equal(0n)), $ => {
                    $.return(East.value(variant("incomplete", [{ field: "name", message: "Name the work package" }]), Sheet.Types.Readiness));
                });
                return East.value(variant("ready", null), Sheet.Types.Readiness);
            }));
            const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(GroupedJob), () => Sheet.patch(GroupedJob, {
                notes: "", createdBy: "planner",
            })));
            const newGroup = $.const(East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(GroupedPackage), () => Sheet.patch(GroupedPackage, {
                owner: "planner", jobs: [],
            })));
            return (
                <VStack gap="3" align="stretch">
                    <Text textStyle="caption" color="fg.muted">Edit a package name or task. Use the gutter + to insert a task, or the stacked-rows + button to create a package at a group boundary. Apply changes saves the batch; Undo and Redo retain each gesture.</Text>
                    <Sheet.View
                        data={packages}
                        id="id"
                        group={Sheet.group(GroupedPackage, "jobs", { title: "name" })}
                        ready={{ group: readyGroup }}
                        columns={{
                            task: Sheet.column.text(GroupedJob, { header: "Task", width: "240px" }),
                            qty: Sheet.column.quantity(GroupedJob, { header: "Qty", width: "112px" }),
                            notes: Sheet.column.text(GroupedJob, { header: "Notes", width: "300px" }),
                        }}
                        newRow={newRow}
                        newGroup={newGroup}
                        onApply={onApply}
                        style={{ height: "440px" }}
                    />
                    <Text.MonoLabel>{East.str`SAVED · ${packages.length()} packages · ${packages.map((_$, p) => p.jobs.length()).sum()} tasks`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetStress — two thousand rows
// ============================================================================

/** A job on the stress sheet — its start, task, quantity and notes. */
export const StressJob = StructType({ id: StringType, start: OptionType(DateTimeType), task: StringType, qty: OptionType(FloatType), notes: StringType });

/** How many jobs the stress sheet holds — a small authored constant;
 *  {@link sheetStressJobs} makes the rows. */
export const sheetStressJobCount = e3.input("sheet_stress_job_count", IntegerType, variant("value", 2000n));

/**
 * The jobs, generated from their count — four a day from 5 January, the
 * tasks in turn, every eleventh quantity blank.
 */
export const generateStressJobs = East.function([IntegerType], ArrayType(StressJob), ($, count) => {
    const tasks = $.const(["Machining", "Painting", "Packaging", "Changeover", "Maintenance", "Receiving", "Shipping"], ArrayType(StringType));
    const first = $.const(new Date("2026-01-05T00:00:00Z"), DateTimeType);
    const blank = $.const(none, OptionType(FloatType));
    return East.Array.generate(count, StressJob, (_$, i) => ({
        id: East.str`S${i}`,
        start: some(first.addDays(i.divide(4n))),
        task: tasks.get(i.remainder(7n)),
        qty: i.remainder(11n).equal(0n).ifElse((_$2) => blank, (_$2) => East.value(some(i.multiply(7n).toFloat().add(50.0)), OptionType(FloatType))),
        notes: "",
    }));
});

/** The task that generates the jobs — its output is what the stress sheet reads. */
export const sheetStressJobs = e3.task("sheet_stress_jobs", [sheetStressJobCount], generateStressJobs);

/**
 * Stress — two thousand rows an e3 task generates, every column virtualised.
 * The rows are made where data is made, from their count, so the sheet only
 * reads them: a task's output is not a record anything writes.
 */
export const sheetStress = example({
    keywords: ["Sheet", "Root", "stress", "virtualization", "2000", "rows", "performance", "readOnly", "Data.bind", "bound", "e3.task", "generated", "Reactive"],
    description: "Two thousand rows an e3 task generates, in one sheet — virtualised rows over typed columns, read only",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Two thousand jobs an e3 task generates — made where data is made.
            const jobs = $.let(Data.bind(sheetStressJobs));
            const count = $.let(jobs.read().length());
            return (
                <Sheet.View
                    data={jobs}
                    id="id"
                    columns={{
                        start: Sheet.column.date(StressJob, { header: "Start", width: "96px" }),
                        task:  Sheet.column.text(StressJob, { header: "Task", width: "160px" }),
                        qty:   Sheet.column.quantity(StressJob, { header: "Qty", width: "112px", format: Format.Number({ maximumFractionDigits: 0n }) }),
                        notes: Sheet.column.text(StressJob, { header: "Notes", width: "240px" }),
                    }}
                    readOnly
                    footer={[{ text: East.str`${count} rows · virtualised` }]}
                    style={{ height: "480px" }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetReadiness — completeness and a business rule
// ============================================================================

/** A job — its task, a whole quantity that must be positive, an optional note, and who made it (no column). */
export const ReadinessJob = StructType({ id: StringType, task: StringType, qty: IntegerType, note: OptionType(StringType), createdBy: StringType });
/** A plan — its jobs, in the planner's order. */
export const ReadinessPlan = StructType({ jobs: ArrayType(ReadinessJob) });
/** The plans — the sheet edits the week's jobs. */
export const sheetReadinessPlans = e3.record("sheet_readiness_plans", DictType(StringType, ReadinessPlan), new Map([
    ["week", { jobs: [
        { id: "inspection", task: "Inspect lots", qty: 4n, note: none, createdBy: "planner" },
    ] }],
]));
/** The record's patch door — every Apply commits through it. */
export const sheetReadinessPlansPatch = e3.mutation.patch(sheetReadinessPlans);

/** Schema completeness plus an optional business rule, evaluated on typed drafts, over jobs an e3 record holds. */
export const sheetReadiness = example({
    keywords: ["Sheet", "ready", "row", "Readiness", "Draft", "DraftContext", "completeness", "validation", "Apply", "onApply", "Record", "Record.onApply", "e3.record", "bound", "Reactive"],
    description: "Draft readiness — quantities must be positive before Apply; missing required values and invalid text are checked automatically",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The jobs, read from an e3 record bound with its patch door.
            const plans = $.let(Record.bind(sheetReadinessPlans, [sheetReadinessPlansPatch]));
            const jobs = $.let(plans.read().get("week").jobs);
            const onApply = $.const(Record.onApply(plans, {
                entry: "week",
                get: East.function([ReadinessPlan], ArrayType(ReadinessJob), (_$, held) => held.jobs),
                set: East.function([ReadinessPlan, ArrayType(ReadinessJob)], ReadinessPlan, (_$, _held, next) => ({ jobs: next })),
                idField: "id",
            }));
            const readyRow = $.const(East.function([Sheet.Types.Draft(ReadinessJob), Sheet.Types.DraftContext(ReadinessJob)], Sheet.Types.Readiness, ($, row) => {
                $.if(row.qty.hasTag("value").and(() => row.qty.unwrap("value").lessEqual(0n)), $ => {
                    $.return(East.value(variant("incomplete", [{ field: "qty", message: "Quantity must be positive" }]), Sheet.Types.Readiness));
                });
                return East.value(variant("ready", null), Sheet.Types.Readiness);
            }));
            const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(ReadinessJob), () => Sheet.patch(ReadinessJob, { createdBy: "planner" })));
            return (
                <VStack gap="3" align="stretch">
                    <Text textStyle="caption" color="fg.muted">Set Qty to 0: Apply stays disabled. Enter a positive quantity to save. Required fields are checked automatically; Notes may stay blank.</Text>
                    <Sheet.View
                        data={jobs}
                        id="id"
                        columns={{ task: Sheet.column.text(ReadinessJob), qty: Sheet.column.integer(ReadinessJob), note: Sheet.column.text(ReadinessJob) }}
                        ready={{ row: readyRow }}
                        newRow={newRow}
                        onApply={onApply}
                        blanks={2n}
                    />
                    <Text.MonoLabel>{East.str`SAVED · ${jobs.length()} rows · ${jobs.map((_$, row) => row.qty).sum()} total quantity`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetInsertion — inserting rows, within the capabilities
// ============================================================================

/** A row — its task, a whole quantity, and who made it (no column). */
export const InsertionRow = StructType({ id: StringType, task: StringType, qty: IntegerType, createdBy: StringType });
/** A plan — its rows, in the planner's order. */
export const InsertionPlan = StructType({ rows: ArrayType(InsertionRow) });
/** The plans — the sheet edits the week's rows. */
export const sheetInsertionPlans = e3.record("sheet_insertion_plans", DictType(StringType, InsertionPlan), new Map([
    ["week", { rows: [
        { id: "rough", task: "Rough machining", qty: 120n, createdBy: "planner" },
        { id: "inspect", task: "Inspect lots", qty: 4n, createdBy: "planner" },
        { id: "finish", task: "Finish housings", qty: 120n, createdBy: "planner" },
    ] }],
]));
/** The record's patch door — every Apply commits through it. */
export const sheetInsertionPlansPatch = e3.mutation.patch(sheetInsertionPlans);

/** Row insertion and capability limits over the rows an e3 record holds. */
export const sheetInsertion = example({
    keywords: ["Sheet", "edits", "insertRows", "removeRows", "insert", "newRow", "before", "after", "Undo", "onApply", "Record", "Record.onApply", "e3.record", "bound"],
    description: "Insert rows with the gutter buttons, selection strip or Alt+Insert; existing-row deletion is disabled while new drafts can be discarded",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The rows, read from an e3 record bound with its patch door.
            const plans = $.let(Record.bind(sheetInsertionPlans, [sheetInsertionPlansPatch]));
            const rows = $.let(plans.read().get("week").rows);
            const onApply = $.const(Record.onApply(plans, {
                entry: "week",
                get: East.function([InsertionPlan], ArrayType(InsertionRow), (_$, held) => held.rows),
                set: East.function([InsertionPlan, ArrayType(InsertionRow)], InsertionPlan, (_$, _held, next) => ({ rows: next })),
                idField: "id",
            }));
            const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(InsertionRow), () => Sheet.patch(InsertionRow, { qty: 1n, createdBy: "planner" })));
            return <VStack gap="3" align="stretch">
                <Text textStyle="caption" color="fg.muted">Hover or focus a gutter to insert before a row. Select a row marker for Insert above/below, or use Alt+Insert and Alt+Shift+Insert. Name the draft and Apply to save it.</Text>
                <Sheet.View data={rows} id="id" columns={{ task: Sheet.column.text(InsertionRow), qty: Sheet.column.integer(InsertionRow) }}
                    edits={{ insertRows: true, removeRows: false, moveRows: "none" }}
                    newRow={newRow}
                    onApply={onApply} blanks={2n} />
                <Text.MonoLabel>{East.str`SAVED · ${rows.map((_$, row) => row.task).stringJoin(" → ")}`}</Text.MonoLabel>
            </VStack>;
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetSubRows — a line's own records, read only
// ============================================================================

/** An operation — a line's own record, shown as a sub row: its code, name,
 *  materials, and optional station and team. */
export const SubRowsOperation = StructType({
    id: StringType, code: StringType, name: StringType, materials: ArrayType(StringType),
    station: OptionType(StringType), by: OptionType(StringType),
});
/** A booking — the space, labour or equipment a line claims, shown as a sub row arm by arm. */
export const SubRowsBooking = VariantType({
    space:     StructType({ area: StringType, units: IntegerType }),
    labour:    StructType({ team: StringType, people: IntegerType, hours: FloatType }),
    equipment: StructType({ resource: StringType }),
});
/** A job — an order's line: its task, quantity and notes, with its operations
 *  and bookings (no columns: shown as sub rows). */
export const SubRowsJob = StructType({
    task: StringType, qty: OptionType(FloatType), notes: StringType,
    operations: ArrayType(SubRowsOperation),   // no column — shown as sub rows
    bookings: ArrayType(SubRowsBooking),       // no column — shown as sub rows
});
/** An order — a group of jobs. */
export const SubRowsOrder = StructType({ id: StringType, name: StringType, jobs: ArrayType(SubRowsJob) });
/** A week — its orders, in the planner's order. */
export const SubRowsWeek = StructType({ orders: ArrayType(SubRowsOrder) });
/** The weeks — the sheet edits the week's orders. */
export const sheetSubRowsWeeks = e3.record("sheet_subrows_weeks", DictType(StringType, SubRowsWeek), new Map([
    ["week", { orders: [
        { id: "wo-1042", name: "WO-1042 · Frames", jobs: [
            { task: "Assemble frames", qty: some(40.0), notes: "Two benches", operations: [
                { id: "WO-1042-1", code: "CUT", name: "Cut rails to length", materials: ["Rail stock × 80"], station: some("Saw 2"), by: none },
                { id: "WO-1042-2", code: "ASM", name: "Assemble frame", materials: ["M6 bolts × 12", "Frame kit"], station: some("Bench 7"), by: some("Assembly") },
            ], bookings: [
                variant("labour", { team: "Assembly", people: 2n, hours: 12.0 }),
                variant("equipment", { resource: "Torque driver" }),
            ] },
            { task: "Inspect frames", qty: some(40.0), notes: "", operations: [], bookings: [
                variant("space", { area: "Test bay", units: 2n }),
            ] },
        ] },
        { id: "wo-1043", name: "WO-1043 · Housings", jobs: [
            { task: "Paint housings", qty: some(250.0), notes: "Primer first", operations: [
                { id: "WO-1043-1", code: "PNT", name: "Prime and paint", materials: ["Primer", "Topcoat"], station: none, by: none },
            ], bookings: [] },
        ] },
    ] }],
]));
/** The record's patch door — every Apply commits through it. */
export const sheetSubRowsWeeksPatch = e3.mutation.patch(sheetSubRowsWeeks);

/**
 * Sub rows (#844) — read-only rows under each line that share none of its
 * columns. `Sheet.subRows` is keyed like `columns`: each key names an array
 * field of the line type and maps one element to a sub row — a struct source
 * with chips and labelled facets (a `none` facet drops out), and a variant
 * source matched arm by arm. The group's noun is the host's word. The orders
 * are an e3 record's, and Apply commits to it.
 */
export const sheetSubRows = example({
    keywords: ["Sheet", "subRows", "subRow", "sub rows", "SubRow", "Facet", "chips", "facets", "lead", "detail", "group", "noun", "variant", "match", "read-only", "onApply", "Record", "Record.onApply", "e3.record", "bound", "Reactive"],
    description: "Sub rows under each line — operations with chips and facets, bookings matched from a variant — declared per array field like columns, under groups the host calls orders, over an e3 record",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The orders, read from an e3 record bound with its patch door.
            const weeks = $.let(Record.bind(sheetSubRowsWeeks, [sheetSubRowsWeeksPatch]));
            const orders = $.let(weeks.read().get("week").orders);
            const onApply = $.const(Record.onApply(weeks, {
                entry: "week",
                get: East.function([SubRowsWeek], ArrayType(SubRowsOrder), (_$, held) => held.orders),
                set: East.function([SubRowsWeek, ArrayType(SubRowsOrder)], SubRowsWeek, (_$, _held, next) => ({ orders: next })),
                idField: "id",
            }));
            const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(SubRowsJob), () => Sheet.patch(SubRowsJob, { notes: "", operations: [], bookings: [] })));
            const newGroup = $.const(East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(SubRowsOrder), () => Sheet.patch(SubRowsOrder, { jobs: [] })));
            return (
                <Sheet.View
                    data={orders}
                    id="id"
                    group={Sheet.group(SubRowsOrder, "jobs", { title: "name", noun: { singular: "order", plural: "orders" } })}
                    columns={{
                        task:  Sheet.column.text(SubRowsJob, { header: "Task", width: "220px" }),
                        qty:   Sheet.column.quantity(SubRowsJob, { header: "Qty", width: "96px" }),
                        notes: Sheet.column.text(SubRowsJob, { header: "Notes", width: "240px" }),
                    }}
                    subRows={Sheet.subRows(SubRowsJob, {
                        operations: (op) => Sheet.subRow({
                            code:   op.code,
                            name:   op.name,
                            chips:  op.materials,
                            facets: { station: op.station, by: op.by },   // a none drops out
                            id:     op.id,
                        }),
                        bookings: (b) => b.match({
                            space:     (_$2, s) => Sheet.subRow({ code: "CLAIM", name: East.str`${s.area} · ${s.units} units` }),
                            labour:    (_$2, l) => Sheet.subRow({ code: "LABOUR", name: East.str`${l.team} · ${l.people} people · ${l.hours} person-hours` }),
                            equipment: (_$2, e) => Sheet.subRow({ code: "EQUIPMENT", name: e.resource }),
                        }),
                    })}
                    newRow={newRow}
                    newGroup={newGroup}
                    onApply={onApply}
                    style={{ height: "420px" }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetRules — what a column offers, and how deep a date reads
// ============================================================================

/** A job — its task, its start read at its own level, when it really
 *  started, its status, order code and machines (a set of codes). */
export const RulesJob = StructType({
    id: StringType, task: StringType, start: OptionType(DateTimeType), level: Sheet.Types.DateLevel,
    started: OptionType(DateTimeType), status: StringType, orderCode: StringType, machines: Sheet.Types.Link,
});
/** A plan — its jobs, in the planner's order. */
export const RulesPlan = StructType({ jobs: ArrayType(RulesJob) });
/** The plans — the sheet edits the week's jobs. */
export const sheetRulesPlans = e3.record("sheet_rules_plans", DictType(StringType, RulesPlan), new Map([
    ["week", { jobs: [
        { id: "j1", task: "Rough blanks", start: some(new Date("2026-02-16T00:00:00Z")), level: variant("week", null), started: none, status: "PLANNED", orderCode: "", machines: { from: [], to: [] } },
        { id: "j2", task: "Finish blanks", start: some(new Date("2026-02-18T00:00:00Z")), level: variant("day", null), started: some(new Date("2026-02-19T07:30:00Z")), status: "IN PROGRESS", orderCode: "WO-26001", machines: { from: [], to: [variant("range", { from: "M2140", to: "M2143" })] } },
        { id: "j3", task: "Changeover", start: some(new Date("2026-02-19T14:00:00Z")), level: variant("time", null), started: none, status: "RELEASED", orderCode: "WO-26002", machines: { from: [], to: [] } },
    ] }],
]));
/** The record's patch door — every Apply commits through it. */
export const sheetRulesPlansPatch = e3.mutation.patch(sheetRulesPlans);

/**
 * Column rules (#844) — what a column offers, how deep a date reads, and
 * what a cell says beyond its value: an `options` rule narrows the status
 * menu until the row has an order code; the start date reads at the row's
 * own `level` and prints the `actual` start once one is recorded; the status
 * cell's `detail` is the order code; machines are a `ranged` kind, so runs
 * of consecutive codes are offered and printed as one range. The jobs are an
 * e3 record's, and Apply commits to it.
 */
export const sheetRules = example({
    keywords: ["Sheet", "options", "level", "actual", "detail", "ranged", "DateLevel", "week", "day", "range", "time", "enum", "date", "set", "members", "rule", "onApply", "Record", "Record.onApply", "e3.record", "bound", "Reactive"],
    description: "Column rules — an options rule narrowing an enum's menu, a date read at each row's level with its actual start, a status detail, and a ranged machine kind",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const Ctx = Sheet.Types.DraftContext(RulesJob);
            const StatusType = StructType({ word: StringType, tone: Status.Types.Value });
            const statuses = $.const([
                { word: "PLANNED", tone: variant("neutral", null) }, { word: "RELEASED", tone: variant("info", null) },
                { word: "IN PROGRESS", tone: variant("warning", null) }, { word: "COMPLETE", tone: variant("success", null) },
            ], ArrayType(StatusType));
            const machines = $.const(["M2140", "M2141", "M2142", "M2143", "M3210", "M3211"], ArrayType(StringType));
            const noMembers = $.const([], ArrayType(Sheet.Types.Member));
            // The jobs, read from an e3 record bound with its patch door.
            const plans = $.let(Record.bind(sheetRulesPlans, [sheetRulesPlansPatch]));
            const jobs = $.let(plans.read().get("week").jobs);
            const onApply = $.const(Record.onApply(plans, {
                entry: "week",
                get: East.function([RulesPlan], ArrayType(RulesJob), (_$, held) => held.jobs),
                set: East.function([RulesPlan, ArrayType(RulesJob)], RulesPlan, (_$, _held, next) => ({ jobs: next })),
                idField: "id",
            }));
            // Until a row has an order code it may only be planned or released.
            const statusOptions = $.const(East.function([Ctx], OptionType(ArrayType(StringType)), ($, ctx) => {
                const whole = $.const(none, OptionType(ArrayType(StringType)));
                const early = $.const(some(["PLANNED", "RELEASED"]), OptionType(ArrayType(StringType)));
                return ctx.row.orderCode.match({ value: (_$2, code) => code.length().equal(0n).ifElse(() => early, () => whole) }, () => early);
            }));
            const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(RulesJob), () => Sheet.patch(RulesJob, {
                level: variant("day", null), started: none, orderCode: "", machines: { from: noMembers, to: noMembers },
            })));
            return (
                <Sheet.View
                    data={jobs}
                    id="id"
                    registers={{
                        statuses: Sheet.register.members(statuses, { kind: "status", key: s => s.word, label: s => s.word, tone: s => some(s.tone) }),
                        machines: Sheet.register.members(machines, { kind: "machine", key: m => m, label: m => m }),
                    }}
                    columns={{
                        task:     Sheet.column.text(RulesJob, { header: "Task", width: "180px" }),
                        start:    Sheet.column.date(RulesJob, { header: "Start", sub: "at the row's level", width: "168px", level: r => r.level, actual: r => r.started }),
                        status:   Sheet.column.enum(RulesJob, "statuses", { header: "Status", width: "132px", options: statusOptions, detail: r => r.orderCode }),
                        machines: Sheet.column.set(RulesJob, "machines", { header: "Machines", sub: "M2140-43 · a run", width: "220px",
                                      members: [{ kind: "machine", identified: true, ranged: true }] }),
                    }}
                    newRow={newRow}
                    onApply={onApply}
                    blanks={4n}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetRegisters — registers and the driver
// ============================================================================

/** A job — its activity (the driver), start, end, quantity in the activity's unit, and machines. */
export const RegistersJob = StructType({
    id: StringType, activity: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType),
    qty: OptionType(FloatType), machines: Sheet.Types.Link,
});
/** A plan — its jobs, in the planner's order. */
export const RegistersPlan = StructType({ jobs: ArrayType(RegistersJob) });
/** The plans — the sheet edits the week's jobs. */
export const sheetRegistersPlans = e3.record("sheet_registers_plans", DictType(StringType, RegistersPlan), new Map([
    ["week", { jobs: [
        { id: "j1", activity: "Machining", start: some(new Date("2026-02-16T00:00:00Z")), end: none, qty: some(1200.0),
          machines: { from: [], to: [variant("counted", { n: 2n, key: "CNC lathe" })] } },
    ] }],
]));
/** The record's patch door — every Apply commits through it. */
export const sheetRegistersPlansPatch = e3.mutation.patch(sheetRegistersPlans);

/**
 * Registers and the driver (§3.3) — a register is the grammar's vocabulary,
 * projected from the host's rows by accessors: machines from an Array with a
 * meta and a parent, lines from a Dict whose key rides as the accessors'
 * second argument, and the machine families read off the same machines (the
 * lathes fold into one member), joined into the one register the Machines
 * column resolves against. The driver is the `lookup` column whose member
 * decides what the row does: its row gives the quantity its unit and the End
 * fill its duration. The jobs are an e3 record's, and Apply commits to it.
 */
export const sheetRegisters = example({
    keywords: ["Sheet", "register", "members", "concat", "driver", "lookup", "set", "kind", "key", "label", "aliases", "meta", "parent", "Dict", "fold", "duplicate", "uom", "fill", "DraftContext", "onApply", "Record", "Record.onApply", "e3.record", "bound", "Reactive"],
    description: "Registers and the driver — members projected from Array and Dict rows (meta, parent, aliases, duplicate keys folded) and joined into one register a set column resolves against, beside a driver whose row gives each quantity its unit and a fill its duration",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const ActivityType = StructType({ name: StringType, uom: StringType, days: IntegerType });
            const MachineType = StructType({ code: StringType, family: StringType, line: StringType });
            const LineType = StructType({ name: StringType, aliases: ArrayType(StringType) });
            const activities = $.const([
                { name: "Machining", uom: "pcs", days: 4n },
                { name: "Inspection", uom: "lots", days: 1n },
            ], ArrayType(ActivityType));
            const machines = $.const([
                { code: "M2140", family: "CNC lathe", line: "L2" },
                { code: "M2141", family: "CNC lathe", line: "L2" },
                { code: "M3210", family: "5-axis mill", line: "L3" },
            ], ArrayType(MachineType));
            const lines = $.const(new Map([
                ["L2", { name: "Line 2", aliases: ["l2", "line 2"] }],
                ["L3", { name: "Line 3", aliases: ["l3", "line 3"] }],
            ]), DictType(StringType, LineType));
            // The jobs, read from an e3 record bound with its patch door.
            const plans = $.let(Record.bind(sheetRegistersPlans, [sheetRegistersPlansPatch]));
            const jobs = $.let(plans.read().get("week").jobs);
            const onApply = $.const(Record.onApply(plans, {
                entry: "week",
                get: East.function([RegistersPlan], ArrayType(RegistersJob), (_$, held) => held.jobs),
                set: East.function([RegistersPlan, ArrayType(RegistersJob)], RegistersPlan, (_$, _held, next) => ({ jobs: next })),
                idField: "id",
            }));
            // The driver's row reaches a fill typed: End = Start + the activity's days.
            const DateFill = OptionType(Sheet.Types.Fill(DateTimeType));
            const endFromStart = $.const(East.function([Sheet.Types.DraftContext(RegistersJob, ActivityType)], DateFill, ($, ctx) => {
                const noFill = $.const(none, DateFill);
                return ctx.row.start.match({
                    value: (_$, supplied) => supplied.match({
                        none: () => noFill,
                        some: (_$, start) => ctx.driver.match({
                            none: () => noFill,
                            some: (_$, d) => some({ value: start.addDays(d.days), meta: East.str`+${d.days}d · ${d.name}` }),
                        }),
                    }),
                }, () => noFill);
            }));
            const newJob = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(RegistersJob), () => Sheet.patch(RegistersJob, { machines: { from: [], to: [] } })));
            return (
                <Sheet.View
                    data={jobs}
                    id="id"
                    driver={Sheet.driver("activity", activities, { key: a => a.name, label: a => a.name, meta: a => some(a.uom) })}
                    registers={{
                        machines: Sheet.register.concat([
                            Sheet.register.members(machines, { kind: "machine", key: m => m.code, label: m => m.code,
                                meta: m => some(m.family), parent: m => some(m.line) }),
                            // A Dict's key rides as the accessors' second argument.
                            Sheet.register.members(lines, { kind: "line", key: (_l, code) => code, label: l => l.name, aliases: l => l.aliases }),
                            // Both lathes name one family — duplicate keys fold, the first wins.
                            Sheet.register.members(machines, { kind: "family", key: m => m.family, label: m => m.family, meta: _m => some("family") }),
                        ]),
                    }}
                    columns={{
                        activity: Sheet.column.lookup(RegistersJob, { header: "Activity", width: "140px" }),
                        start:    Sheet.column.date(RegistersJob, { header: "Start", width: "96px" }),
                        end:      Sheet.column.date(RegistersJob, { header: "End", sub: "start + days", width: "96px", base: "start", fill: [endFromStart] }),
                        qty:      Sheet.column.quantity(RegistersJob, ActivityType, { header: "Qty", sub: "uom per activity", width: "112px", uom: d => d.uom }),
                        machines: Sheet.column.set(RegistersJob, "machines", { header: "Machines", sub: "M2140 · 2 x lathe · line 2", width: "240px",
                                      members: [{ kind: "machine", identified: true }, { kind: "line", countable: true, resolvesTo: "machine" },
                                                { kind: "family", countable: true, resolvesTo: "machine" }] }),
                    }}
                    newRow={newJob}
                    onApply={onApply}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// sheetLoose — loose rows between the groups
// ============================================================================

/** A task — a package's line, or a loose task that belongs to no package. */
export const LooseTask = StructType({ id: StringType, task: StringType, qty: OptionType(FloatType), notes: StringType });
/** A work package — its name and tasks. */
export const LoosePackage = StructType({ id: StringType, name: StringType, tasks: ArrayType(LooseTask) });
/** An entry — a package with its tasks, or a loose task. */
export const LooseEntry = Sheet.Types.Entry(LoosePackage, "tasks");
/** A week — its entries, in the planner's order. */
export const LooseWeek = StructType({ entries: ArrayType(LooseEntry) });
/** The weeks — the sheet edits the week's entries. */
export const sheetLooseWeeks = e3.record("sheet_loose_weeks", DictType(StringType, LooseWeek), new Map([
    ["week", { entries: [
        variant("row", { id: "brief", task: "Review the drawings", qty: none, notes: "Before any machining" }),
        variant("group", { id: "roughing", name: "P-40 · Roughing", tasks: [
            { id: "rough-1", task: "Machine blanks", qty: some(1200.0), notes: "Four CNC lathes" },
            { id: "rough-2", task: "Inspect lots", qty: some(4.0), notes: "Check before finishing" },
        ] }),
        variant("row", { id: "handover", task: "Hand over to finishing", qty: none, notes: "" }),
        variant("group", { id: "finishing", name: "P-40 · Finishing", tasks: [
            { id: "finish-1", task: "Finish housings", qty: some(1200.0), notes: "After inspection" },
        ] }),
    ] }],
]));
/** The record's patch door — every Apply commits through it. */
export const sheetLooseWeeksPatch = e3.mutation.patch(sheetLooseWeeks);

/**
 * Loose rows between the groups (#846) — the source holds entries
 * `Sheet.Types.Entry(LoosePackage, "tasks")`: a work package with its tasks,
 * or a task that belongs to no package. A loose task draws as a plain row,
 * numbered in the packages' sequence; the seam above a package's band, or
 * beside a loose task, inserts a loose task, and a task's seam inserts a task
 * into its package. `id` names a field of both types: a loose task is an
 * entry, identified like a package. The entries are an e3 record's, and
 * Apply commits to it.
 */
export const sheetLoose = example({
    keywords: ["Sheet", "group", "grouped", "loose", "ungrouped", "Entry", "Types.Entry", "variant", "entries", "insert", "newRow", "newGroup", "noun", "onApply", "Record", "Record.onApply", "e3.record", "bound", "Reactive"],
    description: "Loose rows between the groups — entries of work packages and loose tasks: a loose task is a plain row numbered in the packages' sequence, inserted at the seam above a package or beside another loose task",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The entries, read from an e3 record bound with its patch door.
            const weeks = $.let(Record.bind(sheetLooseWeeks, [sheetLooseWeeksPatch]));
            const entries = $.let(weeks.read().get("week").entries);
            const onApply = $.const(Record.onApply(weeks, {
                entry: "week",
                get: East.function([LooseWeek], ArrayType(LooseEntry), (_$, held) => held.entries),
                set: East.function([LooseWeek, ArrayType(LooseEntry)], LooseWeek, (_$, _held, next) => ({ entries: next })),
                idField: "id",
            }));
            const newTask = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(LooseTask), () => Sheet.patch(LooseTask, { notes: "" })));
            const newPackage = $.const(East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(LoosePackage), () => Sheet.patch(LoosePackage, { tasks: [] })));
            return (
                <VStack gap="3" align="stretch">
                    <Text textStyle="caption" color="fg.muted">Hover the seam above a package, or beside a loose task, to insert a loose task; a task's seam inserts a task into its package. Apply changes saves the batch.</Text>
                    <Sheet.View
                        data={entries}
                        id="id"
                        group={Sheet.group(LoosePackage, "tasks", { title: "name", noun: { singular: "package", plural: "packages" } })}
                        columns={{
                            task:  Sheet.column.text(LooseTask, { header: "Task", width: "240px" }),
                            qty:   Sheet.column.quantity(LooseTask, { header: "Qty", width: "112px" }),
                            notes: Sheet.column.text(LooseTask, { header: "Notes", width: "280px" }),
                        }}
                        newRow={newTask}
                        newGroup={newPackage}
                        onApply={onApply}
                        style={{ height: "420px" }}
                    />
                    <Text.MonoLabel>{East.str`SAVED · ${entries.filter((_$, e) => e.hasTag("group")).length()} packages · ${entries.filter((_$, e) => e.hasTag("row")).length()} loose tasks`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
