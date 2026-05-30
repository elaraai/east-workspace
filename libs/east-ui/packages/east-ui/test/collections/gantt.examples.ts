/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, DateTimeType, IntegerType, NullType, StringType, variant, example } from "@elaraai/east";
import { Badge, Gantt, Reactive, Stack, State, Style, Table, Text, UIComponentType } from "@elaraai/east-ui";

export const ganttBasic = example({
    keywords: ["Gantt", "Root", "Task", "basic", "timeline"],
    description: "Simple project timeline with tasks",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { task: "Planning", owner: "Alice", start: new Date("2024-01-01"), end: new Date("2024-01-15") },
                { task: "Design", owner: "Bob", start: new Date("2024-01-10"), end: new Date("2024-02-01") },
                { task: "Development", owner: "Charlie", start: new Date("2024-01-20"), end: new Date("2024-03-15") },
                { task: "Testing", owner: "Diana", start: new Date("2024-03-01"), end: new Date("2024-03-30") },
            ],
            ["task", "owner"],
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })
        );
    }),
    inputs: [],
});

export const ganttCustomHeaders = example({
    keywords: ["Gantt", "Root", "header", "width", "minWidth", "maxWidth"],
    description: "Object config with custom column headers and widths",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { phase: "Research", team: "R&D", start: new Date("2024-02-01"), end: new Date("2024-02-28") },
                { phase: "Prototype", team: "Engineering", start: new Date("2024-02-15"), end: new Date("2024-03-31") },
                { phase: "Launch", team: "Marketing", start: new Date("2024-03-15"), end: new Date("2024-04-15") },
            ],
            {
                phase: { header: "Phase", width: "300px", minWidth: "80px" },
                team: { header: "Team", width: "150px", maxWidth: "200px" },
            },
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })
        );
    }),
    inputs: [],
});

export const ganttWithMilestones = example({
    keywords: ["Gantt", "Task", "Milestone", "kind", "interim", "release"],
    description: "Combining tasks with milestone markers — `kind` drives the diamond fill (interim = amber, release = brand teal)",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { name: "Sprint 1", start: new Date("2024-01-01"), end: new Date("2024-01-14"), checkpoint: new Date("2024-01-14"), kind: "interim" },
                { name: "Sprint 2", start: new Date("2024-01-15"), end: new Date("2024-01-28"), checkpoint: new Date("2024-01-28"), kind: "interim" },
                { name: "Sprint 3", start: new Date("2024-01-29"), end: new Date("2024-02-11"), checkpoint: new Date("2024-02-11"), kind: "release" },
            ],
            { name: { header: "Sprint" } },
            row => ({
                tasks: [Gantt.Task({ start: row.start, end: row.end })],
                milestones: [Gantt.Milestone({
                    date: row.checkpoint,
                    label: "Checkpoint",
                    kind: row.kind.equal("release").ifElse(
                        _$ => variant("release", null),
                        _$ => variant("interim", null),
                    ),
                })],
            })
        );
    }),
    inputs: [],
});

export const ganttWithProgress = example({
    keywords: ["Gantt", "Task", "progress"],
    description: "Tasks with progress indicators",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { task: "Backend API", start: new Date("2024-01-01"), end: new Date("2024-02-15"), progress: 100 },
                { task: "Frontend UI", start: new Date("2024-01-15"), end: new Date("2024-03-01"), progress: 75 },
                { task: "Integration", start: new Date("2024-02-01"), end: new Date("2024-03-15"), progress: 40 },
                { task: "QA Testing", start: new Date("2024-02-15"), end: new Date("2024-04-01"), progress: 10 },
            ],
            { task: { header: "Task" } },
            row => ({
                tasks: [Gantt.Task({ start: row.start, end: row.end, progress: row.progress })],
            })
        );
    }),
    inputs: [],
});

export const ganttStatusByType = example({
    keywords: ["Gantt", "Task", "status", "committed", "proposed", "atRisk", "ifElse", "per-row"],
    description: "Status-driven bar colour — per-row `status` derived from a field via East ifElse (committed / proposed / at-risk palette)",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { stage: "Locked", name: "User Auth", start: new Date("2024-01-01"), end: new Date("2024-01-20"), progress: 100 },
                { stage: "Blocked", name: "Login Issue", start: new Date("2024-01-10"), end: new Date("2024-01-15"), progress: 20 },
                { stage: "Planned", name: "Performance", start: new Date("2024-01-15"), end: new Date("2024-02-01"), progress: 55 },
                { stage: "Locked", name: "Dashboard", start: new Date("2024-01-20"), end: new Date("2024-02-15"), progress: 90 },
            ],
            {
                stage: { header: "Stage" },
                name: { header: "Name" },
            },
            row => ({
                tasks: [Gantt.Task({
                    start: row.start,
                    end: row.end,
                    label: row.name,
                    // Progress fills the bar in the status colour so each status
                    // reads at a glance (an empty track only shows a thin border).
                    progress: row.progress,
                    // Map stage → status: Locked → committed, Blocked → at-risk, else → proposed.
                    status: row.stage.equal("Locked").ifElse(
                        _$ => variant("committed", null),
                        _$ => row.stage.equal("Blocked").ifElse(
                            _$ => variant("atRisk", null),
                            _$ => variant("proposed", null),
                        ),
                    ),
                })],
            })
        );
    }),
    inputs: [],
});

