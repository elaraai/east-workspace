/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, DateTimeType, FloatType, NullType, OptionType, StringType, StructType, none, some, variant, example } from "@elaraai/east";
import { DragEventType, State, Style, UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Configurator, Gantt, HStack, Library, Reactive, SegmentGroup, Switch, Table, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures (consolidation epic #455, pass 4).
// ============================================================================

/** One row shape for every configurator preset — tasks, lifecycle states,
 *  risk statuses, milestones and styled labels all travel as plain data so
 *  ONE rowSpec serves every preset. `state` is the lifecycle tag; `status`
 *  is "" for none; a `some` milestone renders its diamond. */
const GANTT_ROW = StructType({
    name: StringType,
    start: DateTimeType,
    end: DateTimeType,
    progress: FloatType,
    state: StringType,
    status: StringType,
    styled: BooleanType,
    milestone: OptionType(StructType({ date: DateTimeType, label: StringType, release: BooleanType })),
});

const GANTT_QUARTER_ROWS = [
    { name: "Platform", start: new Date("2024-01-01"), end: new Date("2024-09-30"), progress: 60.0, state: "added", status: "", styled: false, milestone: none },
    { name: "Mobile", start: new Date("2024-06-01"), end: new Date("2025-03-31"), progress: 35.0, state: "added", status: "", styled: false, milestone: none },
    { name: "Analytics", start: new Date("2025-01-01"), end: new Date("2025-12-31"), progress: 10.0, state: "added", status: "", styled: false, milestone: none },
];
const GANTT_WEEK_ROWS = [
    { name: "Spec", start: new Date("2024-04-01"), end: new Date("2024-04-05"), progress: 100.0, state: "committed", status: "", styled: false, milestone: none },
    { name: "Implement", start: new Date("2024-04-04"), end: new Date("2024-04-18"), progress: 55.0, state: "added", status: "", styled: false, milestone: none },
    { name: "Review", start: new Date("2024-04-17"), end: new Date("2024-04-24"), progress: 0.0, state: "added", status: "", styled: false, milestone: none },
];
const GANTT_MILESTONE_ROWS = [
    { name: "Sprint 1", start: new Date("2024-01-01"), end: new Date("2024-01-14"), progress: 100.0, state: "committed", status: "", styled: false, milestone: some({ date: new Date("2024-01-14"), label: "Checkpoint", release: false }) },
    { name: "Sprint 2", start: new Date("2024-01-15"), end: new Date("2024-01-28"), progress: 70.0, state: "added", status: "", styled: false, milestone: some({ date: new Date("2024-01-28"), label: "Checkpoint", release: false }) },
    { name: "Sprint 3", start: new Date("2024-01-29"), end: new Date("2024-02-11"), progress: 20.0, state: "added", status: "", styled: false, milestone: some({ date: new Date("2024-02-11"), label: "Release", release: true }) },
];
const GANTT_PROGRESS_ROWS = [
    { name: "Backend API", start: new Date("2024-01-01"), end: new Date("2024-02-15"), progress: 100.0, state: "added", status: "", styled: false, milestone: none },
    { name: "Frontend UI", start: new Date("2024-01-15"), end: new Date("2024-03-01"), progress: 75.0, state: "added", status: "", styled: false, milestone: none },
    { name: "Integration", start: new Date("2024-02-01"), end: new Date("2024-03-15"), progress: 40.0, state: "added", status: "", styled: false, milestone: none },
    { name: "QA Testing", start: new Date("2024-02-15"), end: new Date("2024-04-01"), progress: 10.0, state: "added", status: "", styled: false, milestone: none },
];
const GANTT_LABEL_ROWS = [
    { name: "Plain label", start: new Date("2024-01-01"), end: new Date("2024-01-15"), progress: 0.0, state: "added", status: "", styled: false, milestone: none },
    { name: "Styled label", start: new Date("2024-01-20"), end: new Date("2024-02-05"), progress: 0.0, state: "added", status: "", styled: true, milestone: none },
];
const GANTT_LIFECYCLE_ROWS = [
    { name: "Baseline build", start: new Date("2024-01-01"), end: new Date("2024-01-24"), progress: 100.0, state: "committed", status: "", styled: false, milestone: none },
    { name: "Operator draft", start: new Date("2024-01-08"), end: new Date("2024-02-02"), progress: 40.0, state: "added", status: "", styled: false, milestone: none },
    { name: "Model suggestion", start: new Date("2024-01-15"), end: new Date("2024-02-10"), progress: 0.0, state: "model", status: "", styled: false, milestone: none },
    { name: "Proposed cut", start: new Date("2024-01-05"), end: new Date("2024-01-30"), progress: 60.0, state: "removed", status: "", styled: false, milestone: none },
    { name: "Declined plan", start: new Date("2024-01-20"), end: new Date("2024-02-14"), progress: 20.0, state: "rejected", status: "", styled: false, milestone: none },
];
// The #262 two-axis grammar: lifecycle state + an orthogonal risk tint.
const GANTT_STATUS_ROWS = [
    { name: "User Auth", start: new Date("2024-01-01"), end: new Date("2024-01-20"), progress: 100.0, state: "committed", status: "success", styled: false, milestone: none },
    { name: "Login Issue", start: new Date("2024-01-10"), end: new Date("2024-01-15"), progress: 20.0, state: "added", status: "danger", styled: false, milestone: none },
    { name: "Performance", start: new Date("2024-01-15"), end: new Date("2024-02-01"), progress: 55.0, state: "added", status: "info", styled: false, milestone: none },
    { name: "Dashboard", start: new Date("2024-01-20"), end: new Date("2024-02-15"), progress: 90.0, state: "committed", status: "success", styled: false, milestone: none },
];
const GANTT_STRESS_ROWS = East.Array.range(0n, 200n).map((_$, i) => ({
    name: East.str`Task ${i}`,
    start: East.value(new Date("2024-01-01T00:00:00Z")).addDays(i.multiply(3n)),
    end: East.value(new Date("2024-01-01T00:00:00Z")).addDays(i.multiply(3n).add(14n)),
    progress: i.remainder(100n).toFloat(),
    state: "added",
    status: "",
    styled: false,
    milestone: East.value(none, OptionType(StructType({ date: DateTimeType, label: StringType, release: BooleanType }))),
}));

export const ganttBasic = example({
    keywords: ["Gantt", "Root", "Task", "basic", "timeline"],
    description: "Simple project timeline with tasks",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Gantt
                data={[
                    { task: "Planning", owner: "Alice", start: new Date("2024-01-01"), end: new Date("2024-01-15") },
                    { task: "Design", owner: "Bob", start: new Date("2024-01-10"), end: new Date("2024-02-01") },
                    { task: "Development", owner: "Charlie", start: new Date("2024-01-20"), end: new Date("2024-03-15") },
                    { task: "Testing", owner: "Diana", start: new Date("2024-03-01"), end: new Date("2024-03-30") },
                ]}
                columns={["task", "owner"]}
                rowSpec={row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })}
            />
        );
    }),
    inputs: [],
});

