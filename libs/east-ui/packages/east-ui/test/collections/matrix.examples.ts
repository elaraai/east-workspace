/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { ArrayType, East, FloatType, IntegerType, NullType, StringType, example } from "@elaraai/east";
import {
    Avatar,
    Badge,
    Icon,
    Matrix,
    Reactive,
    Stack,
    Stat,
    State,
    Text,
    UIComponentType,
} from "@elaraai/east-ui";

export const matrixBasic = example({
    keywords: ["Matrix", "Root", "heat-grid", "basic", "segments", "dict"],
    description: "Assignment grid — rich row headers, dict-keyed cells, booked / free segment weights",
    fn: East.function([], UIComponentType, ($) => {
        const userHeader = $.const(East.function([StringType, StringType], UIComponentType, ($, name, role) => Stack.HStack([
            Avatar.Root({ name, size: "sm" }),
            Stack.VStack([
                Text.Root(name, { fontWeight: "semibold" }),
                Text.Root(role, { textStyle: "caption", color: "gray.500" }),
            ], { gap: "0", align: "flex-start" }),
        ], { gap: "2", align: "center" })));
        const dayHeader = $.const(East.function([StringType, StringType], UIComponentType, ($, day, date) => Stack.VStack([
            Text.Root(day, { fontWeight: "semibold" }),
            Text.Root(date, { textStyle: "caption", color: "gray.500" }),
        ], { gap: "0", align: "center" })));
        return Matrix.Root(
            [
                { key: "alice", header: userHeader("Alice Chen", "Senior PM"), cells: {
                    mon: { segments: [{ category: "booked", weight: 0.8 }, { category: "free", weight: 0.2 }] },
                    tue: { segments: [{ category: "booked", weight: 0.4 }, { category: "free", weight: 0.6 }] },
                    wed: { segments: [{ category: "booked", weight: 1.0 }] },
                    thu: { segments: [{ category: "booked", weight: 0.6 }, { category: "free", weight: 0.4 }] },
                    fri: { segments: [{ category: "free", weight: 1.0 }] },
                }},
                { key: "bob", header: userHeader("Bob Martinez", "Designer"), cells: {
                    mon: { segments: [{ category: "booked", weight: 0.5 }, { category: "free", weight: 0.5 }] },
                    tue: { segments: [{ category: "booked", weight: 0.9 }, { category: "free", weight: 0.1 }] },
                    wed: { segments: [{ category: "booked", weight: 0.3 }, { category: "free", weight: 0.7 }] },
                    thu: { segments: [{ category: "booked", weight: 1.0 }] },
                    fri: { segments: [{ category: "booked", weight: 0.5 }, { category: "free", weight: 0.5 }] },
                }},
            ],
            [
                { key: "mon", header: dayHeader("Mon", "Apr 22") },
                { key: "tue", header: dayHeader("Tue", "Apr 23") },
                { key: "wed", header: dayHeader("Wed", "Apr 24") },
                { key: "thu", header: dayHeader("Thu", "Apr 25") },
                { key: "fri", header: dayHeader("Fri", "Apr 26") },
            ],
            {
                legend: [
                    { category: "booked", color: "blue.400", label: "Booked" },
                    { category: "free", color: "gray.200", label: "Free" },
                ],
                rowHeaderWidth: "200px",
            },
        );
    }),
    inputs: [],
});

export const matrixMultiSegment = example({
    keywords: ["Matrix", "Root", "segments", "stacked", "multi-category"],
    description: "Multi-segment cells — committed / pending / slack proportional split",
    fn: East.function([], UIComponentType, (_$) => {
        return Matrix.Root(
            [
                { key: "sprint-1", header: Text.Root("Sprint 1", { fontWeight: "semibold" }), cells: {
                    design: { segments: [
                        { category: "committed", weight: 0.6 },
                        { category: "pending", weight: 0.3 },
                        { category: "slack", weight: 0.1 },
                    ] },
                    dev: { segments: [
                        { category: "committed", weight: 0.8 },
                        { category: "pending", weight: 0.2 },
                    ] },
                    qa: { segments: [
                        { category: "committed", weight: 0.3 },
                        { category: "pending", weight: 0.5 },
                        { category: "slack", weight: 0.2 },
                    ] },
                }},
                { key: "sprint-2", header: Text.Root("Sprint 2", { fontWeight: "semibold" }), cells: {
                    design: { segments: [
                        { category: "committed", weight: 0.4 },
                        { category: "pending", weight: 0.4 },
                        { category: "slack", weight: 0.2 },
                    ] },
                    dev: { segments: [{ category: "committed", weight: 1.0 }] },
                    qa: { segments: [{ category: "slack", weight: 1.0 }] },
                }},
            ],
            [
                { key: "design", header: Text.Root("Design", { fontWeight: "semibold" }) },
                { key: "dev", header: Text.Root("Development", { fontWeight: "semibold" }) },
                { key: "qa", header: Text.Root("QA", { fontWeight: "semibold" }) },
            ],
            {
                legend: [
                    { category: "committed", color: "green.400", label: "Committed" },
                    { category: "pending", color: "orange.400", label: "Pending" },
                    { category: "slack", color: "gray.200", label: "Slack" },
                ],
            },
        );
    }),
    inputs: [],
});

