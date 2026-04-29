/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, DateTimeType, IntegerType, NullType, StringType, variant, example } from "@elaraai/east";
import { Badge, Gantt, Icon, Reactive, Stack, Stat, State, Style, Table, Text, UIComponentType } from "@elaraai/east-ui";

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
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end, colorPalette: "teal" })] })
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
            row => ({
                tasks: [Gantt.Task({ start: row.start, end: row.end, colorPalette: "blue" })],
                milestones: [Gantt.Milestone({ date: row.release, label: "Release", colorPalette: "green" })],
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
                tasks: [Gantt.Task({
                    start: row.start,
                    end: row.end,
                    progress: row.progress,
                    colorPalette: "purple",
                })],
            })
        );
    }),
    inputs: [],
});

export const ganttColorful = example({
    keywords: ["Gantt", "Task", "label", "color", "colorPalette", "ifElse", "per-type"],
    description: "Different colors for different task types — per-row colorPalette derived from a type field via East ifElse",
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
            row => ({
                tasks: [Gantt.Task({
                    start: row.start,
                    end: row.end,
                    label: row.name,
                    // Map task type → colorPalette via chained East ifElse:
                    //   Feature → blue, Bug Fix → red, Enhancement → purple.
                    colorPalette: row.type.equal("Feature").ifElse(
                        _$ => variant("blue", null),
                        _$ => row.type.equal("Bug Fix").ifElse(
                            _$ => variant("red", null),
                            _$ => variant("purple", null),
                        ),
                    ),
                })],
            })
        );
    }),
    inputs: [],
});

export const ganttStyled = example({
    keywords: ["Gantt", "variant", "line", "striped", "showToday"],
    description: "Multiple style options combined — `variant: line`, `striped: true`, `showToday: true`",
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
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end, colorPalette: "cyan" })] }),
            {
                variant: "line",
                striped: true,
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
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end, colorPalette: "purple" })] }),
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
                        tasks: [Gantt.Task({ start: row.start, end: row.end, colorPalette: "blue", progress: 50 })],
                        milestones: [Gantt.Milestone({ date: row.release, label: "Release", colorPalette: "green" })],
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
                            colorPalette: "orange",
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
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
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
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
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
            row => ({ tasks: [Gantt.Task({
                start: row.start,
                end: row.end,
                label: { value: row.task, color: "white" },
                progress: row.progress,
                background: "#C53030",
                stroke: "#742A2A",
                progressFill: "#822727",
            })] }),
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
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end, colorPalette: "blue" })] }),
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

// ============================================================================
// Plan 1.10 I — per-task tooltip / popover / overlays + visual-parity tokens
// ============================================================================

export const ganttTaskTooltip = example({
    keywords: ["Gantt", "Task", "tooltip", "hover", "rich"],
    description: "Per-task hover tooltip — pass a UIComponent into `tooltip` for rich preview content",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { task: "API redesign", owner: "Alice", start: new Date("2024-01-01"), end: new Date("2024-01-20") },
                { task: "UI polish", owner: "Bob", start: new Date("2024-01-15"), end: new Date("2024-02-10") },
            ],
            { task: { header: "Task" } },
            row => ({ tasks: [Gantt.Task({
                start: row.start,
                end: row.end,
                label: row.task,
                colorPalette: "purple",
                tooltip: Stack.VStack([
                    Badge.Root(row.task, { colorPalette: "purple", variant: "solid" }),
                    Text.Root(East.str`Owner: ${row.owner}`),
                ], { gap: "1", padding: "0px" }),
            })] }),
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
                colorPalette: "teal",
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

export const ganttTaskOverlays = example({
    keywords: ["Gantt", "Task", "overlays", "axis", "Badge", "Icon"],
    description: "Per-task overlays — UIComponents pinned to corners of the bar (priority chip top-right, status icon bottom-left)",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { task: "Critical Path", priority: "HIGH", start: new Date("2024-01-01"), end: new Date("2024-01-20") },
                { task: "Background Work", priority: "LOW", start: new Date("2024-01-15"), end: new Date("2024-02-10") },
            ],
            { task: { header: "Task" }, priority: { header: "Priority" } },
            row => ({ tasks: [Gantt.Task({
                start: row.start,
                end: row.end,
                label: { value: row.task, color: "white" },
                colorPalette: "purple",
                overlays: [
                    {
                        content: Badge.Root(row.priority, { colorPalette: "red", variant: "solid", size: "xs" }),
                        align: "end",
                        verticalAlign: "start",
                    },
                    {
                        content: Icon.Root("fas", "circle-check", { colorPalette: "green", size: "sm" }),
                        align: "start",
                        verticalAlign: "end",
                    },
                ],
            })] }),
        );
    }),
    inputs: [],
});

