/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, FloatType, IntegerType, NullType, StringType, variant, example } from "@elaraai/east";
import { Badge, Icon, Planner, Reactive, Stack, State, Stat, Style, Table, Text, UIComponentType } from "@elaraai/east-ui";

export const plannerBasic = example({
    keywords: ["Planner", "Root", "Event", "basic", "resource", "allocation"],
    description: "Simple resource allocation grid with events",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { resource: "Alice", task: "Development", start: 1.0, end: 3.0 },
                { resource: "Bob", task: "Testing", start: 2.0, end: 5.0 },
                { resource: "Charlie", task: "Review", start: 4.0, end: 6.0 },
            ],
            ["resource", "task"],
            row => [Planner.Event({ start: row.start, end: row.end })]
        );
    }),
    inputs: [],
});

export const plannerWithLabels = example({
    keywords: ["Planner", "Event", "label", "colorPalette", "width"],
    description: "Events with custom labels, color palettes, and column widths",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { name: "Project A", status: "Active", slot: 1.0, endSlot: 4.0 },
                { name: "Project B", status: "Pending", slot: 3.0, endSlot: 7.0 },
                { name: "Project C", status: "Done", slot: 5.0, endSlot: 8.0 },
            ],
            {
                name: { header: "Project", width: "200px", minWidth: "80px" },
                status: { header: "Status", width: "100px", maxWidth: "150px" },
            },
            row => [
                Planner.Event({
                    start: row.slot,
                    end: row.endSlot,
                    label: { value: "Active" },
                    colorPalette: "blue",
                }),
            ]
        );
    }),
    inputs: [],
});

export const plannerMultipleEvents = example({
    keywords: ["Planner", "Event", "multiple", "maxSlot"],
    description: "Rows can have multiple events with different colors",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { name: "Team A", slot1: 1.0, slot2: 4.0, slot3: 7.0 },
                { name: "Team B", slot1: 2.0, slot2: 5.0, slot3: 8.0 },
            ],
            ["name"],
            row => [
                Planner.Event({ start: row.slot1, end: row.slot1.add(1.0), colorPalette: "green", label: { value: "Sprint 1" } }),
                Planner.Event({ start: row.slot2, end: row.slot2.add(1.0), colorPalette: "blue", label: { value: "Sprint 2" } }),
                Planner.Event({ start: row.slot3, end: row.slot3.add(1.0), colorPalette: "purple", label: { value: "Sprint 3" } }),
            ],
            { maxSlot: 15.0 }
        );
    }),
    inputs: [],
});

export const plannerSingleSlotMode = example({
    keywords: ["Planner", "Event", "slotMode", "single"],
    description: "Events occupy exactly one slot each",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { resource: "Room A", s1: 1.0, s2: 3.0, s3: 5.0, s4: 7.0 },
                { resource: "Room B", s1: 2.0, s2: 4.0, s3: 6.0, s4: 8.0 },
            ],
            ["resource"],
            row => [
                Planner.Event({ start: row.s1, colorPalette: "teal" }),
                Planner.Event({ start: row.s2, colorPalette: "teal" }),
                Planner.Event({ start: row.s3, colorPalette: "teal" }),
                Planner.Event({ start: row.s4, colorPalette: "teal" }),
            ],
            { slotMode: "single", maxSlot: 10.0 }
        );
    }),
    inputs: [],
});

export const plannerFractionalSteps = example({
    keywords: ["Planner", "Event", "stepSize", "fractional", "snap"],
    description: "Events can start/end at half or quarter positions with stepSize snapping",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { task: "Task A", start: 0.0, end: 1.5 },
                { task: "Task B", start: 1.5, end: 3.5 },
                { task: "Task C", start: 0.5, end: 2.0 },
            ],
            ["task"],
            row => [Planner.Event({ start: row.start, end: row.end, colorPalette: "purple", label: { value: row.task } })],
            {
                minSlot: 0.0,
                maxSlot: 5.0,
                stepSize: 0.5,
            }
        );
    }),
    inputs: [],
});