export const matrixWithOverlays = example({
    keywords: ["Matrix", "Root", "overlays", "badge", "icon", "alerts"],
    description: "Cells with rich overlays at different corners — badges, icons, and text",
    fn: East.function([], UIComponentType, ($) => {
        const userHeader = $.const(East.function([StringType, StringType], UIComponentType, ($, name, role) => Stack.HStack([
            Avatar.Root({ name, size: "sm" }),
            Stack.VStack([
                Text.Root(name, { fontWeight: "semibold" }),
                Text.Root(role, { textStyle: "caption", color: "gray.500" }),
            ], { gap: "0", align: "flex-start" }),
        ], { gap: "2", align: "center" })));
        const dayHeader = $.const(East.function([StringType, StringType], UIComponentType, ($, day, date) => Stack.VStack([
            Text.Root(day, { fontWeight: "semibold" }),
            Text.Root(date, { textStyle: "caption", color: "gray.500" }),
        ], { gap: "0", align: "center" })));
        return Matrix.Root(
            [
                { key: "alice", header: userHeader("Alice Chen", "PM"), cells: {
                    mon: {
                        segments: [{ category: "booked", weight: 0.8 }, { category: "free", weight: 0.2 }],
                        overlays: [
                            { align: "end", verticalAlign: "start", content: Badge.Root("!", { variant: "solid", colorPalette: "red", size: "sm" }) },
                            { align: "start", verticalAlign: "end", content: Text.Root("6.4h", { textStyle: "caption", color: "white", fontWeight: "semibold" }) },
                        ],
                    },
                    tue: {
                        segments: [{ category: "booked", weight: 0.5 }, { category: "free", weight: 0.5 }],
                        overlays: [
                            { align: "start", verticalAlign: "end", content: Text.Root("4h", { textStyle: "caption", color: "white", fontWeight: "semibold" }) },
                            { align: "end", verticalAlign: "start", content: Icon.Root("fas", "users", { color: "gray.600", size: "xs" }) },
                        ],
                    },
                    wed: {
                        segments: [{ category: "booked", weight: 1.0 }],
                        overlays: [
                            { align: "end", verticalAlign: "start", content: Badge.Root("OT", { variant: "solid", colorPalette: "purple", size: "sm" }) },
                            { align: "start", verticalAlign: "end", content: Text.Root("9h", { textStyle: "caption", color: "white", fontWeight: "semibold" }) },
                        ],
                    },
                }},
            ],
            [
                { key: "mon", header: dayHeader("Mon", "Apr 22") },
                { key: "tue", header: dayHeader("Tue", "Apr 23") },
                { key: "wed", header: dayHeader("Wed", "Apr 24") },
            ],
            {
                legend: [{ category: "booked", color: "blue.400", label: "Booked" }, { category: "free", color: "gray.200", label: "Free" }],
                rowHeaderWidth: "200px",
            },
        );
    }),
    inputs: [],
});