export const ganttRichLabel = example({
    keywords: ["Gantt", "Task", "label", "LabelInput", "align", "verticalAlign", "fontWeight"],
    description: "Rich task label — LabelInput with align / verticalAlign / color / fontWeight / fontStyle / fontSize overrides",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [{ task: "Pretty", start: new Date("2024-01-01"), end: new Date("2024-01-31") }],
            { task: { header: "Task" } },
            row => ({ tasks: [Gantt.Task({
                start: row.start,
                end: row.end,
                colorPalette: "purple",
                label: {
                    value: row.task,
                    align: "center",
                    verticalAlign: "center",
                    color: "yellow.300",
                    fontWeight: "bold",
                    fontStyle: "italic",
                    fontSize: "lg",
                },
            })] }),
        );
    }),
    inputs: [],
});

export const ganttVisualTokens = example({
    keywords: ["Gantt", "taskBorderRadius", "labelColor", "labelFontSize", "labelFontWeight", "visual", "tokens"],
    description: "Visual-parity tokens — `taskBorderRadius` / `labelColor` / `labelFontSize` / `labelFontWeight` set defaults; per-task `label.color` etc. override",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [{ row: "demo" }],
            ["row"],
            (_row) => ({
                tasks: [
                    Gantt.Task({
                        start: new Date("2024-01-01"),
                        end: new Date("2024-01-15"),
                        label: { value: "Inherits defaults" },
                        colorPalette: "teal",
                    }),
                    Gantt.Task({
                        start: new Date("2024-01-20"),
                        end: new Date("2024-02-05"),
                        label: {
                            value: "Overrides per-task",
                            color: "yellow.300",
                            fontSize: "lg",
                            fontWeight: "bold",
                        },
                        colorPalette: "teal",
                    }),
                ],
            }),
            {
                taskBorderRadius: "8px",
                labelColor: "white",
                labelFontSize: "0.875rem",
                labelFontWeight: "700",
            },
        );
    }),
    inputs: [],
});

export const ganttMilestoneTooltip = example({
    keywords: ["Gantt", "Milestone", "tooltip", "hover", "rich"],
    description: "Per-milestone hover tooltip — same UIComponent slot as tasks, anchored to the diamond",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { sprint: "Sprint 1", release: new Date("2024-01-14"), notes: "Internal beta" },
                { sprint: "Sprint 2", release: new Date("2024-01-28"), notes: "Customer preview" },
            ],
            { sprint: { header: "Sprint" } },
            row => ({ milestones: [Gantt.Milestone({
                date: row.release,
                label: "Release",
                colorPalette: "green",
                tooltip: Stack.VStack([
                    Badge.Root(row.sprint, { colorPalette: "green", variant: "solid" }),
                    Text.Root(East.str`Notes: ${row.notes}`),
                ], { gap: "1", padding: "0px" }),
            })] }),
        );
    }),
    inputs: [],
});

