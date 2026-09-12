/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import {
    East, ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, StringType, StructType,
    example, none, some, variant,
} from "@elaraai/east";
import {
    Badge, Box, Configurator, Format, HStack, Input, Paged, Reactive, SegmentGroup, Sheet, Slice, State, Status, Style, Switch, Text, UIComponentType, VStack,
} from "@elaraai/east-ui";

// ============================================================================
// The Sheet corpus — the five slots of EXAMPLES_AUTHORING.md §8 (Sheet Spec.md §8 P1):
// `sheetBasic` · `sheetVariants` (THE configurator) · `sheetPlan` (the flagship)
// · the behavioural isolates `sheetCopilot` / `sheetLens` / `sheetWriteBack` /
// `sheetPaged` · `sheetStress`. Every example is self-contained — types,
// fixtures and constructors inside the body, bulk data derived East-side —
// and the fixtures are the prototype's synthetic registers and rows: a
// discrete manufacturing plant (machines on lines, work orders moving parts
// between them), no customer, site or product names.
// ============================================================================

// The one thing at module scope: a platform declaration the async proposer
// of `sheetCopilot` / `sheetPlan` awaits. The row and context types it is
// typed over must be declared beside it, so they are declared once here and
// re-declared inside the example bodies that use them (the examples rule).
const PLAN_ROW_TYPE = StructType({
    id: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), activity: StringType,
    qty: OptionType(FloatType), notes: StringType, stations: Sheet.Types.Link, setups: OptionType(IntegerType),
    fromSite: StringType, toSite: StringType, orderCode: StringType, status: StringType,
});
const ACTIVITY_TYPE = StructType({
    name: StringType, uom: StringType, rate: FloatType, fte: IntegerType, days: IntegerType, sides: Sheet.Types.Sides,
});
/** The model behind an async proposer — an e3 function, a service, a notebook; the Sheet only needs the types. */
const planRecommend = East.asyncPlatform(
    "sheet_plan_recommend",
    [Sheet.Types.Context(PLAN_ROW_TYPE, ACTIVITY_TYPE)],
    ArrayType(Sheet.Types.Proposal(PLAN_ROW_TYPE)),
    { optional: true },
);

/**
 * The smallest sheet (§3.1) — three typed columns over the host's structs,
 * `onUpdate` receiving the whole collection with the edit applied (the
 * `ValueTree` idiom), so a `State.bind` is the entire persistence story.
 */