export const plannerCustomSlotLabels = example({
    keywords: ["Planner", "Event", "slotLabel", "format"],
    description: "Use a function to format slot labels",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { shift: "Morning", start: 0.0, end: 2.0 },
                { shift: "Afternoon", start: 2.0, end: 4.0 },
                { shift: "Evening", start: 4.0, end: 6.0 },
            ],
            { shift: { header: "Shift" } },
            row => [Planner.Event({ start: row.start, end: row.end, colorPalette: "orange" })],
            {
                minSlot: 0.0,
                maxSlot: 7.0,
                slotLabel: East.function([FloatType], StringType, (_$, slot) => {
                    return East.str`Day ${slot}`;
                }),
            }
        );
    }),
    inputs: [],
});

export const plannerStyled = example({
    keywords: ["Planner", "striped", "interactive", "slotLineStroke", "slotLineDash", "slotLineOpacity"],
    description: "Table styling options: striped, interactive, custom grid lines",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { task: "Analysis", priority: "High", start: 1.0, end: 3.0 },
                { task: "Design", priority: "Medium", start: 2.0, end: 5.0 },
                { task: "Build", priority: "High", start: 4.0, end: 8.0 },
                { task: "Test", priority: "Low", start: 6.0, end: 9.0 },
            ],
            ["task", "priority"],
            row => [Planner.Event({ start: row.start, end: row.end, colorPalette: "cyan" })],
            {
                striped: true,
                slotLineStroke: "gray.300",
                slotLineDash: "4 2",
                slotLineOpacity: 0.7,
                maxSlot: 10.0,
            }
        );
    }),
    inputs: [],
});

export const plannerComplexColumns = example({
    keywords: ["Planner", "value", "render", "complex", "array", "struct"],
    description: "Array and struct fields with value functions and East render functions",
    fn: East.function([], UIComponentType, ($) => {
        const plannerComplexData = $.let(East.value([
            { name: "Alice", skills: ["TypeScript", "React"], info: { dept: "Eng", level: 3n }, start: 1.0, end: 4.0 },
            { name: "Bob", skills: ["Python"], info: { dept: "Data", level: 2n }, start: 2.0, end: 5.0 },
            { name: "Charlie", skills: ["Go", "Rust", "C++"], info: { dept: "Infra", level: 4n }, start: 3.0, end: 7.0 },
        ]));
        return Planner.Root(
            plannerComplexData,
            {
                name: { header: "Name" },
                skills: {
                    header: "Skills",
                    value: (skills) => skills.size(),
                    render: East.function(
                        [Table.Types.CellRenderContext],
                        UIComponentType,
                        ($, ctx) => {
                            const row = $.let(plannerComplexData.get(ctx.rowIndex));
                            return Text.Root(East.str`${row.skills.size()} skills`);
                        }
                    ),
                },
                info: {
                    header: "Level",
                    value: (info) => info.level,
                    render: East.function(
                        [Table.Types.CellRenderContext],
                        UIComponentType,
                        ($, ctx) => {
                            const row = $.let(plannerComplexData.get(ctx.rowIndex));
                            return Text.Root(East.str`${row.info.dept} L${row.info.level}`);
                        }
                    ),
                },
            },
            row => [Planner.Event({ start: row.start, end: row.end, colorPalette: "purple" })],
            { maxSlot: 8.0, striped: true }
        );
    }),
    inputs: [],
});

export const plannerColumnRenderWithRow = example({
    keywords: ["Planner", "render", "CellRenderContext", "row access"],
    description: "Render function closes over data to access other row fields",
    fn: East.function([], UIComponentType, ($) => {
        const plannerRowData = $.let(East.value([
            { task: "Backend API", owner: "Alice", priority: "high", start: 1.0, end: 4.0 },
            { task: "Frontend UI", owner: "Bob", priority: "medium", start: 2.0, end: 6.0 },
            { task: "Integration", owner: "Charlie", priority: "high", start: 4.0, end: 8.0 },
            { task: "Documentation", owner: "Diana", priority: "low", start: 5.0, end: 9.0 },
        ]));
        return Planner.Root(
            plannerRowData,
            {
                task: {
                    header: "Task",
                    render: East.function(
                        [Table.Types.CellRenderContext],
                        UIComponentType,
                        ($, ctx) => {
                            const row = $.let(plannerRowData.get(ctx.rowIndex));
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
                            const row = $.let(plannerRowData.get(ctx.rowIndex));
                            return Badge.Root(
                                East.str`${row.priority} (${row.owner})`,
                                { variant: "solid" }
                            );
                        }
                    ),
                },
            },
            row => [Planner.Event({ start: row.start, end: row.end })],
            { maxSlot: 10.0, striped: true }
        );
    }),
    inputs: [],
});