export const matrixEmphasis = example({
    keywords: ["Matrix", "Root", "emphasis", "emphasisColor", "ring", "at-risk"],
    description: "Emphasis — cells with `emphasisColor` set get a bright ring. Presence of the field implies emphasis (no separate boolean).",
    fn: East.function([], UIComponentType, ($) => {
        const userHeader = $.const(East.function([StringType, StringType], UIComponentType, ($, name, role) => Stack.HStack([
            Avatar.Root({ name, size: "sm" }),
            Stack.VStack([
                Text.Root(name, { fontWeight: "semibold" }),
                Text.Root(role, { textStyle: "caption", color: "gray.500" }),
            ], { gap: "0", align: "flex-start" }),
        ], { gap: "2", align: "center" })));
        const dayHeader = $.const(East.function([StringType, StringType], UIComponentType, ($, day, date) => Stack.VStack([
            Text.Root(day, { fontWeight: "semibold" }),
            Text.Root(date, { textStyle: "caption", color: "gray.500" }),
        ], { gap: "0", align: "center" })));
        return Matrix.Root(
            [
                { key: "alice", header: userHeader("Alice Chen", "PM"), cells: {
                    mon: { segments: [{ category: "booked", weight: 0.6 }, { category: "free", weight: 0.4 }] },
                    tue: { segments: [{ category: "booked", weight: 0.6 }, { category: "free", weight: 0.4 }] },
                    wed: {
                        segments: [{ category: "at-risk", weight: 1.0, color: "red.400" }],
                        emphasisColor: "red.500",
                        overlays: [
                            { content: Icon.Root("fas", "triangle-exclamation", { color: "white", size: "md" }) },
                        ],
                    },
                    thu: { segments: [{ category: "booked", weight: 0.6 }, { category: "free", weight: 0.4 }] },
                }},
                { key: "bob", header: userHeader("Bob Martinez", "Design"), cells: {
                    mon: { segments: [{ category: "booked", weight: 0.4 }, { category: "free", weight: 0.6 }] },
                    tue: {
                        segments: [{ category: "at-risk", weight: 1.0, color: "red.400" }],
                        emphasisColor: "red.500",
                        overlays: [
                            { content: Icon.Root("fas", "triangle-exclamation", { color: "white", size: "md" }) },
                        ],
                    },
                    wed: { segments: [{ category: "booked", weight: 0.6 }, { category: "free", weight: 0.4 }] },
                    thu: { segments: [{ category: "booked", weight: 0.6 }, { category: "free", weight: 0.4 }] },
                }},
            ],
            [
                { key: "mon", header: dayHeader("Mon", "Apr 22") },
                { key: "tue", header: dayHeader("Tue", "Apr 23") },
                { key: "wed", header: dayHeader("Wed", "Apr 24") },
                { key: "thu", header: dayHeader("Thu", "Apr 25") },
            ],
            {
                legend: [
                    { category: "booked", color: "blue.400", label: "Booked" },
                    { category: "free", color: "gray.200", label: "Free" },
                    { category: "at-risk", color: "red.400", label: "At risk" },
                ],
                rowHeaderWidth: "200px",
            },
        );
    }),
    inputs: [],
});

export const matrixVerticalOrientation = example({
    keywords: ["Matrix", "Root", "cellOrientation", "vertical", "capacity", "dashboard"],
    description: "Vertical segment orientation — each cell reads as a stacked vertical capacity bar",
    fn: East.function([], UIComponentType, ($) => {
        const dayHeader = $.const(East.function([StringType, StringType], UIComponentType, ($, day, date) => Stack.VStack([
            Text.Root(day, { fontWeight: "semibold" }),
            Text.Root(date, { textStyle: "caption", color: "gray.500" }),
        ], { gap: "0", align: "center" })));
        return Matrix.Root(
            [
                { key: "team-a", header: Text.Root("Team A", { fontWeight: "semibold" }), cells: {
                    mon: { segments: [{ category: "used", weight: 0.7 }, { category: "free", weight: 0.3 }] },
                    tue: { segments: [{ category: "used", weight: 0.4 }, { category: "free", weight: 0.6 }] },
                    wed: { segments: [{ category: "used", weight: 0.9 }, { category: "free", weight: 0.1 }] },
                    thu: { segments: [{ category: "used", weight: 0.6 }, { category: "free", weight: 0.4 }] },
                    fri: { segments: [{ category: "used", weight: 0.3 }, { category: "free", weight: 0.7 }] },
                }},
                { key: "team-b", header: Text.Root("Team B", { fontWeight: "semibold" }), cells: {
                    mon: { segments: [{ category: "used", weight: 0.5 }, { category: "free", weight: 0.5 }] },
                    tue: { segments: [{ category: "used", weight: 0.8 }, { category: "free", weight: 0.2 }] },
                    wed: { segments: [{ category: "used", weight: 0.3 }, { category: "free", weight: 0.7 }] },
                    thu: { segments: [{ category: "used", weight: 1.0 }] },
                    fri: { segments: [{ category: "used", weight: 0.4 }, { category: "free", weight: 0.6 }] },
                }},
            ],
            [
                { key: "mon", header: dayHeader("Mon", "Apr 22") },
                { key: "tue", header: dayHeader("Tue", "Apr 23") },
                { key: "wed", header: dayHeader("Wed", "Apr 24") },
                { key: "thu", header: dayHeader("Thu", "Apr 25") },
                { key: "fri", header: dayHeader("Fri", "Apr 26") },
            ],
            {
                cellOrientation: "vertical",
                legend: [
                    { category: "used", color: "blue.400", label: "Used capacity" },
                    { category: "free", color: "gray.200", label: "Available" },
                ],
                rowHeaderWidth: "140px",
                columnHeaderHeight: "52px",
            },
        );
    }),
    inputs: [],
});