export const ganttMilestonePopover = example({
    keywords: ["Gantt", "Milestone", "popover", "click", "rich"],
    description: "Per-milestone click popover — UIComponent surface anchored to the diamond, click toggles open/close",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { name: "Q1 Launch", date: new Date("2024-03-31"), owner: "Alice", scope: "Public release" },
                { name: "Q2 GA", date: new Date("2024-06-30"), owner: "Bob", scope: "Enterprise tier" },
            ],
            { name: { header: "Milestone" } },
            row => ({ milestones: [Gantt.Milestone({
                date: row.date,
                label: row.name,
                colorPalette: "purple",
                popover: Stack.VStack([
                    Text.Root(East.str`${row.name}`, { fontWeight: "bold" }),
                    Text.Root(East.str`Owner: ${row.owner}`),
                    Text.Root(East.str`Scope: ${row.scope}`),
                ], { gap: "2" }),
            })] }),
        );
    }),
    inputs: [],
});

export const ganttMilestoneOverlays = example({
    keywords: ["Gantt", "Milestone", "overlays", "axis", "Badge", "Icon"],
    description: "Per-milestone overlays — UIComponents pinned to corners of the diamond (status icon top-right, badge bottom)",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { name: "Beta", date: new Date("2024-02-01"), status: "DONE" },
                { name: "GA", date: new Date("2024-04-01"), status: "TODO" },
            ],
            { name: { header: "Milestone" } },
            row => ({ milestones: [Gantt.Milestone({
                date: row.date,
                label: row.name,
                colorPalette: "purple",
                overlays: [
                    {
                        content: Icon.Root("fas", "star", { colorPalette: "yellow", size: "xs" }),
                        align: "end",
                        verticalAlign: "start",
                    },
                    {
                        content: Badge.Root(row.status, { colorPalette: "green", variant: "solid", size: "xs" }),
                        align: "center",
                        verticalAlign: "end",
                    },
                ],
            })] }),
        );
    }),
    inputs: [],
});

export const ganttMilestoneColours = example({
    keywords: ["Gantt", "Milestone", "fill", "stroke", "per-milestone"],
    description: "Per-milestone colour escapes — `fill` / `stroke` override the default palette for individual diamonds",
    fn: East.function([], UIComponentType, (_$) => {
        return Gantt.Root(
            [
                { milestone: "Compliance review", date: new Date("2024-02-15") },
                { milestone: "External audit", date: new Date("2024-04-15") },
            ],
            { milestone: { header: "Milestone" } },
            row => ({ milestones: [Gantt.Milestone({
                date: row.date,
                label: row.milestone,
                fill: "#C53030",
                stroke: "#742A2A",
            })] }),
        );
    }),
    inputs: [],
});

export const ganttTaskPopoverWithCallback = example({
    keywords: ["Gantt", "popover", "onTaskClick", "coexist", "Reactive", "State"],
    description: "Per-task popover coexists with `onTaskClick` — clicking the bar opens the popover AND fires the callback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const clicksBind = $.let(State.bind([IntegerType], "gantt_popover_clicks", 0n));
            const clicks = $.let(clicksBind.read());

            const onTaskClick = $.const(East.function(
                [Gantt.Types.TaskClickEvent],
                NullType,
                ($, _event) => {
                    const current = $.let(clicksBind.read(), IntegerType);
                    $(clicksBind.write(current.add(1n)));
                },
            ));

            return Stack.VStack([
                Gantt.Root(
                    [{ task: "Status review", start: new Date("2024-01-01"), end: new Date("2024-01-31") }],
                    { task: { header: "Task" } },
                    row => ({ tasks: [Gantt.Task({
                        start: row.start,
                        end: row.end,
                        label: row.task,
                        colorPalette: "purple",
                        popover: Stat.Root(
                            "Total clicks",
                            Text.Root(East.str`${clicks}`, { fontWeight: "bold", textStyle: "heading-md" }),
                            { helpText: "Counter increments every click — popover and callback coexist." },
                        ),
                    })] }),
                    { onTaskClick },
                ),
                Text.Root(East.str`Clicked ${clicks} times`, { textStyle: "body-sm", color: "fg.muted" }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