export const plannerWithBoundaries = example({
    keywords: ["Planner", "boundaries", "deadline", "milestone"],
    description: "Vertical boundary lines at specific slot positions (e.g., deadlines, milestones)",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { task: "Planning", team: "Alpha", start: 1.0, end: 3.0 },
                { task: "Development", team: "Beta", start: 2.0, end: 6.0 },
                { task: "Testing", team: "Gamma", start: 5.0, end: 8.0 },
            ],
            ["task", "team"],
            row => [Planner.Event({ start: row.start, end: row.end, colorPalette: "blue" })],
            {
                maxSlot: 10.0,
                boundaries: [
                    { x: 4.0, stroke: "red", strokeWidth: 2 },
                    { x: 7.0, stroke: "green", strokeWidth: 4, strokeDash: "4 2" },
                ],
            }
        );
    }),
    inputs: [],
});

export const plannerPopoverClick = example({
    keywords: ["Planner", "popover", "click", "rich"],
    description: "Per-event click popover — pass a UIComponent into `popover` for rich edit forms / details",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { task: "Sprint Planning", owner: "Alice", start: 1.0, end: 3.0 },
                { task: "Development", owner: "Bob", start: 2.0, end: 5.0 },
                { task: "Code Review", owner: "Charlie", start: 4.0, end: 6.0 },
            ],
            ["task", "owner"],
            row => [Planner.Event({
                start: row.start,
                end: row.end,
                label: { value: row.task },
                colorPalette: "teal",
                popover: Stack.VStack([
                    Text.Root(East.str`Event: ${row.task}`, { fontWeight: "bold" }),
                    Text.Root(East.str`Owner: ${row.owner}`),
                    Text.Root(East.str`Slots: ${row.start} – ${row.end}`),
                ], { gap: "2" }),
            })],
            { maxSlot: 8.0 }
        );
    }),
    inputs: [],
});

export const plannerEventTooltip = example({
    keywords: ["Planner", "tooltip", "hover", "rich"],
    description: "Per-event hover tooltip — pass a UIComponent into `tooltip` for rich preview content",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { resource: "Server A", status: "Active", start: 0.0, end: 4.0 },
                { resource: "Server B", status: "Idle", start: 2.0, end: 6.0 },
                { resource: "Server C", status: "Maintenance", start: 5.0, end: 8.0 },
            ],
            ["resource", "status"],
            row => [Planner.Event({
                start: row.start,
                end: row.end,
                label: { value: row.resource },
                colorPalette: "purple",
                tooltip: Stack.VStack([
                    Badge.Root(East.str`${row.resource}`, { colorPalette: "purple", variant: "solid" }),
                    Text.Root(East.str`Status: ${row.status}`),
                ], { gap: "1", padding: "0px" }),
            })],
            { maxSlot: 10.0 }
        );
    }),
    inputs: [],
});

export const plannerPopoverAndContextMenu = example({
    keywords: ["Planner", "popover", "onEventEdit", "onEventDelete", "combined"],
    description: "Click for popover, right-click for Edit/Delete context menu",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { project: "Alpha", phase: "Design", start: 1.0, end: 3.0 },
                { project: "Beta", phase: "Build", start: 2.0, end: 5.0 },
                { project: "Gamma", phase: "Test", start: 4.0, end: 7.0 },
            ],
            ["project", "phase"],
            row => [Planner.Event({
                start: row.start,
                end: row.end,
                label: { value: row.project },
                colorPalette: "orange",
                popover: Stack.VStack([
                    Text.Root(East.str`${row.project} — ${row.phase}`, { fontWeight: "semibold" }),
                    Text.Root(East.str`Time: ${row.start} to ${row.end}`),
                ], { gap: "2" }),
            })],
            {
                maxSlot: 8.0,
                onEventEdit: East.function([Planner.Types.ClickEvent], NullType, () => null),
                onEventDelete: East.function([Planner.Types.DeleteEvent], NullType, () => null),
            }
        );
    }),
    inputs: [],
});