export const matrixBrushSelection = example({
    keywords: ["Matrix", "Root", "brushSelection", "controlled", "Reactive", "State"],
    description: "Controlled brush selection — drag to select cells; `selected` in State drives the highlight, `onChange` syncs back",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const userHeader = $.const(East.function([StringType, StringType], UIComponentType, ($, name, role) => Stack.HStack([
                Avatar.Root({ name, size: "sm" }),
                Stack.VStack([
                    Text.Root(name, { fontWeight: "semibold" }),
                    Text.Root(role, { textStyle: "caption", color: "gray.500" }),
                ], { gap: "0", align: "flex-start" }),
            ], { gap: "2", align: "center" })));
            const dayHeader = $.const(East.function([StringType, StringType], UIComponentType, ($, day, date) => Stack.VStack([
                Text.Root(day, { fontWeight: "semibold" }),
                Text.Root(date, { textStyle: "caption", color: "gray.500" }),
            ], { gap: "0", align: "center" })));
            const selBind = $.let(State.bind([ArrayType(Matrix.Types.BrushCoord)], "matrix_brush_selected", []));
            const selected = $.let(selBind.read(), ArrayType(Matrix.Types.BrushCoord));
            const onChange = $.const(East.function([ArrayType(Matrix.Types.BrushCoord)], NullType, ($, next) => {
                $(selBind.write(next));
            }));
            return Stack.VStack([
                Matrix.Root(
                    [
                        { key: "alice", header: userHeader("Alice Chen", "PM"), cells: {
                            mon: { segments: [{ category: "booked", weight: 0.8 }] },
                            tue: { segments: [{ category: "booked", weight: 0.5 }] },
                            wed: { segments: [{ category: "booked", weight: 0.3 }] },
                            thu: { segments: [{ category: "booked", weight: 0.9 }] },
                        }},
                        { key: "bob", header: userHeader("Bob Martinez", "Design"), cells: {
                            mon: { segments: [{ category: "booked", weight: 0.4 }] },
                            tue: { segments: [{ category: "booked", weight: 0.9 }] },
                            wed: { segments: [{ category: "booked", weight: 0.6 }] },
                            thu: { segments: [{ category: "booked", weight: 0.7 }] },
                        }},
                    ],
                    [
                        { key: "mon", header: dayHeader("Mon", "Apr 22") },
                        { key: "tue", header: dayHeader("Tue", "Apr 23") },
                        { key: "wed", header: dayHeader("Wed", "Apr 24") },
                        { key: "thu", header: dayHeader("Thu", "Apr 25") },
                    ],
                    {
                        brushSelection: { enabled: true, selected, onChange },
                        legend: [{ category: "booked", color: "blue.400", label: "Booked" }],
                        rowHeaderWidth: "200px",
                    },
                ),
                Badge.Root(East.str`Selected: ${East.print(selected.size())} cells`, { variant: "subtle", colorPalette: "blue" }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const matrixReactiveClick = example({
    keywords: ["Matrix", "Root", "onCellClick", "Reactive", "State"],
    description: "Reactive cell click — selected `{row, column}` is tracked in State and shown as confirmation badges",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const userHeader = $.const(East.function([StringType, StringType], UIComponentType, ($, name, role) => Stack.HStack([
                Avatar.Root({ name, size: "sm" }),
                Stack.VStack([
                    Text.Root(name, { fontWeight: "semibold" }),
                    Text.Root(role, { textStyle: "caption", color: "gray.500" }),
                ], { gap: "0", align: "flex-start" }),
            ], { gap: "2", align: "center" })));
            const dayHeader = $.const(East.function([StringType, StringType], UIComponentType, ($, day, date) => Stack.VStack([
                Text.Root(day, { fontWeight: "semibold" }),
                Text.Root(date, { textStyle: "caption", color: "gray.500" }),
            ], { gap: "0", align: "center" })));
            const rowBind = $.let(State.bind([StringType], "matrix_sel_row", ""));
            const colBind = $.let(State.bind([StringType], "matrix_sel_col", ""));
            const countBind = $.let(State.bind([IntegerType], "matrix_click_count", 0n));

            const row = $.let(rowBind.read(), StringType);
            const column = $.let(colBind.read(), StringType);
            const count = $.let(countBind.read(), IntegerType);

            const onCellClick = $.const(East.function([Matrix.Types.BrushCoord], NullType, ($, coord) => {
                const current = $.let(countBind.read(), IntegerType);
                $(rowBind.write(coord.row));
                $(colBind.write(coord.column));
                $(countBind.write(current.add(1n)));
            }));

            return Stack.VStack([
                Matrix.Root(
                    [
                        { key: "alice", header: userHeader("Alice Chen", "PM"), cells: {
                            mon: { segments: [{ category: "booked", weight: 0.8 }] },
                            tue: { segments: [{ category: "booked", weight: 0.5 }] },
                            wed: { segments: [{ category: "booked", weight: 0.3 }] },
                        }},
                        { key: "bob", header: userHeader("Bob Martinez", "Design"), cells: {
                            mon: { segments: [{ category: "booked", weight: 0.4 }] },
                            tue: { segments: [{ category: "booked", weight: 0.9 }] },
                            wed: { segments: [{ category: "booked", weight: 0.6 }] },
                        }},
                    ],
                    [
                        { key: "mon", header: dayHeader("Mon", "Apr 22") },
                        { key: "tue", header: dayHeader("Tue", "Apr 23") },
                        { key: "wed", header: dayHeader("Wed", "Apr 24") },
                    ],
                    {
                        onCellClick,
                        legend: [{ category: "booked", color: "blue.400", label: "Booked" }],
                        rowHeaderWidth: "200px",
                    },
                ),
                Stack.HStack([
                    Badge.Root(East.str`Clicks: ${East.print(count)}`, { variant: "subtle", colorPalette: "gray" }),
                    Badge.Root(East.str`Last: ${row}, ${column}`, { variant: "subtle", colorPalette: "blue" }),
                ], { gap: "2" }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const matrixReactiveSegmentEdit = example({
    keywords: ["Matrix", "Root", "onSegmentChange", "drag", "resize", "Reactive", "State"],
    description: "Drag-to-resize segments — `onSegmentChange` writes the new weight back to State; dragging a segment edge rebalances within the cell. Live values shown below update as you drag.",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const userHeader = $.const(East.function([StringType, StringType], UIComponentType, ($, name, role) => Stack.HStack([
                Avatar.Root({ name, size: "sm" }),
                Stack.VStack([
                    Text.Root(name, { fontWeight: "semibold" }),
                    Text.Root(role, { textStyle: "caption", color: "gray.500" }),
                ], { gap: "0", align: "flex-start" }),
            ], { gap: "2", align: "center" })));
            const dayHeader = $.const(East.function([StringType, StringType], UIComponentType, ($, day, date) => Stack.VStack([
                Text.Root(day, { fontWeight: "semibold" }),
                Text.Root(date, { textStyle: "caption", color: "gray.500" }),
            ], { gap: "0", align: "center" })));
            const monBooked = $.let(State.bind([FloatType], "matrix_edit_mon_booked", 0.7));
            const tueBooked = $.let(State.bind([FloatType], "matrix_edit_tue_booked", 0.5));
            const wedBooked = $.let(State.bind([FloatType], "matrix_edit_wed_booked", 0.9));

            const monW = $.let(monBooked.read(), FloatType);
            const tueW = $.let(tueBooked.read(), FloatType);
            const wedW = $.let(wedBooked.read(), FloatType);

            const monPct = $.let(East.Float.roundHalf(monW.multiply(100.0)), IntegerType);
            const tuePct = $.let(East.Float.roundHalf(tueW.multiply(100.0)), IntegerType);
            const wedPct = $.let(East.Float.roundHalf(wedW.multiply(100.0)), IntegerType);

            const onSegmentChange = $.const(East.function([Matrix.Types.SegmentChangeEvent], NullType, ($, evt) => {
                $.if(evt.column.equals("mon").and(() => evt.category.equals("booked")), $ => {
                    $(monBooked.write(evt.weight));
                });
                $.if(evt.column.equals("tue").and(() => evt.category.equals("booked")), $ => {
                    $(tueBooked.write(evt.weight));
                });
                $.if(evt.column.equals("wed").and(() => evt.category.equals("booked")), $ => {
                    $(wedBooked.write(evt.weight));
                });
            }));

            return Matrix.Root(
                [
                    { key: "alice", header: userHeader("Alice Chen", "PM"), cells: {
                        mon: { segments: [
                            { category: "booked", weight: monW, step: 0.05, label: East.str`${East.print(monPct)}%` },
                            { category: "free", weight: East.value(1.0).subtract(monW), label: East.str`${East.print(East.value(100n).subtract(monPct))}%` },
                        ]},
                        tue: { segments: [
                            { category: "booked", weight: tueW, step: 0.05, label: East.str`${East.print(tuePct)}%` },
                            { category: "free", weight: East.value(1.0).subtract(tueW), label: East.str`${East.print(East.value(100n).subtract(tuePct))}%` },
                        ]},
                        wed: { segments: [
                            { category: "booked", weight: wedW, step: 0.05, label: East.str`${East.print(wedPct)}%` },
                            { category: "free", weight: East.value(1.0).subtract(wedW), label: East.str`${East.print(East.value(100n).subtract(wedPct))}%` },
                        ]},
                    }},
                ],
                [
                    { key: "mon", header: dayHeader("Mon", "Apr 22") },
                    { key: "tue", header: dayHeader("Tue", "Apr 23") },
                    { key: "wed", header: dayHeader("Wed", "Apr 24") },
                ],
                {
                    onSegmentChange,
                    legend: [{ category: "booked", color: "blue.400", label: "Booked" }, { category: "free", color: "gray.200", label: "Free" }],
                    rowHeaderWidth: "200px",
                },
            );
        }));
    }),
    inputs: [],
});

export const matrixReactiveSegmentEditMulti = example({
    keywords: ["Matrix", "Root", "onSegmentChange", "drag", "resize", "multi-segment", "Reactive", "State"],
    description: "Multi-segment drag-resize — three categories per cell (committed / pending / slack); both internal boundaries are draggable, slack auto-fills the remainder. Live values shown below.",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const designCommitted = $.let(State.bind([FloatType], "matrix_multi_design_committed", 0.5));
            const designPending = $.let(State.bind([FloatType], "matrix_multi_design_pending", 0.3));
            const devCommitted = $.let(State.bind([FloatType], "matrix_multi_dev_committed", 0.7));
            const devPending = $.let(State.bind([FloatType], "matrix_multi_dev_pending", 0.2));
            const qaCommitted = $.let(State.bind([FloatType], "matrix_multi_qa_committed", 0.3));
            const qaPending = $.let(State.bind([FloatType], "matrix_multi_qa_pending", 0.4));

            const designC = $.let(designCommitted.read(), FloatType);
            const designP = $.let(designPending.read(), FloatType);
            const devC = $.let(devCommitted.read(), FloatType);
            const devP = $.let(devPending.read(), FloatType);
            const qaC = $.let(qaCommitted.read(), FloatType);
            const qaP = $.let(qaPending.read(), FloatType);

            const designCPct = $.let(East.Float.roundHalf(designC.multiply(100.0)), IntegerType);
            const designPPct = $.let(East.Float.roundHalf(designP.multiply(100.0)), IntegerType);
            const designSPct = $.let(East.value(100n).subtract(designCPct).subtract(designPPct), IntegerType);
            const devCPct = $.let(East.Float.roundHalf(devC.multiply(100.0)), IntegerType);
            const devPPct = $.let(East.Float.roundHalf(devP.multiply(100.0)), IntegerType);
            const devSPct = $.let(East.value(100n).subtract(devCPct).subtract(devPPct), IntegerType);
            const qaCPct = $.let(East.Float.roundHalf(qaC.multiply(100.0)), IntegerType);
            const qaPPct = $.let(East.Float.roundHalf(qaP.multiply(100.0)), IntegerType);
            const qaSPct = $.let(East.value(100n).subtract(qaCPct).subtract(qaPPct), IntegerType);

            const onSegmentChange = $.const(East.function([Matrix.Types.SegmentChangeEvent], NullType, ($, evt) => {
                $.if(evt.column.equals("design").and(() => evt.category.equals("committed")), $ => {
                    $(designCommitted.write(evt.weight));
                });
                $.if(evt.column.equals("design").and(() => evt.category.equals("pending")), $ => {
                    $(designPending.write(evt.weight));
                });
                $.if(evt.column.equals("dev").and(() => evt.category.equals("committed")), $ => {
                    $(devCommitted.write(evt.weight));
                });
                $.if(evt.column.equals("dev").and(() => evt.category.equals("pending")), $ => {
                    $(devPending.write(evt.weight));
                });
                $.if(evt.column.equals("qa").and(() => evt.category.equals("committed")), $ => {
                    $(qaCommitted.write(evt.weight));
                });
                $.if(evt.column.equals("qa").and(() => evt.category.equals("pending")), $ => {
                    $(qaPending.write(evt.weight));
                });
            }));

            return Matrix.Root(
                [
                    { key: "sprint-1", header: Text.Root("Sprint 1", { fontWeight: "semibold" }), cells: {
                        design: { segments: [
                            { category: "committed", weight: designC, step: 0.05, min: 0.05, max: 0.9, label: East.str`${East.print(designCPct)}%` },
                            { category: "pending", weight: designP, step: 0.05, min: 0.05, max: 0.9, label: East.str`${East.print(designPPct)}%` },
                            { category: "slack", weight: East.value(1.0).subtract(designC).subtract(designP), label: East.str`${East.print(designSPct)}%` },
                        ]},
                        dev: { segments: [
                            { category: "committed", weight: devC, step: 0.05, min: 0.05, max: 0.9, label: East.str`${East.print(devCPct)}%` },
                            { category: "pending", weight: devP, step: 0.05, min: 0.05, max: 0.9, label: East.str`${East.print(devPPct)}%` },
                            { category: "slack", weight: East.value(1.0).subtract(devC).subtract(devP), label: East.str`${East.print(devSPct)}%` },
                        ]},
                        qa: { segments: [
                            { category: "committed", weight: qaC, step: 0.05, min: 0.05, max: 0.9, label: East.str`${East.print(qaCPct)}%` },
                            { category: "pending", weight: qaP, step: 0.05, min: 0.05, max: 0.9, label: East.str`${East.print(qaPPct)}%` },
                            { category: "slack", weight: East.value(1.0).subtract(qaC).subtract(qaP), label: East.str`${East.print(qaSPct)}%` },
                        ]},
                    }},
                ],
                [
                    { key: "design", header: Text.Root("Design", { fontWeight: "semibold" }) },
                    { key: "dev", header: Text.Root("Development", { fontWeight: "semibold" }) },
                    { key: "qa", header: Text.Root("QA", { fontWeight: "semibold" }) },
                ],
                {
                    onSegmentChange,
                    legend: [
                        { category: "committed", color: "green.400", label: "Committed" },
                        { category: "pending", color: "orange.400", label: "Pending" },
                        { category: "slack", color: "gray.200", label: "Slack" },
                    ],
                },
            );
        }));
    }),
    inputs: [],
});