/**
 * THE Gantt configurator (pass 4) — one preset axis spans the surface: the
 * now-centred window, the quarter roadmap and week sprint windows, milestone
 * diamonds, progress fills, styled labels, the five lifecycle treatments,
 * the #262 state + status grammar, a 200-row stress window and the #320 fill
 * contract. Every preset is DATA ({window, tier, format, header, rows}
 * through one expression-fed axis + ONE rowSpec over the superset row), so
 * only row-height presence (auto vs pixel) and the bounded-fill Box are
 * prebuilt arms. Variant / density / striped / today compose across every
 * preset; all eleven callbacks (and the ONE onDrag grammar funnel) log to
 * the aside.
 */
export const ganttVariants = example({
    keywords: ["Gantt", "Task", "Milestone", "kind", "interim", "release", "progress", "label", "LabelInput", "align", "fontWeight", "fontStyle", "state", "status", "committed", "added", "model", "removed", "rejected", "lifecycle", "risk", "tint", "variant", "line", "outline", "striped", "showToday", "density", "rowHeight", "axis", "window", "tier", "quarter", "week", "month", "format", "roadmap", "sprint", "stress", "fill", "height", "#320", "virtual", "popover", "click", "Reactive", "State", "onTaskClick", "onTaskDrag", "onMilestoneClick", "onDrag", "interactive", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Gantt configurator — a preset axis over window, milestone, progress, label, lifecycle, status, stress and fill demos plus variant, density, row-height, striped and today controls; every callback logs to the aside",
    fn: East.function([], UIComponentType, (_$) => {
        const day = 24 * 60 * 60 * 1000;
        return (
        <Reactive>{$ => {
            const presetKeys = $.const([
                "today", "quarter", "week", "milestones", "progress",
                "labels", "lifecycle", "status", "stress", "fill",
            ], ArrayType(StringType));
            const variants = $.const([variant("line", null), variant("outline", null)], ArrayType(Table.Types.Variant));
            const densities = $.const([
                variant("condensed", null), variant("compact", null), variant("comfortable", null),
            ], ArrayType(Style.Types.Density));
            const rowHeights = $.const(["auto", "36", "44"], ArrayType(StringType));

            // The now-centred rows keep `Date.now()` in-body (the
            // no-build-time-clock rule).
            const todayRows = $.const([
                { name: "Platform v2", start: new Date(Date.now() - 60 * day), end: new Date(Date.now() + 60 * day), progress: 50.0, state: "added", status: "", styled: false, milestone: some({ date: new Date(Date.now() + 60 * day), label: "Release", release: true }) },
                { name: "UI Refresh", start: new Date(Date.now() - 45 * day), end: new Date(Date.now() + 15 * day), progress: 70.0, state: "added", status: "", styled: false, milestone: none },
                { name: "CI/CD Pipeline", start: new Date(Date.now() - 20 * day), end: new Date(Date.now() + 30 * day), progress: 30.0, state: "added", status: "", styled: false, milestone: none },
                { name: "Test Automation", start: new Date(Date.now() - 10 * day), end: new Date(Date.now() + 75 * day), progress: 10.0, state: "added", status: "", styled: false, milestone: none },
            ], ArrayType(GANTT_ROW));

            const stressRows = $.const(GANTT_STRESS_ROWS, ArrayType(GANTT_ROW));

            // Every preset is data: window + tier + format + header + rows.
            const presets = $.const([
                { key: "today", min: new Date(Date.now() - 75 * day), max: new Date(Date.now() + 90 * day), tier: variant("month", null), format: "MMM", header: "Project", rows: todayRows },
                { key: "quarter", min: new Date("2024-01-01"), max: new Date("2025-12-31"), tier: variant("quarter", null), format: "MMM YYYY", header: "Epic", rows: GANTT_QUARTER_ROWS },
                { key: "week", min: new Date("2024-04-01"), max: new Date("2024-04-26"), tier: variant("week", null), format: "MMM DD", header: "Task", rows: GANTT_WEEK_ROWS },
                { key: "milestones", min: new Date("2023-12-28"), max: new Date("2024-02-18"), tier: variant("week", null), format: "MMM DD", header: "Sprint", rows: GANTT_MILESTONE_ROWS },
                { key: "progress", min: new Date("2023-12-28"), max: new Date("2024-04-08"), tier: variant("month", null), format: "MMM", header: "Task", rows: GANTT_PROGRESS_ROWS },
                { key: "labels", min: new Date("2023-12-28"), max: new Date("2024-02-12"), tier: variant("week", null), format: "MMM DD", header: "Row", rows: GANTT_LABEL_ROWS },
                { key: "lifecycle", min: new Date("2023-12-28"), max: new Date("2024-02-21"), tier: variant("week", null), format: "MMM DD", header: "State", rows: GANTT_LIFECYCLE_ROWS },
                { key: "status", min: new Date("2023-12-28"), max: new Date("2024-02-21"), tier: variant("week", null), format: "MMM DD", header: "Name", rows: GANTT_STATUS_ROWS },
                { key: "stress", min: new Date("2023-12-01"), max: new Date("2025-10-01"), tier: variant("quarter", null), format: "MMM YYYY", header: "Task", rows: stressRows },
                { key: "fill", min: new Date("2023-12-01"), max: new Date("2025-10-01"), tier: variant("quarter", null), format: "MMM YYYY", header: "Task", rows: stressRows },
            ], ArrayType(StructType({ key: StringType, min: DateTimeType, max: DateTimeType, tier: Gantt.Types.Tier, format: StringType, header: StringType, rows: ArrayType(GANTT_ROW) })));

            const presetBind = $.let(State.bind([StringType], "gantt_preset", "today"));
            const variantBind = $.let(State.bind([StringType], "gantt_variant", "line"));
            const densityBind = $.let(State.bind([StringType], "gantt_density", "compact"));
            const rhBind = $.let(State.bind([StringType], "gantt_rowheight", "auto"));
            const stripedBind = $.let(State.bind([BooleanType], "gantt_striped", true));
            const todayBind = $.let(State.bind([BooleanType], "gantt_showtoday", true));
            const lastEventBind = $.let(State.bind([StringType], "gantt_last_event", ""));

            const pKey = $.let(presetBind.read());
            const vKey = $.let(variantBind.read());
            const dKey = $.let(densityBind.read());
            const rhKey = $.let(rhBind.read());
            const stripedOn = $.let(stripedBind.read());
            const todayOn = $.let(todayBind.read());
            const lastEvent = $.let(lastEventBind.read());

            const onPreset = $.const(East.function([StringType], NullType, ($, next) => { $(presetBind.write(next)); }));
            const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const onRowHeight = $.const(East.function([StringType], NullType, ($, next) => { $(rhBind.write(next)); }));
            const onStriped = $.const(East.function([BooleanType], NullType, ($, next) => { $(stripedBind.write(next)); }));
            const onToday = $.const(East.function([BooleanType], NullType, ($, next) => { $(todayBind.write(next)); }));

            // The interactive surface — every callback writes the event line
            // the aside shows.
            const onRowClick = $.const(East.function([Table.Types.RowClickEvent], NullType, ($, event) => {
                $(lastEventBind.write(East.str`onRowClick: row ${event.rowIndex}`));
            }));
            const onRowDoubleClick = $.const(East.function([Table.Types.RowClickEvent], NullType, ($, event) => {
                $(lastEventBind.write(East.str`onRowDoubleClick: row ${event.rowIndex}`));
            }));
            const onCellClick = $.const(East.function([Table.Types.CellClickEvent], NullType, ($, event) => {
                $(lastEventBind.write(East.str`onCellClick: row ${event.rowIndex}, col ${event.columnKey}`));
            }));
            const onCellDoubleClick = $.const(East.function([Table.Types.CellClickEvent], NullType, ($, event) => {
                $(lastEventBind.write(East.str`onCellDoubleClick: row ${event.rowIndex}, col ${event.columnKey}`));
            }));
            const onSortChange = $.const(East.function([Table.Types.SortEvent], NullType, ($, event) => {
                $(lastEventBind.write(East.str`onSortChange: ${event.columnKey} - ${event.sortDirection.getTag()}`));
            }));
            const onTaskClick = $.const(East.function([Gantt.Types.TaskClickEvent], NullType, ($, event) => {
                $(lastEventBind.write(East.str`onTaskClick: row ${event.rowIndex}, task ${event.taskIndex}`));
            }));
            const onTaskDoubleClick = $.const(East.function([Gantt.Types.TaskClickEvent], NullType, ($, event) => {
                $(lastEventBind.write(East.str`onTaskDoubleClick: row ${event.rowIndex}, task ${event.taskIndex}`));
            }));
            // ONE grammar funnel (#268): task-body drags arrive as `move`,
            // edge drags as `resize`, Library drops as `add`.
            const onDrag = $.const(East.function([DragEventType], NullType, ($, event) => {
                $.match(event, {
                    move: ($, mv) => { $(lastEventBind.write(East.str`onDrag move: ${mv.from.row}/${mv.from.event.getTag()} → ${mv.to.slot}`)); },
                    resize: ($, rz) => { $(lastEventBind.write(East.str`onDrag resize: ${rz.event.row} ${rz.edge.getTag()} edge → ${rz.event.slot}`)); },
                    add: ($, add) => { $(lastEventBind.write(East.str`onDrag add: ${add.from.key} → row ${add.into.row}`)); },
                    remove: ($, rm) => { $(lastEventBind.write(East.str`onDrag remove: ${rm.from.row}`)); },
                });
            }));
            const onTaskProgressChange = $.const(East.function([Gantt.Types.TaskProgressChangeEvent], NullType, ($, event) => {
                $(lastEventBind.write(East.str`onTaskProgressChange: row ${event.rowIndex}, task ${event.taskIndex}, progress ${event.newProgress}`));
            }));
            const onMilestoneClick = $.const(East.function([Gantt.Types.MilestoneClickEvent], NullType, ($, event) => {
                $(lastEventBind.write(East.str`onMilestoneClick: row ${event.rowIndex}, milestone ${event.milestoneIndex}`));
            }));
            const onMilestoneDoubleClick = $.const(East.function([Gantt.Types.MilestoneClickEvent], NullType, ($, event) => {
                $(lastEventBind.write(East.str`onMilestoneDoubleClick: row ${event.rowIndex}, milestone ${event.milestoneIndex}`));
            }));

            const sel = $.let(presets.filter((_$, o) => o.key.equal(pKey)).get(0n, _$ => presets.get(0n)));
            const variantSel = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
            const densitySel = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));
            const rhPx = $.let(rhKey.equal("36").ifElse(_$ => 36n, _$ => 44n));

            // ONE rowSpec over the superset row: lifecycle state, risk status,
            // milestone diamonds and the styled label all come off row fields.
            const stateOf = $.const(East.function([StringType], Gantt.Types.State, (_$, tag) =>
                tag.equal("committed").ifElse(
                    _$ => variant("committed", null),
                    _$ => tag.equal("rejected").ifElse(
                        _$ => variant("rejected", null),
                        _$ => tag.equal("model").ifElse(
                            _$ => variant("proposed", variant("model", null)),
                            _$ => tag.equal("removed").ifElse(
                                _$ => variant("proposed", variant("removed", null)),
                                _$ => variant("proposed", variant("added", null)),
                            ),
                        ),
                    ),
                )));
            const statusOf = $.const(East.function([StringType], Gantt.Types.Status, (_$, tag) =>
                tag.equal("success").ifElse(
                    _$ => East.value(variant("success", null), Gantt.Types.Status),
                    _$ => tag.equal("danger").ifElse(
                        _$ => East.value(variant("danger", null), Gantt.Types.Status),
                        _$ => East.value(variant("info", null), Gantt.Types.Status),
                    ),
                )));

            const noMilestones = $.const([], ArrayType(Gantt.Types.Milestone));

            const armAuto = $.const(
                <Gantt
                    id="gantt-live"
                    variant={variantSel}
                    striped={stripedOn}
                    showToday={todayOn}
                    density={densitySel}
                    axis={{ range: { min: sel.min, max: sel.max }, tier: sel.tier, format: sel.format }}
                    onRowClick={onRowClick}
                    onRowDoubleClick={onRowDoubleClick}
                    onCellClick={onCellClick}
                    onCellDoubleClick={onCellDoubleClick}
                    onSortChange={onSortChange}
                    onTaskClick={onTaskClick}
                    onTaskDoubleClick={onTaskDoubleClick}
                    onDrag={onDrag}
                    onTaskProgressChange={onTaskProgressChange}
                    onMilestoneClick={onMilestoneClick}
                    onMilestoneDoubleClick={onMilestoneDoubleClick}
                    data={sel.rows}
                    columns={{ name: { header: sel.header, width: "180px" } }}
                    rowSpec={row => ({
                        tasks: row.styled.ifElse(
                            _$ => [Gantt.Task({
                                start: row.start, end: row.end,
                                label: { value: row.name, align: "center", verticalAlign: "center", color: "fg.warning", fontWeight: "bold", fontStyle: "italic" },
                                progress: row.progress, state: stateOf(row.state),
                            })],
                            _$ => row.status.equal("").ifElse(
                                _$ => [Gantt.Task({
                                    start: row.start, end: row.end, label: row.name,
                                    progress: row.progress, state: stateOf(row.state),
                                    popover: (
                                        <VStack gap="2">
                                            <Text fontWeight="bold">{row.name}</Text>
                                            <Text>{East.str`From ${row.start} to ${row.end}`}</Text>
                                        </VStack>
                                    ),
                                })],
                                _$ => [Gantt.Task({
                                    start: row.start, end: row.end, label: row.name,
                                    progress: row.progress, state: stateOf(row.state), status: statusOf(row.status),
                                })],
                            ),
                        ),
                        milestones: row.milestone.match({
                            some: (_$, m) => [Gantt.Milestone({
                                date: m.date, label: m.label,
                                kind: m.release.ifElse(_$ => variant("release", null), _$ => variant("interim", null)),
                            })],
                            none: (_$) => noMilestones,
                        }),
                    })}
                />,
            );
            const armPx = $.const(
                <Gantt
                    id="gantt-live"
                    variant={variantSel}
                    striped={stripedOn}
                    showToday={todayOn}
                    density={densitySel}
                    rowHeight={rhPx}
                    axis={{ range: { min: sel.min, max: sel.max }, tier: sel.tier, format: sel.format }}
                    onRowClick={onRowClick}
                    onRowDoubleClick={onRowDoubleClick}
                    onCellClick={onCellClick}
                    onCellDoubleClick={onCellDoubleClick}
                    onSortChange={onSortChange}
                    onTaskClick={onTaskClick}
                    onTaskDoubleClick={onTaskDoubleClick}
                    onDrag={onDrag}
                    onTaskProgressChange={onTaskProgressChange}
                    onMilestoneClick={onMilestoneClick}
                    onMilestoneDoubleClick={onMilestoneDoubleClick}
                    data={sel.rows}
                    columns={{ name: { header: sel.header, width: "180px" } }}
                    rowSpec={row => ({
                        tasks: row.status.equal("").ifElse(
                            _$ => [Gantt.Task({
                                start: row.start, end: row.end, label: row.name,
                                progress: row.progress, state: stateOf(row.state),
                            })],
                            _$ => [Gantt.Task({
                                start: row.start, end: row.end, label: row.name,
                                progress: row.progress, state: stateOf(row.state), status: statusOf(row.status),
                            })],
                        ),
                        milestones: row.milestone.match({
                            some: (_$, m) => [Gantt.Milestone({
                                date: m.date, label: m.label,
                                kind: m.release.ifElse(_$ => variant("release", null), _$ => variant("interim", null)),
                            })],
                            none: (_$) => noMilestones,
                        }),
                    })}
                />,
            );
            // FILL (#320) — height="fill" resolves against the bounded Box and
            // virtualizes the 200 rows.
            const armFill = $.const(
                <Box height="220px">
                    <Gantt
                        variant={variantSel}
                        striped={stripedOn}
                        density={densitySel}
                        height="fill"
                        axis={{ range: { min: sel.min, max: sel.max }, tier: sel.tier, format: sel.format }}
                        data={sel.rows}
                        columns={{ name: { header: sel.header, width: "150px" } }}
                        rowSpec={row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })}
                    />
                </Box>,
            );

            const preview = $.const(pKey.equal("fill").ifElse(
                _$ => armFill,
                _$ => rhKey.equal("auto").ifElse(_$ => armAuto, _$ => armPx),
            ), UIComponentType);

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Preset", pKey,
                            <SegmentGroup value={pKey} onChange={onPreset} size="sm"
                                items={presetKeys.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                        Configurator.Control("Variant", vKey,
                            <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Row height", rhKey,
                            <SegmentGroup value={rhKey} onChange={onRowHeight} size="sm"
                                items={rowHeights.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                        Configurator.Slot("Chrome",
                            <HStack gap="5" align="center">
                                <Switch checked={stripedOn} label="Striped" onChange={onStriped} />
                                <Switch checked={todayOn} label="Today" onChange={onToday} />
                            </HStack>),
                    ]}
                    preview={preview}
                    aside={{
                        label: "Events · Reactive",
                        body: (
                            <Badge colorPalette="brand" variant="outline">
                                {East.equal(lastEvent.length(), 0n).ifElse(_$ => "Interact with the Gantt chart", _$ => lastEvent)}
                            </Badge>
                        ),
                    }}
                    spec={[
                        Configurator.Spec("Tier", sel.tier.getTag()),
                        Configurator.Spec("Rows", East.print(sel.rows.size())),
                        Configurator.Spec("Row height", rhKey.equal("auto").ifElse(_$ => "density", _$ => East.str`${rhKey}px`)),
                    ]}
                />
            );
        }}</Reactive>
        );
    }),
    inputs: [],
});