export const plannerReadOnlyMode = example({
    keywords: ["Planner", "read-only", "no callbacks"],
    description: "Read-only planner — omit `onEventDrag` / `onEventResize` / `onEventAdd` callbacks; presence of callback determines which interactions are enabled.",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { task: "Fixed Task A", start: 1.0, end: 3.0 },
                { task: "Fixed Task B", start: 2.0, end: 5.0 },
                { task: "Fixed Task C", start: 4.0, end: 7.0 },
            ],
            ["task"],
            row => [Planner.Event({ start: row.start, end: row.end, colorPalette: "gray", label: { value: row.task } })],
            { maxSlot: 8.0 }
        );
    }),
    inputs: [],
});

export const plannerEventStyling = example({
    keywords: ["Planner", "Event", "label", "background", "stroke", "opacity", "color", "fontWeight", "fontStyle"],
    description: "Custom background, opacity, and label styling (color, font weight, style, size, alignment)",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { task: "Default", start: 1.0, end: 4.0 },
                { task: "Bold Red", start: 1.0, end: 4.0 },
                { task: "Custom BG", start: 1.0, end: 4.0 },
                { task: "Faded", start: 1.0, end: 4.0 },
            ],
            ["task"],
            () => [
                Planner.Event({
                    start: 1.0,
                    end: 3.0,
                    label: { value: "Default" },
                    colorPalette: "blue",
                }),
                Planner.Event({
                    start: 4.0,
                    end: 6.0,
                    label: { value: "Bold Red", color: "red.600", fontWeight: "bold", fontSize: "md" },
                    colorPalette: "gray",
                }),
                Planner.Event({
                    start: 7.0,
                    end: 9.0,
                    label: { value: "Centered", align: "center", color: "white", fontWeight: "semibold" },
                    background: "#ff69b4",
                    stroke: "#c71585",
                }),
                Planner.Event({
                    start: 10.0,
                    end: 12.0,
                    label: { value: "Faded Italic", fontStyle: "italic" },
                    colorPalette: "red",
                    opacity: 0.5,
                }),
            ],
            { maxSlot: 13.0 }
        );
    }),
    inputs: [],
});

export const plannerOverlappingEvents = example({
    keywords: ["Planner", "Event", "overlapping", "hover", "dim"],
    description: "Hover over an event to dim others in the same row, making overlapping labels readable",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { resource: "Team Alpha", category: "Development" },
                { resource: "Team Beta", category: "Design" },
            ],
            ["resource", "category"],
            () => [
                Planner.Event({ start: 0.0, end: 3.0, label: { value: "Task A" }, colorPalette: "blue" }),
                Planner.Event({ start: 2.0, end: 5.0, label: { value: "Task B (overlaps A)" }, colorPalette: "green" }),
                Planner.Event({ start: 4.0, end: 7.0, label: { value: "Task C (overlaps B)" }, colorPalette: "orange" }),
                Planner.Event({ start: 6.0, end: 9.0, label: { value: "Task D (overlaps C)" }, colorPalette: "purple" }),
            ],
            { maxSlot: 10.0 }
        );
    }),
    inputs: [],
});

export const plannerWithIcons = example({
    keywords: ["Planner", "Event", "icon", "align", "start", "center", "end"],
    description: "Icons can be positioned independently (start, center, end) with or without labels",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { task: "Icon at Start", position: "start" },
                { task: "Icon at Center", position: "center" },
                { task: "Icon at End", position: "end" },
                { task: "Icon + Label", position: "both" },
            ],
            ["task", "position"],
            () => [
                Planner.Event({
                    start: 0.0,
                    end: 3.0,
                    icon: { prefix: "fas", name: "check", align: "start" },
                    colorPalette: "green",
                }),
                Planner.Event({
                    start: 4.0,
                    end: 7.0,
                    icon: { prefix: "fas", name: "spinner", align: "center" },
                    colorPalette: "blue",
                }),
                Planner.Event({
                    start: 8.0,
                    end: 11.0,
                    icon: { prefix: "fas", name: "flag", align: "end", color: "red.500" },
                    colorPalette: "gray",
                }),
                Planner.Event({
                    start: 0.0,
                    end: 5.0,
                    icon: { prefix: "fas", name: "play", align: "start", size: "lg" },
                    label: { value: "In Progress", align: "end" },
                    colorPalette: "purple",
                }),
            ],
            { maxSlot: 12.0 }
        );
    }),
    inputs: [],
});