export const matrixReactiveSegmentEditVertical = example({
    keywords: ["Matrix", "Root", "onSegmentChange", "cellOrientation", "vertical", "drag", "resize", "Reactive", "State"],
    description: "Vertical-orientation drag-resize — drag the top of a segment to rebalance utilization vs free capacity in a stacked vertical bar",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const dayHeader = $.const(East.function([StringType, StringType], UIComponentType, ($, day, date) => Stack.VStack([
                Text.Root(day, { fontWeight: "semibold" }),
                Text.Root(date, { textStyle: "caption", color: "gray.500" }),
            ], { gap: "0", align: "center" })));
            const monUsed = $.let(State.bind([FloatType], "matrix_vedit_mon_used", 0.7));
            const tueUsed = $.let(State.bind([FloatType], "matrix_vedit_tue_used", 0.4));
            const wedUsed = $.let(State.bind([FloatType], "matrix_vedit_wed_used", 0.9));
            const thuUsed = $.let(State.bind([FloatType], "matrix_vedit_thu_used", 0.6));
            const friUsed = $.let(State.bind([FloatType], "matrix_vedit_fri_used", 0.3));

            const monU = $.let(monUsed.read(), FloatType);
            const tueU = $.let(tueUsed.read(), FloatType);
            const wedU = $.let(wedUsed.read(), FloatType);
            const thuU = $.let(thuUsed.read(), FloatType);
            const friU = $.let(friUsed.read(), FloatType);

            const onSegmentChange = $.const(East.function([Matrix.Types.SegmentChangeEvent], NullType, ($, evt) => {
                $.if(evt.column.equals("mon").and(() => evt.category.equals("used")), $ => {
                    $(monUsed.write(evt.weight));
                });
                $.if(evt.column.equals("tue").and(() => evt.category.equals("used")), $ => {
                    $(tueUsed.write(evt.weight));
                });
                $.if(evt.column.equals("wed").and(() => evt.category.equals("used")), $ => {
                    $(wedUsed.write(evt.weight));
                });
                $.if(evt.column.equals("thu").and(() => evt.category.equals("used")), $ => {
                    $(thuUsed.write(evt.weight));
                });
                $.if(evt.column.equals("fri").and(() => evt.category.equals("used")), $ => {
                    $(friUsed.write(evt.weight));
                });
            }));

            return Matrix.Root(
                [
                    { key: "team-a", header: Text.Root("Team A", { fontWeight: "semibold" }), cells: {
                        mon: { segments: [{ category: "used", weight: monU, step: 0.05 }, { category: "free", weight: East.value(1.0).subtract(monU) }] },
                        tue: { segments: [{ category: "used", weight: tueU, step: 0.05 }, { category: "free", weight: East.value(1.0).subtract(tueU) }] },
                        wed: { segments: [{ category: "used", weight: wedU, step: 0.05 }, { category: "free", weight: East.value(1.0).subtract(wedU) }] },
                        thu: { segments: [{ category: "used", weight: thuU, step: 0.05 }, { category: "free", weight: East.value(1.0).subtract(thuU) }] },
                        fri: { segments: [{ category: "used", weight: friU, step: 0.05 }, { category: "free", weight: East.value(1.0).subtract(friU) }] },
                    }},
                ],
                [
                    { key: "mon", header: dayHeader("Mon", "Apr 22") },
                    { key: "tue", header: dayHeader("Tue", "Apr 23") },
                    { key: "wed", header: dayHeader("Wed", "Apr 24") },
                    { key: "thu", header: dayHeader("Thu", "Apr 25") },
                    { key: "fri", header: dayHeader("Fri", "Apr 26") },
                ],
                {
                    cellOrientation: "vertical",
                    onSegmentChange,
                    legend: [
                        { category: "used", color: "blue.400", label: "Used capacity" },
                        { category: "free", color: "gray.200", label: "Available" },
                    ],
                    rowHeaderWidth: "140px",
                    columnHeaderHeight: "52px",
                },
            );
        }));
    }),
    inputs: [],
});