export const sheetBasic = example({
    keywords: ["Sheet", "Root", "basic", "column", "date", "text", "quantity", "onUpdate", "State", "Reactive", "id"],
    description: "The smallest sheet — three typed columns over the host's structs, the whole collection written back on every edit",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const JobType = StructType({
                id:    StringType,
                start: OptionType(DateTimeType),   // none = blank cell
                task:  StringType,                 // "" = blank cell
                qty:   OptionType(FloatType),
            });
            const jobs = $.let(State.bind([ArrayType(JobType)], "sheet_basic_jobs", [
                { id: "j1", start: none, task: "Machining", qty: none },
            ]));
            return (
                <Sheet
                    data={jobs.read()}
                    id="id"
                    columns={{
                        start: Sheet.column.date(JobType, { header: "Start", sub: "dd / mm / yyyy" }),
                        task:  Sheet.column.text(JobType, { header: "Task" }),
                        qty:   Sheet.column.quantity(JobType, { header: "Qty" }),   // no driver on this sheet — the two-argument form
                    }}
                    onUpdate={jobs.write}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * THE Sheet configurator — ONE live sheet; every axis is an expression-fed
 * prop on that single instance: density, the blank tail, read-only, the size
 * mode (auto / scroll / fill) and the copilot switch (a fill provider that
 * reads the switch through its captured bind handle). Selection and edits
 * log to the reactive aside.
 */
export const sheetVariants = example({
    keywords: ["Sheet", "Root", "configurator", "density", "blanks", "readOnly", "height", "fill", "scroll", "#320", "copilot", "fill", "provider", "onSelect", "onEdit", "Configurator", "SegmentGroup", "Switch", "Input", "Reactive", "State"],
    description: "Sheet configurator — density, the blank tail, read-only, size mode (auto / scroll / fill) and the copilot switch all expression-fed into one live sheet; selection and edits log to the aside",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const JobType = StructType({ id: StringType, start: OptionType(DateTimeType), task: StringType, qty: OptionType(FloatType), notes: StringType });
            const Ctx = Sheet.Types.Context(JobType);
            const rows = $.let(State.bind([ArrayType(JobType)], "sheet_variants_rows", [
                { id: "j1", start: some(new Date("2026-02-16T00:00:00Z")), task: "Machining", qty: some(1200.0), notes: "Rough the P-40 blanks" },
                { id: "j2", start: some(new Date("2026-03-09T00:00:00Z")), task: "Painting", qty: some(250.0), notes: "" },
                { id: "j3", start: none, task: "Packaging", qty: none, notes: "" },
            ]));
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
                return copilotBind.read().and(() => ctx.row.task.length().greater(0n)).ifElse(
                    (_$) => East.value(some({ value: East.str`${ctx.row.task} as planned`, meta: "phrasing from the task" }), NoteFill),
                    (_$) => noFill,
                );
            }));

            const onSelect = $.const(East.function([Sheet.Types.Selection], NullType, ($, sel) => {
                $(lastEventBind.write(East.str`onSelect: row ${sel.rowId.match({ some: (_$, id) => id, none: (_$) => "—" })} · ${sel.key.match({ some: (_$, k) => k, none: (_$) => "—" })}`));
            }));
            const onEdit = $.const(East.function([Sheet.Types.Edit(JobType)], NullType, ($, e) => {
                $(lastEventBind.write(e.match({
                    commit: (_$, c) => East.str`commit: ${c.rowId} · ${c.key} · ${c.source.getTag()}`,
                    insert: (_$, i) => East.str`insert: ${i.row.id}`,
                    remove: (_$, r) => East.str`remove: ${r.rowIds.length()} rows`,
                })));
            }));

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
                            <Sheet
                                data={rows.read()}
                                id="id"
                                columns={{
                                    start: Sheet.column.date(JobType, { header: "Start", sub: "dd / mm / yyyy", width: "96px" }),
                                    task:  Sheet.column.text(JobType, { header: "Task", width: "180px" }),
                                    qty:   Sheet.column.quantity(JobType, { header: "Qty", sub: "1,200 · pcs", width: "112px", format: Format.Number({ maximumFractionDigits: 0n }) }),
                                    notes: Sheet.column.text(JobType, { header: "Notes", sub: "free text", fill: [phrase] }),
                                }}
                                density={densitySel}
                                blanks={blanks}
                                readOnly={readOnly}
                                onSelect={onSelect}
                                onEdit={onEdit}
                                onUpdate={rows.write}
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
                        Configurator.Spec("Rows", East.str`${rows.read().length()} real`),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * The flagship (§3.11) — every column kind, three registers and a driver,
 * the copilot's fills and proposers as author functions, the slice lens with
 * saved views, a footer, and `onUpdate` write-back, on one sheet.
 */
export const sheetPlan = example({
    keywords: ["Sheet", "Root", "plan", "flagship", "driver", "register", "lookup", "reference", "enum", "link", "stamped", "quantity", "uom", "sides", "arity", "check", "fill", "propose", "suggest", "asyncFunction", "asyncPlatform", "slice", "search", "filter", "lens", "views", "text", "Sheet.link.print", "footer", "owned", "onUpdate", "Reactive", "State"],
    description: "The flagship production plan — every column kind over one raw source, registers and a driver, the copilot's fills and proposers as author functions (one async), the slice lens with saved views, a footer and whole-collection write-back",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const PlanRowType = StructType({
                id: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), activity: StringType,
                qty: OptionType(FloatType), notes: StringType, stations: Sheet.Types.Link, setups: OptionType(IntegerType),
                fromSite: StringType, toSite: StringType, orderCode: StringType, status: StringType,
            });
            const ActivityType = StructType({ name: StringType, uom: StringType, rate: FloatType, fte: IntegerType, days: IntegerType, sides: Sheet.Types.Sides });
            const MachineType  = StructType({ code: StringType, family: StringType, line: StringType, site: StringType });
            const LineType     = StructType({ code: StringType, name: StringType, machines: IntegerType, aliases: ArrayType(StringType) });
            const FamilyType   = StructType({ name: StringType, aliases: ArrayType(StringType) });
            const StatusType   = StructType({ word: StringType, tone: Status.Types.Value });
            const Ctx = Sheet.Types.Context(PlanRowType, ActivityType);
            const Proposals = ArrayType(Sheet.Types.Proposal(PlanRowType));

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
            ], ArrayType(ActivityType));
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

            // The plan rows — the prototype's seed, as typed data: a Link is a value, never a string.
            const plan = $.let(State.bind([ArrayType(PlanRowType)], "sheet_plan_rows", [
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
            ]));
            const views = $.let(State.bind([ArrayType(Sheet.Types.View)], "sheet_plan_views", []));
            const rows = $.let(plan.read());

            // The slice — search runs THROUGH it; the sheet draws the narrowing as a lens (§3.8).
            // A Link is searched by its display form (`M2140 > 4 x CNC lathe`), never its `.east` text.
            const cfg = $.const(Slice.config(PlanRowType, {
                fields: { activity: { label: "Activity" }, notes: { label: "Notes" }, status: { label: "Status" },
                          stations: { label: "Work centres", text: r => Sheet.link.print(r.stations) } },
                searchFieldIds: ["activity", "notes", "stations"],
            }));
            const slice = $.let(Slice.bind([PlanRowType], "sheet_plan_slice", cfg, Slice.state(), rows, none));

            // The arity rule (§3.4) — how many machines the To half should hold, from the quantity.
            const impliedStations = $.const(East.function([Ctx], OptionType(Sheet.Types.Counted), ($, ctx) => {
                const noCount = $.const(none, OptionType(Sheet.Types.Counted));
                const qty = $.let(ctx.row.qty.match({ some: (_$, v) => v, none: (_$) => 0.0 }));
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
            const CheckCtx = Sheet.Types.CheckContext(PlanRowType);
            const siteMatches = $.const(East.function([CheckCtx], OptionType(StringType), ($, c) => {
                const noFlag = $.const(none, OptionType(StringType));
                const site = $.let(c.half.match({ from: (_$) => c.row.fromSite, to: (_$) => c.row.toSite }));
                return c.member.match({
                    identified: (_$, m) => site.equal("").not()
                        .and(() => machineSites.has(m.key))
                        .and(() => machineSites.get(m.key).equal(site).not())
                        .ifElse((_$2) => East.value(some(East.str`${m.key} is not at ${site}`), OptionType(StringType)), (_$2) => noFlag),
                }, (_$) => noFlag);
            }));

            // The fills (§3.5) — derive, history, sequence, default, phrase, capacity — as author functions.
            const DateFill = OptionType(Sheet.Types.Fill(DateTimeType));
            const FloatFill = OptionType(Sheet.Types.Fill(FloatType));
            const TextFill = OptionType(Sheet.Types.Fill(StringType));
            const LinkFill = OptionType(Sheet.Types.Fill(Sheet.Types.Link));
            const endFromStart = $.const(East.function([Ctx], DateFill, ($, ctx) => {
                const noFill = $.const(none, DateFill);
                return ctx.row.start.match({
                    none: (_$) => noFill,
                    some: (_$, start) => ctx.driver.match({
                        none: (_$2) => noFill,
                        some: (_$2, d) => East.value(some({ value: start.addDays(d.days), meta: East.str`+${d.days}d · ${d.name}` }), DateFill),
                    }),
                });
            }));
            const lastSimilar = $.const(East.function([Ctx], OptionType(PlanRowType), ($, ctx) => {
                const similar = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) => r.activity.equal(ctx.row.activity)));
                return similar.length().equal(0n).ifElse(
                    (_$) => East.value(none, OptionType(PlanRowType)),
                    (_$) => East.value(some(similar.get(similar.length().subtract(1n))), OptionType(PlanRowType)));
            }));
            const lastQuantity = $.const(East.function([Ctx], FloatFill, ($, ctx) => {
                const noFill = $.const(none, FloatFill);
                const similar = $.const(lastSimilar);
                return similar(ctx).match({
                    none: (_$) => noFill,
                    some: (_$, r) => r.qty.match({ none: (_$2) => noFill, some: (_$2, v) => East.value(some({ value: v, meta: East.str`like ${r.id}` }), FloatFill) }),
                });
            }));
            const lastStations = $.const(East.function([Ctx], LinkFill, ($, ctx) => {
                const noFill = $.const(none, LinkFill);
                const similar = $.const(lastSimilar);
                return similar(ctx).match({
                    none: (_$) => noFill,
                    some: (_$, r) => r.stations.from.length().add(r.stations.to.length()).equal(0n).ifElse(
                        (_$2) => noFill, (_$2) => East.value(some({ value: r.stations, meta: East.str`same stations as ${r.id}` }), LinkFill)),
                });
            }));
            const nextSlot = $.const(East.function([Ctx], DateFill, ($, ctx) => {
                const dated = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) => r.start.hasTag("some")));
                return dated.length().greater(0n).ifElse(
                    ($2) => {
                        const last = $2.let(dated.get(dated.length().subtract(1n)));
                        return East.value(some({ value: last.start.unwrap("some").addDays(7n), meta: East.str`week after ${last.id}` }), DateFill);
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
                const n = $.let(ctx.row.qty.match({
                    some: ($2, v) => { const k = $2.let(v.add(0.5)); return k.subtract(k.remainder(1.0)).toInteger(); },   // round by hand — `toInteger` refuses a fraction
                    none: (_$) => 0n,
                }));
                return ctx.row.activity.startsWith("Machining").ifElse(
                    (_$) => East.value(some({ value: East.str`Machine ${n} P-40 blanks`, meta: "phrasing from past machining runs" }), TextFill),
                    (_$) => ctx.row.activity.startsWith("Painting").ifElse(
                        (_$2) => East.value(some({ value: East.str`Paint ${n} P-40 housings`, meta: "phrasing from past painting runs" }), TextFill),
                        (_$2) => noFill));
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
                const implied = $.const(impliedStations);
                const n = $.let(implied(ctx).match({ some: (_$, c) => c.n, none: (_$) => 1n }));
                return ctx.row.activity.equal("Machining - Roughing").and(() => ctx.row.end.hasTag("some")).ifElse(
                    ($2) => {
                        const endAt = $2.let(ctx.row.end.unwrap("some"));
                        return $2.const([
                            { patch: Sheet.patch(PlanRowType, { activity: "Inspection", start: ctx.row.start, end: ctx.row.end, qty: some(n.toFloat()), notes: East.str`Inspect ${n} roughing lots` }),
                              meta: "inspection · same days" },
                            { patch: Sheet.patch(PlanRowType, { activity: "Machining", start: some(endAt.addDays(3n)), end: some(endAt.addDays(7n)), qty: ctx.row.qty, notes: "Finish the roughed blanks" }),
                              meta: "finishing · end +3…+7 d" },
                        ], Proposals);
                    },
                    (_$2) => empty);
            }));
            const lastFollower = $.const(East.function([Ctx], Proposals, ($, ctx) => {
                const empty = $.const([], Proposals);
                const dated = $.let(ctx.rows.filter((_$, r) => r.start.hasTag("some").and(() => r.activity.equal("").not())));
                const n = $.let(dated.length());
                const upper = $.let(n.greater(1n).ifElse((_$) => n.subtract(1n), (_$) => 0n));
                const pairs = $.let(East.Array.range(0n, upper).filter((_$, i) =>
                    dated.get(i).activity.equal(ctx.row.activity).and(() => dated.get(i.add(1n)).activity.equal(ctx.row.activity).not())));
                return pairs.length().equal(0n).or(() => ctx.row.activity.equal("")).or(() => ctx.row.start.hasTag("some").not()).ifElse(
                    (_$) => empty,
                    ($2) => {
                        const i = $2.let(pairs.get(pairs.length().subtract(1n)));
                        const from = $2.let(dated.get(i));
                        const next = $2.let(dated.get(i.add(1n)));
                        const gapMs = $2.let(next.start.unwrap("some").toEpochMilliseconds().subtract(from.start.unwrap("some").toEpochMilliseconds()));
                        const at = $2.let(ctx.row.start.unwrap("some").addMilliseconds(gapMs));
                        return $2.const([{
                            patch: Sheet.patch(PlanRowType, { activity: next.activity, start: some(at), qty: next.qty, notes: next.notes }),
                            meta: East.str`${next.activity} followed ${ctx.row.activity} last time · +${gapMs.divide(86400000n)}d`,
                        }], Proposals);
                    });
            }));
            const modelProposals = $.const(East.asyncFunction([Ctx], Proposals, (_$, ctx) => planRecommend(ctx)));

            const planned = $.let(rows.filter((_$, r) => r.activity.length().greater(0n)).length());

            return (
                <Sheet
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
                        start:     Sheet.column.date(PlanRowType, { header: "Start", sub: "dd / mm / yyyy", width: "96px", fill: [nextSlot] }),
                        end:       Sheet.column.date(PlanRowType, { header: "End", sub: "4d = start+4", width: "96px", base: "start", fill: [endFromStart] }),
                        activity:  Sheet.column.lookup(PlanRowType, { header: "Activity", sub: "activity register", width: "214px" }),
                        qty:       Sheet.column.quantity(PlanRowType, ActivityType, {
                                       header: "Qty", sub: "uom per activity", width: "112px", uom: d => d.uom,
                                       format: Format.Number({ maximumFractionDigits: 0n }), fill: [lastQuantity, shiftQuantity] }),
                        notes:     Sheet.column.text(PlanRowType, { header: "Notes", sub: "free text", width: "250px", fill: [phrase] }),
                        stations:  Sheet.column.link(PlanRowType, ActivityType, "stations", {
                                       header: "Work centres", sub: "from → to · 4 x lathe · machine · line", width: "352px",
                                       members: [{ kind: "machine", identified: true }, { kind: "range", identified: true },
                                                 { kind: "line", countable: true, resolvesTo: "machine" },
                                                 { kind: "family", countable: true, resolvesTo: "machine" }],
                                       multiple: { forms: ["N x kind", "kind x N"], ops: ["x", "X", "*", "×"], appliesTo: "countable" },
                                       sides: { value: d => d.sides, locks: { from: { to: "external", in: "in place" }, to: { from: "external" } } },
                                       arity: Sheet.link.arity("to", impliedStations),
                                       check: [Sheet.link.check.exists(), siteMatches],
                                       fill: [lastStations, countedByQuantity] }),
                        setups:    Sheet.column.integer(PlanRowType, { header: "Setups", sub: "n", width: "64px" }),
                        fromSite:  Sheet.column.reference(PlanRowType, "sites", { header: "From site", sub: "site register", width: "112px" }),
                        toSite:    Sheet.column.reference(PlanRowType, "sites", { header: "To site", sub: "site register", width: "112px" }),
                        orderCode: Sheet.column.stamped(PlanRowType, { header: "Order code", sub: "stamped on release", owner: "ERP", width: "104px" }),
                        status:    Sheet.column.enum(PlanRowType, "statuses", { header: "Status", sub: "erp", width: "124px" }),
                    }}
                    suggest={{ ahead: 2n, triggers: ["activity", "start", "end", "qty", "notes", "stations"],
                               propose: [roughingFollowUps, modelProposals, lastFollower] }}
                    slice={slice} affordances={["search", "filter"]}
                    views={views.read()} onViewsChange={views.write}
                    onUpdate={plan.write}
                    footer={[{ text: East.str`${planned} planned` }]}
                    style={{ height: "fill" }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * The copilot in isolation (§3.5–§3.6) — the prototype's rules as author
 * functions: derive (End from Start + the driver's days), history (the last
 * similar row's quantity), sequence (a week after the last dated row), default
 * (eight hours at the driver's rate), a domain pattern proposer, a learned
 * follower, and an ASYNC proposer behind a platform function; every take
 * logs its provenance through `onEdit`.
 */
export const sheetCopilot = example({
    keywords: ["Sheet", "Root", "copilot", "fill", "provider", "propose", "proposer", "suggest", "derive", "history", "sequence", "default", "learned", "follower", "asyncFunction", "asyncPlatform", "pending", "latest wins", "provenance", "onEdit", "source", "Context", "Fill", "Patch", "Proposal", "Reactive", "State"],
    description: "The copilot in isolation — derive, history, sequence and default fills, a pattern proposer, a learned follower and an async model proposer, all author East functions over the typed context; takes log their provenance",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const PlanRowType = StructType({
                id: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), activity: StringType,
                qty: OptionType(FloatType), notes: StringType, stations: Sheet.Types.Link, setups: OptionType(IntegerType),
                fromSite: StringType, toSite: StringType, orderCode: StringType, status: StringType,
            });
            const ActivityType = StructType({ name: StringType, uom: StringType, rate: FloatType, fte: IntegerType, days: IntegerType, sides: Sheet.Types.Sides });
            const Ctx = Sheet.Types.Context(PlanRowType, ActivityType);
            const Proposals = ArrayType(Sheet.Types.Proposal(PlanRowType));
            const activities = $.const([
                { name: "Machining", uom: "pcs", rate: 60.0, fte: 2n, days: 4n, sides: variant("both", null) },
                { name: "Machining - Roughing", uom: "pcs", rate: 80.0, fte: 2n, days: 4n, sides: variant("both", null) },
                { name: "Painting", uom: "pcs", rate: 50.0, fte: 3n, days: 4n, sides: variant("both", null) },
                { name: "Inspection", uom: "lots", rate: 4.0, fte: 2n, days: 4n, sides: variant("in", null) },
                { name: "Packaging", uom: "cartons", rate: 120.0, fte: 1n, days: 3n, sides: variant("both", null) },
            ], ArrayType(ActivityType));
            const plan = $.let(State.bind([ArrayType(PlanRowType)], "sheet_copilot_rows", [
                { id: "1", start: some(new Date("2026-02-16T00:00:00Z")), end: some(new Date("2026-02-20T00:00:00Z")), activity: "Machining - Roughing", qty: some(1200.0), notes: "Rough the P-40 blanks", stations: { from: [], to: [] }, setups: none, fromSite: "", toSite: "", orderCode: "", status: "PLANNED" },
                { id: "2", start: some(new Date("2026-02-16T00:00:00Z")), end: some(new Date("2026-02-20T00:00:00Z")), activity: "Inspection", qty: some(4.0), notes: "Inspect the 4 lots", stations: { from: [], to: [] }, setups: none, fromSite: "", toSite: "", orderCode: "", status: "PLANNED" },
                { id: "3", start: some(new Date("2026-03-09T00:00:00Z")), end: none, activity: "Painting", qty: some(250.0), notes: "", stations: { from: [], to: [] }, setups: none, fromSite: "", toSite: "", orderCode: "", status: "PLANNED" },
            ]));
            const log = $.let(State.bind([ArrayType(StringType)], "sheet_copilot_log", []));

            const DateFill = OptionType(Sheet.Types.Fill(DateTimeType));
            const FloatFill = OptionType(Sheet.Types.Fill(FloatType));
            // derive — End = Start + the driver's days.
            const endFromStart = $.const(East.function([Ctx], DateFill, ($, ctx) => {
                const noFill = $.const(none, DateFill);
                return ctx.row.start.match({
                    none: (_$) => noFill,
                    some: (_$, start) => ctx.driver.match({
                        none: (_$2) => noFill,
                        some: (_$2, d) => East.value(some({ value: start.addDays(d.days), meta: East.str`+${d.days}d · ${d.name}` }), DateFill),
                    }),
                });
            }));
            // history — the last row above with this activity.
            const lastQuantity = $.const(East.function([Ctx], FloatFill, ($, ctx) => {
                const noFill = $.const(none, FloatFill);
                const similar = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) => r.activity.equal(ctx.row.activity)));
                return similar.length().equal(0n).ifElse(
                    (_$) => noFill,
                    ($2) => {
                        const r = $2.let(similar.get(similar.length().subtract(1n)));
                        return r.qty.match({ none: (_$) => noFill, some: (_$, v) => East.value(some({ value: v, meta: East.str`like ${r.id}` }), FloatFill) });
                    });
            }));
            // sequence — a week after the nearest dated row above; else next Monday.
            const nextSlot = $.const(East.function([Ctx], DateFill, ($, ctx) => {
                const dated = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) => r.start.hasTag("some")));
                return dated.length().greater(0n).ifElse(
                    ($2) => {
                        const last = $2.let(dated.get(dated.length().subtract(1n)));
                        return East.value(some({ value: last.start.unwrap("some").addDays(7n), meta: East.str`week after ${last.id}` }), DateFill);
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
                return ctx.row.activity.equal("Machining - Roughing").and(() => ctx.row.end.hasTag("some")).ifElse(
                    ($2) => {
                        const endAt = $2.let(ctx.row.end.unwrap("some"));
                        return $2.const([
                            { patch: Sheet.patch(PlanRowType, { activity: "Inspection", start: ctx.row.start, end: ctx.row.end, qty: some(4.0), notes: "Inspect 4 lots" }),
                              meta: "inspection · same days" },
                            { patch: Sheet.patch(PlanRowType, { activity: "Machining", start: some(endAt.addDays(3n)), end: some(endAt.addDays(7n)), qty: ctx.row.qty, notes: "Finish the roughed blanks" }),
                              meta: "finishing · end +3…+7 d" },
                        ], Proposals);
                    },
                    (_$2) => empty);
            }));
            // Learned from the sheet — what followed this activity last time, after how long.
            const lastFollower = $.const(East.function([Ctx], Proposals, ($, ctx) => {
                const empty = $.const([], Proposals);
                const dated = $.let(ctx.rows.filter((_$, r) => r.start.hasTag("some").and(() => r.activity.equal("").not())));
                const n = $.let(dated.length());
                const upper = $.let(n.greater(1n).ifElse((_$) => n.subtract(1n), (_$) => 0n));
                const pairs = $.let(East.Array.range(0n, upper).filter((_$, i) =>
                    dated.get(i).activity.equal(ctx.row.activity).and(() => dated.get(i.add(1n)).activity.equal(ctx.row.activity).not())));
                return pairs.length().equal(0n).or(() => ctx.row.activity.equal("")).or(() => ctx.row.start.hasTag("some").not()).ifElse(
                    (_$) => empty,
                    ($2) => {
                        const i = $2.let(pairs.get(pairs.length().subtract(1n)));
                        const from = $2.let(dated.get(i));
                        const next = $2.let(dated.get(i.add(1n)));
                        const gapMs = $2.let(next.start.unwrap("some").toEpochMilliseconds().subtract(from.start.unwrap("some").toEpochMilliseconds()));
                        const at = $2.let(ctx.row.start.unwrap("some").addMilliseconds(gapMs));
                        return $2.const([{
                            patch: Sheet.patch(PlanRowType, { activity: next.activity, start: some(at), qty: next.qty, notes: next.notes }),
                            meta: East.str`${next.activity} followed ${ctx.row.activity} last time · +${gapMs.divide(86400000n)}d`,
                        }], Proposals);
                    });
            }));
            // A model — an ASYNC proposer; the strip shows a pending chip and a newer context cancels the wait.
            const modelProposals = $.const(East.asyncFunction([Ctx], Proposals, (_$, ctx) => planRecommend(ctx)));

            // Every take carries its provenance through `onEdit` — the log measures copilot uptake.
            const onEdit = $.const(East.function([Sheet.Types.Edit(PlanRowType)], NullType, ($, e) => {
                const line = $.let(e.match({
                    commit: (_$, c) => East.str`${c.source.getTag()} · ${c.rowId} · ${c.key}`,
                    insert: (_$, i) => East.str`${i.source.getTag()} · new row ${i.row.id}`,
                    remove: (_$, r) => East.str`removed ${r.rowIds.length()}`,
                }));
                $(log.write(log.read().concat([line])));
            }));
            const entries = $.let(log.read());

            return (
                <VStack gap="3" align="stretch">
                    <Sheet
                        data={plan.read()}
                        id="id"
                        driver={Sheet.driver("activity", activities, { key: a => a.name, label: a => a.name })}
                        columns={{
                            start:    Sheet.column.date(PlanRowType, { header: "Start", sub: "sequence", width: "96px", fill: [nextSlot] }),
                            end:      Sheet.column.date(PlanRowType, { header: "End", sub: "derive", width: "96px", base: "start", fill: [endFromStart] }),
                            activity: Sheet.column.lookup(PlanRowType, { header: "Activity", sub: "activity register", width: "214px" }),
                            qty:      Sheet.column.quantity(PlanRowType, ActivityType, { header: "Qty", sub: "history · default", width: "112px", uom: d => d.uom, fill: [lastQuantity, shiftQuantity] }),
                            notes:    Sheet.column.text(PlanRowType, { header: "Notes", width: "260px" }),
                        }}
                        suggest={{ ahead: 2n, triggers: ["activity", "start", "end", "qty"], propose: [roughingFollowUps, modelProposals, lastFollower] }}
                        onEdit={onEdit}
                        onUpdate={plan.write}
                        style={{ height: "420px" }}
                    />
                    <Text.MonoLabel>{East.str`COPILOT LOG · ${entries.length()} edits · ${entries.filter((_$, l) => l.startsWith("typed").not()).length()} from the copilot`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * The lens (§3.8) — search and filter run through the bound slice; the sheet
 * never narrows, it draws non-matching rows as collapsed context bands
 * while hits keep their row numbers; a Link column is searched through its
 * display form (`text: r => Sheet.link.print(r.stations)`); views are
 * slice-state snapshots evaluated live, with their context and reveals.
 */
export const sheetLens = example({
    keywords: ["Sheet", "Root", "slice", "search", "filter", "lens", "bands", "context", "reveal", "views", "onViewsChange", "activeView", "text", "Sheet.link.print", "set", "Slice", "config", "bind", "state", "Reactive", "State"],
    description: "The lens — search and filter through the bound slice drawn as context bands (hits keep their row numbers), a Link column searched through its display text, and saved views as slice-state snapshots with their context and reveals",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const JobType = StructType({ id: StringType, start: OptionType(DateTimeType), activity: StringType, notes: StringType, stations: Sheet.Types.Link, status: StringType, qty: OptionType(FloatType) });
            const MachineType = StructType({ code: StringType, family: StringType });
            // Sixty rows derived East-side — enough for a narrowing to collapse into bands.
            const activities = $.const(["Machining", "Painting", "Packaging", "Changeover", "Maintenance"], ArrayType(StringType));
            const words = $.const(["PLANNED", "RELEASED", "COMPLETE"], ArrayType(StringType));
            const machines = $.const([
                { code: "M2140", family: "CNC lathe" }, { code: "M2141", family: "CNC lathe" }, { code: "M2145", family: "CNC lathe" },
                { code: "M3210", family: "5-axis mill" }, { code: "M7301", family: "assembly bench" },
            ], ArrayType(MachineType));
            const noMembers = $.const([], ArrayType(Sheet.Types.Member));
            const rows = $.let(East.Array.generate(60n, JobType, (_$, i) => ({
                id: East.str`j${i}`,
                start: some(East.value(new Date("2026-02-02T00:00:00Z"), DateTimeType).addDays(i.multiply(3n))),
                activity: activities.get(i.remainder(5n)),
                notes: i.remainder(7n).equal(0n).ifElse((_$2) => "urgent — inspect before shipping", (_$2) => East.str`lot ${i.add(100n)}`),
                // Machining runs name a count of lathes; the rest a machine by code.
                stations: i.remainder(5n).equal(0n).ifElse(
                    (_$2) => East.value({ from: noMembers, to: [variant("counted", { n: i.remainder(3n).add(2n), key: "CNC lathe" })] }, Sheet.Types.Link),
                    (_$2) => East.value({ from: noMembers, to: [variant("identified", { key: machines.get(i.remainder(5n)).code })] }, Sheet.Types.Link)),
                status: words.get(i.remainder(3n)),
                qty: some(i.multiply(40n).toFloat().add(180.0)),
            })), ArrayType(JobType));
            // The Link is searched through its display form — `3 x CNC lathe`, `M7301` — not its `.east` text.
            const cfg = $.const(Slice.config(JobType, {
                fields: {
                    activity: { label: "Activity", hints: ["Machining", "Painting", "Packaging", "Changeover", "Maintenance"] },
                    notes:    { label: "Notes" },
                    stations: { label: "Work centres", text: r => Sheet.link.print(r.stations) },
                    status:   { label: "Status" },
                },
                searchFieldIds: ["activity", "notes", "stations"],
            }));
            const slice = $.let(Slice.bind([JobType], "sheet_lens_slice", cfg, Slice.state(), rows, none));
            const views = $.let(State.bind([ArrayType(Sheet.Types.View)], "sheet_lens_views", [
                { id: "painting", name: "PAINTING", narrowing: Slice.state({ search: some("painting") }), context: 1n, reveals: [], folds: new Map() },
                { id: "lathes", name: "LATHES", narrowing: Slice.state({ search: some("lathe") }), context: 0n, reveals: [], folds: new Map() },
                { id: "urgent", name: "URGENT", narrowing: Slice.state({ search: some("urgent") }), context: 0n, reveals: [], folds: new Map() },
            ]));
            return (
                <Sheet
                    data={rows}
                    id="id"
                    registers={{
                        stations: Sheet.register.concat([
                            Sheet.register.members(machines, { kind: "machine", key: m => m.code, label: m => m.code, meta: m => some(m.family) }),
                            Sheet.register.members(machines, { kind: "family", key: m => m.family, label: m => m.family, meta: _m => some("family") }),
                        ]),
                    }}
                    columns={{
                        start:    Sheet.column.date(JobType, { header: "Start", width: "96px" }),
                        activity: Sheet.column.text(JobType, { header: "Activity", width: "160px" }),
                        notes:    Sheet.column.text(JobType, { header: "Notes", sub: "free text", width: "240px" }),
                        stations: Sheet.column.set(JobType, "stations", { header: "Work centres", sub: "3 x lathe · machine", width: "220px",
                                      members: [{ kind: "machine", identified: true }, { kind: "family", countable: true, resolvesTo: "machine" }] }),
                        status:   Sheet.column.text(JobType, { header: "Status", width: "120px" }),
                        qty:      Sheet.column.quantity(JobType, { header: "Qty", width: "112px", format: Format.Number({ maximumFractionDigits: 0n }) }),
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

/**
 * Write-back (§3.7) — the raw `onEdit` channel observing every commit,
 * insert and remove with its provenance, beside `onUpdate` writing the whole
 * collection; a staged bind holds changes until they are applied.
 */
export const sheetWriteBack = example({
    keywords: ["Sheet", "Root", "onEdit", "onUpdate", "write-back", "commit", "insert", "remove", "source", "provenance", "Edit", "staged", "newRowId", "Reactive", "State"],
    description: "Write-back — the raw onEdit event channel logging commit / insert / remove with provenance, beside onUpdate writing the whole collection, and a host-minted row id",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const JobType = StructType({ id: StringType, task: StringType, qty: OptionType(FloatType), createdBy: StringType });
            const jobs = $.let(State.bind([ArrayType(JobType)], "sheet_writeback_rows", [
                { id: "j1", task: "Machining", qty: some(1200.0), createdBy: "planner" },
                { id: "j2", task: "Painting", qty: none, createdBy: "planner" },
            ]));
            const log = $.let(State.bind([ArrayType(StringType)], "sheet_writeback_log", []));
            const counter = $.let(State.bind([IntegerType], "sheet_writeback_counter", 3n));
            // The raw channel — the row AFTER the commit, typed over the host's
            // struct: `createdBy` has no column, and still reads its real value.
            const onEdit = $.const(East.function([Sheet.Types.Edit(JobType)], NullType, ($, e) => {
                const line = $.let(e.match({
                    commit: (_$, c) => East.str`commit ${c.rowId}.${c.key} (${c.source.getTag()}) · ${c.row.task} · by ${c.row.createdBy}`,
                    insert: (_$, i) => East.str`insert ${i.row.id} after ${i.afterRowId.match({ some: (_$2, a) => a, none: (_$2) => "end" })}`,
                    remove: (_$, r) => East.str`remove ${r.rowIds.stringJoin(", ")}`,
                }));
                $(log.write(log.read().concat([line])));
            }));
            // The host mints ids for inserted rows.
            const newRowId = $.const(East.function([], StringType, ($) => {
                const n = $.let(counter.read());
                $(counter.write(n.add(1n)));
                return East.str`j${n}`;
            }));
            const entries = $.let(log.read());
            return (
                <VStack gap="3" align="stretch">
                    <Sheet
                        data={jobs.read()}
                        id="id"
                        columns={{
                            task: Sheet.column.text(JobType, { header: "Task", width: "200px" }),
                            qty:  Sheet.column.quantity(JobType, { header: "Qty", width: "112px" }),
                        }}
                        onEdit={onEdit}
                        onUpdate={jobs.write}
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

/**
 * The paged arm (§3.13) — the same tag over a windowed source: windows land
 * as the planner scrolls, the footer carries the transport line, the blank
 * tail appears once the source is exhausted, search is a key search over
 * `seek`, and edits go through `onEdit` to the host's journal.
 */
export const sheetPaged = example({
    keywords: ["Sheet", "Root", "paged", "Paged", "of", "window", "page", "seek", "key search", "transport", "partial", "exhausted", "onEdit", "journal", "row-source", "Reactive", "State"],
    description: "A paged sheet — the same tag over a Paged.of source keyed by id: windows land on scroll, the footer counts elements, key search seeks the source, and edits go to the host's journal through onEdit",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const JobType = StructType({ id: StringType, start: OptionType(DateTimeType), task: StringType, qty: OptionType(FloatType) });
            // Six hundred rows behind a source that windows them — keyed by id,
            // which sorts as the sheet reads, so `seek` addresses real rows.
            const rows = $.const(East.Array.generate(600n, JobType, (_$, i) => ({
                id: East.str`J${i.add(1000n)}`,
                start: some(East.value(new Date("2026-01-05T00:00:00Z"), DateTimeType).addDays(i)),
                task: i.remainder(3n).equal(0n).ifElse((_$2) => "Machining", (_$2) => i.remainder(3n).equal(1n).ifElse((_$3) => "Painting", (_$3) => "Packaging")),
                qty: some(i.multiply(15n).toFloat().add(180.0)),
            })), ArrayType(JobType));
            const source = $.const(Paged.of("sheet_paged_jobs", rows, { key: r => r.id }));   // Data.bindPaged(planInput) in e3-ui
            const edits = $.let(State.bind([ArrayType(Sheet.Types.Edit(JobType))], "sheet_paged_edits", []));
            const applyEdit = $.const(East.function([Sheet.Types.Edit(JobType)], NullType, ($, e) => {
                $(edits.write(edits.read().concat([e])));   // the host's edit journal, replayed server-side
            }));
            const journal = $.let(edits.read());
            return (
                <VStack gap="3" align="stretch">
                    <Sheet
                        data={source}
                        id="id"
                        columns={{
                            start: Sheet.column.date(JobType, { header: "Start", width: "96px" }),
                            task:  Sheet.column.text(JobType, { header: "Task", width: "180px" }),
                            qty:   Sheet.column.quantity(JobType, { header: "Qty", width: "112px", format: Format.Number({ maximumFractionDigits: 0n }) }),
                        }}
                        onEdit={applyEdit}
                        style={{ height: "420px" }}
                    />
                    <Text.MonoLabel>{East.str`JOURNAL · ${journal.length()} edits`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Stress — two thousand rows, every column virtualised, the copilot's
 * history fill reasoning over the resident sheet.
 */
export const sheetStress = example({
    keywords: ["Sheet", "Root", "stress", "virtualization", "2000", "rows", "performance", "fill", "history", "Reactive", "State"],
    description: "Two thousand rows in one sheet — virtualised rows, typed columns, and a history fill that reads the whole resident sheet",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const JobType = StructType({ id: StringType, start: OptionType(DateTimeType), task: StringType, qty: OptionType(FloatType), notes: StringType });
            const Ctx = Sheet.Types.Context(JobType);
            const tasks = $.const(["Machining", "Painting", "Packaging", "Changeover", "Maintenance", "Receiving", "Shipping"], ArrayType(StringType));
            const rows = $.let(State.bind([ArrayType(JobType)], "sheet_stress_rows", East.Array.generate(2000n, JobType, (_$, i) => ({
                id: East.str`S${i}`,
                start: some(East.value(new Date("2026-01-05T00:00:00Z"), DateTimeType).addDays(i.divide(4n))),
                task: tasks.get(i.remainder(7n)),
                qty: i.remainder(11n).equal(0n).ifElse((_$2) => East.value(none, OptionType(FloatType)), (_$2) => East.value(some(i.multiply(7n).toFloat().add(50.0)), OptionType(FloatType))),
                notes: "",
            }))));
            const FloatFill = OptionType(Sheet.Types.Fill(FloatType));
            const lastQty = $.const(East.function([Ctx], FloatFill, ($, ctx) => {
                const noFill = $.const(none, FloatFill);
                const similar = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) => r.task.equal(ctx.row.task).and(() => r.qty.hasTag("some"))));
                return similar.length().equal(0n).ifElse(
                    (_$) => noFill,
                    ($2) => {
                        const r = $2.let(similar.get(similar.length().subtract(1n)));
                        return East.value(some({ value: r.qty.unwrap("some"), meta: East.str`like ${r.id}` }), FloatFill);
                    });
            }));
            return (
                <Sheet
                    data={rows.read()}
                    id="id"
                    columns={{
                        start: Sheet.column.date(JobType, { header: "Start", width: "96px" }),
                        task:  Sheet.column.text(JobType, { header: "Task", width: "160px" }),
                        qty:   Sheet.column.quantity(JobType, { header: "Qty", width: "112px", format: Format.Number({ maximumFractionDigits: 0n }), fill: [lastQty] }),
                        notes: Sheet.column.text(JobType, { header: "Notes", width: "240px" }),
                    }}
                    onUpdate={rows.write}
                    footer={[{ text: "2000 rows · virtualised" }]}
                    style={{ height: "480px" }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