export const plannerLabelAlignment = example({
    keywords: ["Planner", "Event", "label", "align", "verticalAlign"],
    description: "Labels can be positioned horizontally (start, center, end) and vertically (start, center, end)",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { position: "Top Left", hAlign: variant("start", null), vAlign: variant("start", null), color: variant("blue", null) },
                { position: "Top Center", hAlign: variant("center", null), vAlign: variant("start", null), color: variant("green", null) },
                { position: "Top Right", hAlign: variant("end", null), vAlign: variant("start", null), color: variant("purple", null) },
                { position: "Center Left", hAlign: variant("start", null), vAlign: variant("center", null), color: variant("teal", null) },
                { position: "Center", hAlign: variant("center", null), vAlign: variant("center", null), color: variant("orange", null) },
                { position: "Center Right", hAlign: variant("end", null), vAlign: variant("center", null), color: variant("cyan", null) },
                { position: "Bottom Left", hAlign: variant("start", null), vAlign: variant("end", null), color: variant("red", null) },
                { position: "Bottom Center", hAlign: variant("center", null), vAlign: variant("end", null), color: variant("pink", null) },
                { position: "Bottom Right", hAlign: variant("end", null), vAlign: variant("end", null), color: variant("gray", null) },
            ],
            ["position"],
            row => [
                Planner.Event({
                    start: 0.0,
                    end: 4.0,
                    label: { value: row.position, align: row.hAlign, verticalAlign: row.vAlign },
                    colorPalette: row.color,
                }),
            ],
            { maxSlot: 5.0 }
        );
    }),
    inputs: [],
});

export const plannerCustomHeight = example({
    keywords: ["Planner", "Root", "height"],
    description: "Set height via style to control container size",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { resource: "Alice", task: "Development", start: 1.0, end: 3.0 },
                { resource: "Bob", task: "Testing", start: 2.0, end: 5.0 },
                { resource: "Charlie", task: "Review", start: 4.0, end: 6.0 },
                { resource: "Diana", task: "Deploy", start: 5.0, end: 8.0 },
                { resource: "Eve", task: "Monitor", start: 7.0, end: 10.0 },
            ],
            ["resource", "task"],
            row => [Planner.Event({ start: row.start, end: row.end, colorPalette: "blue" })],
            { height: "200px", variant: "line" }
        );
    }),
    inputs: [],
});

export const plannerFrozenColumns = example({
    keywords: ["Planner", "frozen", "pin"],
    description: "Pin columns left so they stay visible while scrolling the timeline",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { id: "#1", resource: "Alice", dept: "Engineering", role: "Lead", priority: "High", start: 1.0, end: 4.0 },
                { id: "#2", resource: "Bob", dept: "Design", role: "Senior", priority: "Medium", start: 2.0, end: 6.0 },
                { id: "#3", resource: "Charlie", dept: "Engineering", role: "Junior", priority: "Low", start: 3.0, end: 7.0 },
                { id: "#4", resource: "Diana", dept: "QA", role: "Senior", priority: "High", start: 5.0, end: 9.0 },
                { id: "#5", resource: "Eve", dept: "DevOps", role: "Lead", priority: "Medium", start: 7.0, end: 10.0 },
            ],
            {
                id: { header: "ID", width: "80px" },
                resource: { header: "Resource", width: "150px" },
                dept: { header: "Department", width: "150px" },
                role: { header: "Role", width: "120px" },
                priority: { header: "Priority", width: "120px" },
            },
            row => [Planner.Event({ start: row.start, end: row.end })],
            {
                frozen: ["id", "resource"],
                variant: "line",
                striped: true,
                height: "300px",
            }
        );
    }),
    inputs: [],
});