export const ganttReactiveDrag = example({
    keywords: ["Gantt", "Reactive", "State", "onDrag", "move", "drag", "dragStep", "grammar"],
    description: "Drag task to update state via the shared grammar — the move event's to.slot is the snapped ISO instant; position persists after re-render",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const taskStartBind = $.let(State.bind([DateTimeType], "gantt_task_start", new Date("2024-01-15")));
            const taskStart = $.let(taskStartBind.read());
            const taskEnd = $.let(taskStart.addDays(14));
            const onDrag = $.const(East.function([DragEventType], NullType, ($, event) => {
                $.match(event, {
                    // The grammar move: `to.slot` carries the snapped ISO
                    // instant the bar landed on (component-owned snapping).
                    move: ($, mv) => { $(taskStartBind.write(mv.to.slot.parse(DateTimeType))); },
                });
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Gantt
                        id="gantt-drag"
                        onDrag={onDrag}
                        dragStep={variant("days", 1)}
                        durationStep={variant("days", 1)}
                        data={[{ name: "Draggable Task" }]}
                        columns={{ name: { header: "Task" } }}
                        rowSpec={_row => ({
                            tasks: [Gantt.Task({
                                start: taskStart,
                                end: taskEnd,
                                label: "Drag me!",
                                // proposed so the bar is editable (the ⠿ grip shows);
                                // committed bars are locked per spec.
                                state: "added",
                            })],
                        })}
                    />
                    <Text textStyle="body-sm" color="fg.muted">{East.str`Start: ${taskStart}`}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Review chrome (#263) — the shared per-row Approve / Reject decision column
 * (sticky beside the timeline) plus the commitBar batch foot, identical to
 * the Planner's. A machine-written schedule under review: model-ghost bars
 * on flagged rows resting `pending` (quiet warning dot), clean rows resting
 * `approved`. Callbacks receive the acted-on `{ rowIndex }`.
 */
export const ganttReview = example({
    keywords: ["Gantt", "review", "approve", "reject", "approval", "decision", "batch", "rerun", "status", "row", "model"],
    description: "Optional per-row approval on a machine-written schedule — Decision column + batch foot, model-ghost bars on flagged pending rows",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Gantt
                data={[
                    { name: "Press retool", crew: "Crew A", flagged: false, start: new Date("2024-01-02"), end: new Date("2024-01-12") },
                    { name: "Line balance", crew: "Crew B", flagged: true, start: new Date("2024-01-08"), end: new Date("2024-01-22") },
                    { name: "Paint refit", crew: "Crew C", flagged: false, start: new Date("2024-01-15"), end: new Date("2024-01-29") },
                    { name: "QA sweep", crew: "Crew A", flagged: true, start: new Date("2024-01-24"), end: new Date("2024-02-06") },
                ]}
                columns={{ name: { header: "Job" }, crew: { header: "Crew" } }}
                rowSpec={row => ({
                    tasks: [Gantt.Task({
                        start: row.start,
                        end: row.end,
                        label: row.name,
                        // The machine's suggestion on flagged rows renders as the
                        // dashed model ghost; clean rows are operator drafts.
                        state: East.value(row.flagged.ifElse(
                            _$ => variant("proposed", variant("model", null)),
                            _$ => variant("proposed", variant("added", null)),
                        ), Gantt.Types.State),
                    })],
                    status: row.flagged.ifElse(() => some(variant("warning", null)), () => none),
                    approval: row.flagged.ifElse(() => some(variant("pending", null)), () => some(variant("approved", null))),
                })}
                review={{
                    columnLabel: "Decision",
                    rerunLabel: "Rerun",
                    summary: <Text color="fg.muted">4 jobs · 2 flagged need a call · +6h float</Text>,
                    onApprove: East.function([Gantt.Types.ApproveEvent], NullType, _$ => null),
                    onReject: East.function([Gantt.Types.ApproveEvent], NullType, _$ => null),
                    onApproveAll: East.function([], NullType, _$ => null),
                    onRejectAll: East.function([], NullType, _$ => null),
                    onRerun: East.function([], NullType, _$ => null),
                }}
            />
        );
    }),
    inputs: [],
});

/**
 * Library → Gantt add (#268) — the Gantt registers as an ordinary drag
 * target via the shared grammar: drag a crew card anywhere onto the
 * timeline; the drop resolves to (row index key, snapped ISO instant),
 * lands as an optimistic `proposed(added)` bar, and arrives through the ONE
 * `onDrag` funnel. A `canDrop` veto (⊘ while hovering) keeps crews off the
 * committed first row.
 */
export const ganttLibraryDnd = example({
    keywords: ["Gantt", "Library", "DnD", "drag", "add", "move", "resize", "onDrag", "canDrop", "target", "proposed", "grammar"],
    description: "Library + Gantt DnD — drag a crew card onto the timeline (proposed(added) bar at the snapped instant, canDrop ⊘ on the committed row); move/resize report through the same onDrag",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const lastBind = $.let(State.bind([StringType], "gantt_last_drop", "none yet"));
            const onDrag = $.const(East.function([DragEventType], NullType, ($, event) => {
                $.match(event, {
                    add: ($, add) => { $(lastBind.write(East.str`add ${add.from.key} → row ${add.into.row} @ ${add.into.slot}`)); },
                    move: ($, mv) => { $(lastBind.write(East.str`move row ${mv.from.row} → ${mv.to.slot}`)); },
                    resize: ($, rz) => { $(lastBind.write(East.str`resize ${rz.edge.getTag()} → ${rz.event.slot}`)); },
                    remove: ($, rm) => { $(lastBind.write(East.str`remove row ${rm.from.row} → ${rm.to.getTag()}`)); },
                });
            }));
            // Row 0 is committed history — no drops land there.
            const canDrop = $.const(East.function([DragEventType], BooleanType, ($, event) =>
                event.match({
                    add: (_$, add) => add.into.row.notEqual("0"),
                    move: (_$) => East.value(true),
                    remove: (_$) => East.value(true),
                    resize: (_$) => East.value(true),
                })));
            const last = $.let(lastBind.read());
            return (
                <VStack gap="4" align="stretch">
                    <Library
                        id="crews"
                        data={[
                            { id: "crew-a", name: "Crew A", trade: "rigging" },
                            { id: "crew-b", name: "Crew B", trade: "fit-out" },
                        ]}
                        item={c => ({ key: c.id, label: c.name, sublabel: c.trade, icon: "user" })}
                    />
                    <Gantt
                        id="schedule"
                        sources={["crews"]}
                        onDrag={onDrag}
                        canDrop={canDrop}
                        dragStep={variant("days", 1)}
                        data={[
                            { name: "Baseline", start: new Date("2024-01-01"), end: new Date("2024-01-20") },
                            { name: "Fit-out", start: new Date("2024-01-10"), end: new Date("2024-02-05") },
                            { name: "Commissioning", start: new Date("2024-01-25"), end: new Date("2024-02-15") },
                        ]}
                        columns={{ name: { header: "Phase" } }}
                        rowSpec={row => ({
                            tasks: [Gantt.Task({
                                start: row.start,
                                end: row.end,
                                label: row.name,
                                state: East.value(row.name.equal("Baseline").ifElse(
                                    _$ => variant("committed", null),
                                    _$ => variant("proposed", variant("added", null)),
                                ), Gantt.Types.State),
                            })],
                        })}
                    />
                    <Text.MonoLabel>{East.str`LAST DROP · ${last}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