export const ganttStyled = example({
    keywords: ["Gantt", "variant", "line", "striped", "showToday", "density", "compact"],
    description: "Multiple style options combined — `variant: line`, `striped: true`, `showToday: true`, `density: compact`",
    fn: East.function([], UIComponentType, (_$) => {
        // Dates span around the present so the `showToday` now-line is visible
        // (it only renders when today falls within the timeline range).
        const day = 24 * 60 * 60 * 1000;
        const at = (offsetDays: number) => new Date(Date.now() + offsetDays * day);
        return Gantt.Root(
            [
                { dept: "Engineering", project: "Platform v2", start: at(-60), end: at(60) },
                { dept: "Design", project: "UI Refresh", start: at(-45), end: at(15) },
                { dept: "DevOps", project: "CI/CD Pipeline", start: at(-20), end: at(30) },
                { dept: "QA", project: "Test Automation", start: at(-10), end: at(75) },
            ],
            {
                dept: { header: "Department" },
                project: { header: "Project" },
            },
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
            {
                variant: "line",
                striped: true,
                showToday: true,
                density: "compact",
            }
        );
    }),
    inputs: [],
});

export const ganttComplexColumns = example({
    keywords: ["Gantt", "value", "render", "CellRenderContext", "row access", "complex"],
    description: "Complex columns — `value` to sort an array field, plus a `render` that closes over row data to combine sibling fields",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.let(East.value([
            { task: "Platform v2", owner: "Alice", tags: ["backend", "api", "priority"], start: new Date("2024-01-01"), end: new Date("2024-03-31") },
            { task: "UI Refresh", owner: "Bob", tags: ["frontend", "design"], start: new Date("2024-01-15"), end: new Date("2024-02-28") },
            { task: "CI/CD", owner: "Charlie", tags: ["devops"], start: new Date("2024-02-01"), end: new Date("2024-02-28") },
        ]));
        return Gantt.Root(
            rows,
            {
                task: {
                    header: "Project",
                    // render closes over `rows` to read a sibling field (owner) for the same row
                    render: East.function(
                        [Table.Types.CellRenderContext],
                        UIComponentType,
                        ($, ctx) => {
                            const row = $.let(rows.get(ctx.rowIndex));
                            return Text.Root(East.str`${row.task} · ${row.owner}`);
                        }
                    ),
                },
                tags: {
                    header: "Tags",
                    value: (tags) => tags.size(),
                    render: East.function(
                        [Table.Types.CellRenderContext],
                        UIComponentType,
                        (_$, ctx) => Text.Root(
                            ctx.cellValue.match({ Integer: (_$2, v) => East.str`${v} tags` }, _$2 => "")
                        )
                    ),
                },
            },
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
            { variant: "line", striped: true }
        );
    }),
    inputs: [],
});