// ============================================================================
// Plan 1.10 J — popover + minLabelSize coverage
// ============================================================================

export const matrixCellPopover = example({
    keywords: ["Matrix", "Cell", "popover", "click", "rich", "Stat"],
    description: "Per-cell click popover — pass a UIComponent into `popover` to open a rich Stat / form / detail view on cell click",
    fn: East.function([], UIComponentType, (_$) => {
        return Matrix.Root(
            [
                { key: "alice", header: Text.Root("Alice"), cells: {
                    mon: {
                        segments: [
                            { category: "booked", weight: 6.0 },
                            { category: "free", weight: 2.0 },
                        ],
                        popover: Stat.Root(
                            "Alice — Monday",
                            "6 booked / 2 free",
                            { helpText: "Click again to dismiss." },
                        ),
                    },
                    tue: {
                        segments: [{ category: "free", weight: 8.0 }],
                        popover: Stat.Root(
                            "Alice — Tuesday",
                            "Fully free",
                        ),
                    },
                } },
            ],
            [
                { key: "mon", header: Text.Root("Mon") },
                { key: "tue", header: Text.Root("Tue") },
            ],
            {
                legend: [
                    { category: "booked", color: "blue.500", label: "Booked" },
                    { category: "free", color: "green.300", label: "Free" },
                ],
            },
        );
    }),
    inputs: [],
});

export const matrixMinLabelSize = example({
    keywords: ["Matrix", "minLabelSize", "segment", "label", "threshold"],
    description: "`style.minLabelSize` suppresses segment labels when the rendered slice is too narrow — set lower to show more, higher to hide more",
    fn: East.function([], UIComponentType, (_$) => {
        return Matrix.Root(
            [
                { key: "task", header: Text.Root("Mix"), cells: {
                    week: {
                        segments: [
                            { category: "big", weight: 7.0, label: { value: "Big slice" } },
                            { category: "med", weight: 2.0, label: { value: "Med" } },
                            { category: "tiny", weight: 1.0, label: { value: "Tiny" } },
                        ],
                    },
                } },
            ],
            [
                { key: "week", header: Text.Root("Week 1") },
            ],
            {
                // Default is `"24px"` — bump to `"48px"` so anything narrower
                // than that drops its label rather than getting clipped.
                minLabelSize: "48px",
                legend: [
                    { category: "big", color: "blue.400" },
                    { category: "med", color: "orange.400" },
                    { category: "tiny", color: "red.400" },
                ],
            },
        );
    }),
    inputs: [],
});