// ============================================================================
// Plan 1.10 — rowStatus + root chrome colour slots
// ============================================================================

export const plannerRowStatus = example({
    keywords: ["Planner", "rowStatus", "StatusToken", "tint", "theme-agnostic"],
    description: "Row-status tint — `rowStatus` paints each row background with a semantic token",
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
        return Planner.Root(
            [
                { name: "Alice", slot: 1.0 },
                { name: "Bob", slot: 3.0 },
                { name: "Charlie", slot: 5.0 },
            ],
            { name: { header: "Name" } },
            row => [Planner.Event({ start: row.slot })],
            { rowStatus, slotMode: "single" },
        );
    }),
    inputs: [],
});

export const plannerChromeColours = example({
    keywords: ["Planner", "gridColor", "nowMarkerColor", "headerBackground", "headerColor", "chrome"],
    description: "Root chrome colour overrides — explicit grid / now-marker / header colours",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [{ name: "Alice", slot: 1.0 }, { name: "Bob", slot: 3.0 }],
            { name: { header: "Name" } },
            row => [Planner.Event({ start: row.slot })],
            {
                slotMode: "single",
                gridColor: "blue.100",
                nowMarkerColor: "red.500",
                headerBackground: "blue.50",
                headerColor: "blue.900",
            },
        );
    }),
    inputs: [],
});

// ============================================================================
// Plan 1.10 H — per-event overlays + visual-parity tokens + live interactivity
// ============================================================================

export const plannerEventOverlays = example({
    keywords: ["Planner", "Event", "overlays", "axis", "align", "verticalAlign", "Badge", "Icon"],
    description: "Per-event overlays — UIComponents pinned to corners of the event bar (priority chip top-right, status icon bottom-left)",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            [
                { task: "API redesign", priority: "HIGH", start: 0.0, end: 4.0 },
                { task: "UI polish", priority: "LOW", start: 2.0, end: 6.0 },
            ],
            ["task", "priority"],
            row => [Planner.Event({
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
            })],
            { maxSlot: 8.0 },
        );
    }),
    inputs: [],
});

export const plannerVisualTokens = example({
    keywords: ["Planner", "eventBorderRadius", "labelColor", "labelFontSize", "labelFontWeight", "visual", "tokens"],
    description: "Visual-parity tokens — `eventBorderRadius` / `labelColor` / `labelFontSize` / `labelFontWeight` set defaults; per-event `label.color` etc. override",
    fn: East.function([], UIComponentType, (_$) => {
        return Planner.Root(
            // Single row carrying two events on the same track. The first
            // event inherits the cascading style-level label tokens; the
            // second overrides them via per-event `label.color` /
            // `fontSize` / `fontWeight`.
            [{ row: "demo" }],
            ["row"],
            (_row) => [
                Planner.Event({
                    start: 0.0,
                    end: 4.0,
                    label: { value: "Inherits defaults" },
                    colorPalette: "teal",
                }),
                Planner.Event({
                    start: 5.0,
                    end: 9.0,
                    label: {
                        value: "Overrides per-event",
                        color: "yellow.300",
                        fontSize: "lg",
                        fontWeight: "bold",
                    },
                    colorPalette: "teal",
                }),
            ],
            {
                maxSlot: 10.0,
                eventBorderRadius: "8px",
                labelColor: "white",
                labelFontSize: "0.875rem",
                labelFontWeight: "700",
            },
        );
    }),
    inputs: [],
});

