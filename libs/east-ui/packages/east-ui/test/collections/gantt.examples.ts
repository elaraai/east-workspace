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
            row => [Gantt.Task({ start: row.start, end: row.end })]
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
            row => [Gantt.Task({ start: row.start, end: row.end, colorPalette: "teal" })]
        );
    }),
    inputs: [],
});

export const ganttWithMilestones = example({
    keywords: ["Gantt", "Task", "Milestone"],
    description: "Combining tasks with milestone markers",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { name: "Sprint 1", start: new Date("2024-01-01"), end: new Date("2024-01-14"), release: new Date("2024-01-14") },
                { name: "Sprint 2", start: new Date("2024-01-15"), end: new Date("2024-01-28"), release: new Date("2024-01-28") },
                { name: "Sprint 3", start: new Date("2024-01-29"), end: new Date("2024-02-11"), release: new Date("2024-02-11") },
            ],
            { name: { header: "Sprint" } },
            row => [
                Gantt.Task({ start: row.start, end: row.end, colorPalette: "blue" }),
                Gantt.Milestone({ date: row.release, label: "Release", colorPalette: "green" }),
            ]
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
            row => [
                Gantt.Task({
                    start: row.start,
                    end: row.end,
                    progress: row.progress,
                    colorPalette: "purple",
                }),
            ]
        );
    }),
    inputs: [],
});

export const ganttColorful = example({
    keywords: ["Gantt", "Task", "label", "color"],
    description: "Different colors for different task types",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { type: "Feature", name: "User Auth", start: new Date("2024-01-01"), end: new Date("2024-01-20") },
                { type: "Bug Fix", name: "Login Issue", start: new Date("2024-01-10"), end: new Date("2024-01-15") },
                { type: "Enhancement", name: "Performance", start: new Date("2024-01-15"), end: new Date("2024-02-01") },
                { type: "Feature", name: "Dashboard", start: new Date("2024-01-20"), end: new Date("2024-02-15") },
            ],
            {
                type: { header: "Type" },
                name: { header: "Name" },
            },
            row => [
                Gantt.Task({
                    start: row.start,
                    end: row.end,
                    label: row.name,
                }),
            ]
        );
    }),
    inputs: [],
});

export const ganttStyled = example({
    keywords: ["Gantt", "variant", "line", "striped", "interactive", "showToday"],
    description: "Multiple style options combined",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { dept: "Engineering", project: "Platform v2", start: new Date("2024-01-01"), end: new Date("2024-03-31") },
                { dept: "Design", project: "UI Refresh", start: new Date("2024-01-15"), end: new Date("2024-02-28") },
                { dept: "DevOps", project: "CI/CD Pipeline", start: new Date("2024-02-01"), end: new Date("2024-02-28") },
                { dept: "QA", project: "Test Automation", start: new Date("2024-02-15"), end: new Date("2024-04-15") },
            ],
            {
                dept: { header: "Department" },
                project: { header: "Project" },
            },
            row => [Gantt.Task({ start: row.start, end: row.end, colorPalette: "cyan" })],
            {
                variant: "line",
                striped: true,
                interactive: true,
                showToday: true,
            }
        );
    }),
    inputs: [],
});

export const ganttComplexColumns = example({
    keywords: ["Gantt", "value", "render", "complex", "array", "struct"],
    description: "Array and struct fields with value functions for sorting",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { task: "Platform v2", tags: ["backend", "api", "priority"], info: { team: "Core", size: 5n }, start: new Date("2024-01-01"), end: new Date("2024-03-31") },
                { task: "UI Refresh", tags: ["frontend", "design"], info: { team: "Web", size: 3n }, start: new Date("2024-01-15"), end: new Date("2024-02-28") },
                { task: "CI/CD", tags: ["devops"], info: { team: "Infra", size: 2n }, start: new Date("2024-02-01"), end: new Date("2024-02-28") },
            ],
            {
                task: { header: "Project" },
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
                info: {
                    header: "Team",
                    value: (info) => info.size,
                    render: East.function(
                        [Table.Types.CellRenderContext],
                        UIComponentType,
                        (_$, ctx) => Text.Root(
                            ctx.cellValue.match({ Integer: (_$2, v) => East.str`Team size: ${v}` }, _$2 => "")
                        )
                    ),
                },
            },
            row => [Gantt.Task({ start: row.start, end: row.end, colorPalette: "purple" })],
            { variant: "line", striped: true }
        );
    }),
    inputs: [],
});