export const ganttInteractiveCallbacks = example({
    keywords: ["Gantt", "Reactive", "State", "onTaskClick", "onTaskDrag", "onMilestoneClick", "interactive"],
    description: "Click rows, cells, tasks, milestones or drag to see events",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const lastEventBind = $.let(State.bind([StringType], "gantt_last_event", ""));
            const lastEvent = $.let(lastEventBind.read());

            const onRowClick = $.const(East.function(
                [Table.Types.RowClickEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onRowClick: row ${event.rowIndex}`));
                }
            ));

            const onRowDoubleClick = $.const(East.function(
                [Table.Types.RowClickEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onRowDoubleClick: row ${event.rowIndex}`));
                }
            ));

            const onCellClick = $.const(East.function(
                [Table.Types.CellClickEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onCellClick: row ${event.rowIndex}, col ${event.columnKey}`));
                }
            ));

            const onCellDoubleClick = $.const(East.function(
                [Table.Types.CellClickEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onCellDoubleClick: row ${event.rowIndex}, col ${event.columnKey}`));
                }
            ));

            const onSortChange = $.const(East.function(
                [Table.Types.SortEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onSortChange: ${event.columnKey} - ${event.sortDirection.getTag()}`));
                }
            ));

            const onTaskClick = $.const(East.function(
                [Gantt.Types.TaskClickEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onTaskClick: row ${event.rowIndex}, task ${event.taskIndex}`));
                }
            ));

            const onTaskDoubleClick = $.const(East.function(
                [Gantt.Types.TaskClickEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onTaskDoubleClick: row ${event.rowIndex}, task ${event.taskIndex}`));
                }
            ));

            const onTaskDrag = $.const(East.function(
                [Gantt.Types.TaskDragEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onTaskDrag: row ${event.rowIndex}, task ${event.taskIndex} moved`));
                }
            ));

            const onTaskDurationChange = $.const(East.function(
                [Gantt.Types.TaskDurationChangeEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onTaskDurationChange: row ${event.rowIndex}, task ${event.taskIndex}, new end date`));
                }
            ));

            const onTaskProgressChange = $.const(East.function(
                [Gantt.Types.TaskProgressChangeEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onTaskProgressChange: row ${event.rowIndex}, task ${event.taskIndex}, progress ${event.newProgress}`));
                }
            ));

            const onMilestoneClick = $.const(East.function(
                [Gantt.Types.MilestoneClickEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onMilestoneClick: row ${event.rowIndex}, milestone ${event.milestoneIndex}`));
                }
            ));

            const onMilestoneDoubleClick = $.const(East.function(
                [Gantt.Types.MilestoneClickEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onMilestoneDoubleClick: row ${event.rowIndex}, milestone ${event.milestoneIndex}`));
                }
            ));

            const onMilestoneDrag = $.const(East.function(
                [Gantt.Types.MilestoneDragEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onMilestoneDrag: row ${event.rowIndex}, milestone ${event.milestoneIndex} moved`));
                }
            ));

            return Stack.VStack([
                Gantt.Root(
                    [
                        { name: "Sprint 1", start: new Date("2024-01-01"), end: new Date("2024-01-14"), release: new Date("2024-01-14") },
                        { name: "Sprint 2", start: new Date("2024-01-15"), end: new Date("2024-01-28"), release: new Date("2024-01-28") },
                        { name: "Sprint 3", start: new Date("2024-01-29"), end: new Date("2024-02-11"), release: new Date("2024-02-11") },
                    ],
                    { name: { header: "Sprint" } },
                    row => ({
                        // `proposed` (not committed) so the bars are editable —
                        // committed bars are read-only / resize-locked per spec.
                        tasks: [Gantt.Task({ start: row.start, end: row.end, progress: 50, status: "proposed" })],
                        milestones: [Gantt.Milestone({ date: row.release, label: "Release", kind: "release" })],
                    }),
                    {
                        striped: true,
                        showToday: true,
                        onRowClick,
                        onRowDoubleClick,
                        onCellClick,
                        onCellDoubleClick,
                        onSortChange,
                        onTaskClick,
                        onTaskDoubleClick,
                        onTaskDrag,
                        onTaskDurationChange,
                        onTaskProgressChange,
                        onMilestoneClick,
                        onMilestoneDoubleClick,
                        onMilestoneDrag,
                    }
                ),
                Badge.Root(
                    East.equal(lastEvent.length(), 0n).ifElse(
                        _$ => "Interact with the Gantt chart",
                        _$ => lastEvent
                    ),
                    { colorPalette: "blue", variant: "outline" }
                ),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const ganttReactiveDrag = example({
    keywords: ["Gantt", "Reactive", "State", "onTaskDrag", "drag", "dragStep"],
    description: "Drag task to update state - position persists after re-render",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const taskStartBind = $.let(State.bind([DateTimeType], "gantt_task_start", new Date("2024-01-15")));
            const taskStart = $.let(taskStartBind.read());
            const taskEnd = $.let(taskStart.addDays(14));

            const onTaskDrag = $.const(East.function(
                [Gantt.Types.TaskDragEvent],
                NullType,
                ($, event) => {
                    $(taskStartBind.write(event.newStart));
                }
            ));

            return Stack.VStack([
                Gantt.Root(
                    [{ name: "Draggable Task" }],
                    { name: { header: "Task" } },
                    _row => ({
                        tasks: [Gantt.Task({
                            start: taskStart,
                            end: taskEnd,
                            label: "Drag me!",
                            // `proposed` so the bar is editable (the ⠿ grip shows);
                            // committed bars are locked per spec.
                            status: "proposed",
                        })],
                    }),
                    {
                        onTaskDrag,
                        dragStep: variant("days", 1),
                        durationStep: variant("days", 1),
                    }
                ),
                Text.Root(East.str`Start: ${taskStart}`, { textStyle: "body-sm", color: "fg.muted" }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const ganttFrozenColumns = example({
    keywords: ["Gantt", "frozen", "pin"],
    description: "Pin columns left so they stay visible while scrolling the timeline",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { id: "#1", task: "Planning", owner: "Alice", dept: "PM", priority: "High", start: new Date("2024-01-01"), end: new Date("2024-01-15") },
                { id: "#2", task: "Design", owner: "Bob", dept: "Design", priority: "Medium", start: new Date("2024-01-10"), end: new Date("2024-02-01") },
                { id: "#3", task: "Development", owner: "Charlie", dept: "Engineering", priority: "High", start: new Date("2024-01-20"), end: new Date("2024-03-15") },
                { id: "#4", task: "Testing", owner: "Diana", dept: "QA", priority: "Low", start: new Date("2024-03-01"), end: new Date("2024-03-30") },
                { id: "#5", task: "Deployment", owner: "Eve", dept: "DevOps", priority: "Medium", start: new Date("2024-03-20"), end: new Date("2024-04-15") },
            ],
            {
                id: { header: "ID", width: "80px" },
                task: { header: "Task", width: "150px" },
                owner: { header: "Owner", width: "120px" },
                dept: { header: "Department", width: "150px" },
                priority: { header: "Priority", width: "120px" },
            },
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
            {
                frozen: ["id", "task"],
                variant: "line",
                striped: true,
                height: "300px",
            }
        );
    }),
    inputs: [],
});

export const ganttRowStatus = example({
    keywords: ["Gantt", "rowStatus", "StatusToken", "tint", "theme-agnostic"],
    description: "Row-status tint — `rowStatus` paints each row background with a semantic token (success / warning / danger / info / neutral)",
    fn: East.function([], UIComponentType, ($) => {
        const rowStatus = $.const(East.function([IntegerType], Style.Types.StatusToken, ($, rowIndex) => {
            const bucket = $.let(rowIndex.modulo(3n), IntegerType);
            return bucket.equals(0n).ifElse(
                $ => Style.StatusToken("success"),
                $ => bucket.equals(1n).ifElse(
                    $ => Style.StatusToken("warning"),
                    $ => Style.StatusToken("danger"),
                ),
            );
        }));

        return Gantt.Root(
            [
                { task: "Planning", start: new Date("2024-01-01"), end: new Date("2024-01-15") },
                { task: "Design", start: new Date("2024-01-10"), end: new Date("2024-02-01") },
                { task: "Development", start: new Date("2024-01-20"), end: new Date("2024-03-15") },
            ],
            { task: { header: "Task" } },
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
            { rowStatus, variant: "line" },
        );
    }),
    inputs: [],
});

export const ganttTaskPopover = example({
    keywords: ["Gantt", "Task", "popover", "click", "rich"],
    description: "Per-task click popover — pass a UIComponent into `popover` for rich edit forms / details",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { task: "Sprint 1", owner: "Alice", start: new Date("2024-01-01"), end: new Date("2024-01-14") },
                { task: "Sprint 2", owner: "Bob", start: new Date("2024-01-15"), end: new Date("2024-01-28") },
            ],
            { task: { header: "Sprint" } },
            row => ({ tasks: [Gantt.Task({
                start: row.start,
                end: row.end,
                label: row.task,
                popover: Stack.VStack([
                    Text.Root(East.str`Sprint: ${row.task}`, { fontWeight: "bold" }),
                    Text.Root(East.str`Owner: ${row.owner}`),
                    Text.Root(East.str`From ${row.start} to ${row.end}`),
                ], { gap: "2" }),
            })] }),
        );
    }),
    inputs: [],
});

export const ganttRichLabel = example({
    keywords: ["Gantt", "Task", "label", "LabelInput", "align", "verticalAlign", "fontWeight", "fontStyle", "fontSize", "color"],
    description: "Rich task label — a plain LabelInput vs one with align / verticalAlign / color / fontWeight / fontStyle / fontSize overrides",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [{ row: "demo" }],
            ["row"],
            (_row) => ({
                tasks: [
                    Gantt.Task({
                        start: new Date("2024-01-01"),
                        end: new Date("2024-01-15"),
                        label: { value: "Plain label" },
                    }),
                    Gantt.Task({
                        start: new Date("2024-01-20"),
                        end: new Date("2024-02-05"),
                        label: {
                            value: "Styled label",
                            align: "center",
                            verticalAlign: "center",
                            color: "yellow.300",
                            fontWeight: "bold",
                            fontStyle: "italic",
                            fontSize: "lg",
                        },
                    }),
                ],
            }),
        );
    }),
    inputs: [],
});