export const plannerInteractive = example({
    keywords: ["Planner", "Reactive", "State", "onEventDrag", "onEventResize", "onEventAdd", "interactive", "live"],
    description: "Live interactivity — drag, resize, and click-on-empty-slot fire callbacks that update state; absence of a callback would disable that interaction",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const startBind = $.let(State.bind([FloatType], "planner_event_start", 1.0));
            const endBind = $.let(State.bind([FloatType], "planner_event_end", 4.0));
            const eventStart = $.let(startBind.read());
            const eventEnd = $.let(endBind.read());

            const onEventDrag = $.const(East.function(
                [Planner.Types.DragEvent],
                NullType,
                ($, event) => {
                    $(startBind.write(event.newStart));
                    $(endBind.write(event.newEnd));
                },
            ));

            const onEventResize = $.const(East.function(
                [Planner.Types.ResizeEvent],
                NullType,
                ($, event) => {
                    $(startBind.write(event.newStart));
                    $(endBind.write(event.newEnd));
                },
            ));

            const onEventAdd = $.const(East.function(
                [Planner.Types.AddEvent],
                NullType,
                ($, event) => {
                    $(startBind.write(event.slot));
                    $(endBind.write(event.slot.add(2.0)));
                },
            ));

            return Stack.VStack([
                Planner.Root(
                    [{ name: "Drag, resize, or click an empty slot" }],
                    { name: { header: "Demo" } },
                    _row => [Planner.Event({
                        start: eventStart,
                        end: eventEnd,
                        label: { value: "Drag me / resize edges" },
                        colorPalette: "orange",
                    })],
                    {
                        minSlot: 0.0,
                        maxSlot: 10.0,
                        onEventDrag,
                        onEventResize,
                        onEventAdd,
                    },
                ),
                Text.Root(
                    East.str`Position: slot ${eventStart} → ${eventEnd}`,
                    { textStyle: "body-sm", color: "fg.muted" },
                ),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const plannerReactiveClick = example({
    keywords: ["Planner", "Reactive", "State", "onEventClick", "reactive", "callback"],
    description: "Reactive click — `onEventClick` writes the clicked event's identity to state and a Badge below the planner reflects it",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const lastClickBind = $.let(State.bind([StringType], "planner_last_click", ""));
            const lastClick = $.let(lastClickBind.read());

            const onEventClick = $.const(East.function(
                [Planner.Types.ClickEvent],
                NullType,
                ($, event) => {
                    $(lastClickBind.write(
                        East.str`row ${event.rowIndex}, event ${event.eventIndex}, slots ${event.start}-${event.end}`,
                    ));
                },
            ));

            return Stack.VStack([
                Planner.Root(
                    [
                        { team: "Alpha", start: 1.0, end: 3.0 },
                        { team: "Beta", start: 2.0, end: 5.0 },
                        { team: "Gamma", start: 4.0, end: 7.0 },
                    ],
                    ["team"],
                    row => [Planner.Event({
                        start: row.start,
                        end: row.end,
                        label: { value: row.team },
                        colorPalette: "cyan",
                    })],
                    { maxSlot: 8.0, onEventClick },
                ),
                Badge.Root(
                    East.equal(lastClick.length(), 0n).ifElse(
                        _$ => "Click any event",
                        _$ => East.str`Last click: ${lastClick}`,
                    ),
                    { colorPalette: "cyan", variant: "outline" },
                ),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const plannerEventPopoverWithCallback = example({
    keywords: ["Planner", "popover", "onEventClick", "coexist", "callback"],
    description: "Per-event popover coexists with `onEventClick` — clicking the bar opens the popover AND fires the callback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const clicksBind = $.let(State.bind([IntegerType], "planner_popover_clicks", 0n));
            const clicks = $.let(clicksBind.read());

            const onEventClick = $.const(East.function(
                [Planner.Types.ClickEvent],
                NullType,
                ($, _event) => {
                    const current = $.let(clicksBind.read(), IntegerType);
                    $(clicksBind.write(current.add(1n)));
                },
            ));

            return Stack.VStack([
                Planner.Root(
                    [{ task: "Status review", owner: "Alice", start: 1.0, end: 4.0 }],
                    ["task", "owner"],
                    row => [Planner.Event({
                        start: row.start,
                        end: row.end,
                        label: { value: row.task },
                        colorPalette: "purple",
                        popover: Stat.Root(
                            "Total clicks",
                            East.str`${clicks}`,
                            { helpText: "Counter increments every click — popover and callback coexist." },
                        ),
                    })],
                    { maxSlot: 6.0, onEventClick },
                ),
                Text.Root(
                    East.str`Clicked ${clicks} times`,
                    { textStyle: "body-sm", color: "fg.muted" },
                ),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