export const ganttColumnRenderWithRow = example({
    keywords: ["Gantt", "render", "CellRenderContext", "row access"],
    description: "Render function closes over data to access other row fields",
    fn: East.function([], UIComponentType, ($) => {
        const ganttRowData = $.let(East.value([
            { task: "Backend API", owner: "Alice", priority: "high", start: new Date("2024-01-01"), end: new Date("2024-02-15") },
            { task: "Frontend UI", owner: "Bob", priority: "medium", start: new Date("2024-01-15"), end: new Date("2024-03-01") },
            { task: "Integration", owner: "Charlie", priority: "high", start: new Date("2024-02-01"), end: new Date("2024-03-15") },
            { task: "Documentation", owner: "Diana", priority: "low", start: new Date("2024-02-15"), end: new Date("2024-04-01") },
        ]));
        return Gantt.Root(
            ganttRowData,
            {
                task: {
                    header: "Task",
                    render: East.function(
                        [Table.Types.CellRenderContext],
                        UIComponentType,
                        ($, ctx) => {
                            const row = $.let(ganttRowData.get(ctx.rowIndex));
                            return Text.Root(East.str`${row.task} (${row.owner})`);
                        }
                    ),
                },
                priority: {
                    header: "Priority",
                    render: East.function(
                        [Table.Types.CellRenderContext],
                        UIComponentType,
                        ($, ctx) => {
                            const row = $.let(ganttRowData.get(ctx.rowIndex));
                            return Badge.Root(
                                East.str`${row.priority} (${row.owner})`,
                                { variant: "solid" }
                            );
                        }
                    ),
                },
            },
            row => [Gantt.Task({ start: row.start, end: row.end })],
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
                    row => [
                        Gantt.Task({ start: row.start, end: row.end, colorPalette: "blue", progress: 50 }),
                        Gantt.Milestone({ date: row.release, label: "Release", colorPalette: "green" }),
                    ],
                    {
                        interactive: true,
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
                    _row => [
                        Gantt.Task({
                            start: taskStart,
                            end: taskEnd,
                            label: "Drag me!",
                            colorPalette: "orange",
                        }),
                    ],
                    {
                        interactive: true,
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

export const ganttCustomHeight = example({
    keywords: ["Gantt", "Root", "height"],
    description: "Set height via style to control container size",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { task: "Planning", owner: "Alice", start: new Date("2024-01-01"), end: new Date("2024-01-15") },
                { task: "Design", owner: "Bob", start: new Date("2024-01-10"), end: new Date("2024-02-01") },
                { task: "Development", owner: "Charlie", start: new Date("2024-01-20"), end: new Date("2024-03-15") },
                { task: "Testing", owner: "Diana", start: new Date("2024-03-01"), end: new Date("2024-03-30") },
                { task: "Deployment", owner: "Eve", start: new Date("2024-03-20"), end: new Date("2024-04-15") },
            ],
            ["task", "owner"],
            row => [Gantt.Task({ start: row.start, end: row.end })],
            { height: "200px", variant: "line" }
        );
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
            row => [Gantt.Task({ start: row.start, end: row.end })],
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

// ============================================================================
// Plan 1.10 — rowStatus + per-event colour hatches + root chrome colours
// ============================================================================

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
            row => [Gantt.Task({ start: row.start, end: row.end })],
            { rowStatus, variant: "line" },
        );
    }),
    inputs: [],
});

export const ganttPerEventColours = example({
    keywords: ["Gantt", "Task", "background", "stroke", "labelColor", "progressFill", "per-event"],
    description: "Per-task colour escape hatches — `background` / `stroke` / `labelColor` / `progressFill` override the default palette",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { task: "Critical path", start: new Date("2024-01-01"), end: new Date("2024-01-20"), progress: 75 },
                { task: "Standard work", start: new Date("2024-01-15"), end: new Date("2024-02-10"), progress: 40 },
            ],
            { task: { header: "Task" } },
            row => [Gantt.Task({
                start: row.start,
                end: row.end,
                label: row.task,
                progress: row.progress,
                background: "#C53030",
                stroke: "#742A2A",
                labelColor: "white",
                progressFill: "#822727",
            })],
            { variant: "line" },
        );
    }),
    inputs: [],
});

export const ganttChromeColours = example({
    keywords: ["Gantt", "gridColor", "todayMarkerColor", "headerBackground", "headerColor", "chrome"],
    description: "Root chrome colour overrides — explicit grid / today-marker / header colours for brand alignment",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { task: "Planning", start: new Date("2024-01-01"), end: new Date("2024-01-15") },
                { task: "Design", start: new Date("2024-01-10"), end: new Date("2024-02-01") },
            ],
            { task: { header: "Task" } },
            row => [Gantt.Task({ start: row.start, end: row.end, colorPalette: "blue" })],
            {
                variant: "line",
                gridColor: "blue.100",
                todayMarkerColor: "red.500",
                headerBackground: "blue.50",
                headerColor: "blue.900",
                showToday: true,
            },
        );
    }),
    inputs: [],
});
