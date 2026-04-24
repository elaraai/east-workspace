/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { ArrayType, East, NullType, example } from "@elaraai/east";
import { Badge, Matrix, Text, UIComponentType } from "@elaraai/east-ui";

export const matrixBasic = example({
    keywords: ["Matrix", "Root", "heat-grid", "basic", "segments"],
    description: "Basic assignment grid — rows / columns with horizontal segment fills per cell",
    fn: East.function([], UIComponentType, (_$) => {
        return Matrix.Root(
            [
                { key: "alice", header: Text.Root("Alice"), cells: [
                    { columnKey: "mon", segments: [{ category: "booked", value: 0.8, color: "blue.400" }] },
                    { columnKey: "tue", segments: [{ category: "booked", value: 0.4, color: "blue.400" }] },
                    { columnKey: "wed", segments: [{ category: "booked", value: 1.0, color: "blue.400" }] },
                ]},
                { key: "bob", header: Text.Root("Bob"), cells: [
                    { columnKey: "mon", segments: [{ category: "booked", value: 0.5, color: "blue.400" }] },
                    { columnKey: "tue", segments: [{ category: "booked", value: 0.9, color: "blue.400" }] },
                    { columnKey: "wed", segments: [{ category: "booked", value: 0.3, color: "blue.400" }] },
                ]},
            ],
            [
                { key: "mon", header: Text.Root("Mon") },
                { key: "tue", header: Text.Root("Tue") },
                { key: "wed", header: Text.Root("Wed") },
            ],
            {
                legend: [{ category: "booked", color: "blue.400", label: "Booked" }],
                size: "md",
            },
        );
    }),
    inputs: [],
});

export const matrixMultiSegment = example({
    keywords: ["Matrix", "Root", "segments", "stacked", "multi-category"],
    description: "Multi-segment cells — each cell's fill shows proportional category breakdown",
    fn: East.function([], UIComponentType, (_$) => {
        return Matrix.Root(
            [
                { key: "alice", header: Text.Root("Alice"), cells: [
                    { columnKey: "mon", segments: [
                        { category: "booked", value: 0.5, color: "green.400" },
                        { category: "pending", value: 0.3, color: "yellow.400" },
                        { category: "free", value: 0.2, color: "gray.200" },
                    ] },
                    { columnKey: "tue", segments: [
                        { category: "booked", value: 0.7, color: "green.400" },
                        { category: "pending", value: 0.1, color: "yellow.400" },
                        { category: "free", value: 0.2, color: "gray.200" },
                    ] },
                ]},
            ],
            [{ key: "mon", header: Text.Root("Mon") }, { key: "tue", header: Text.Root("Tue") }],
            {
                legend: [
                    { category: "booked", color: "green.400", label: "Booked" },
                    { category: "pending", color: "yellow.400", label: "Pending" },
                    { category: "free", color: "gray.200", label: "Free" },
                ],
            },
        );
    }),
    inputs: [],
});

export const matrixWithOverlays = example({
    keywords: ["Matrix", "Root", "overlays", "badge", "icon", "multi-position"],
    description: "Cells with overlays at different corners — `tl` / `tr` / `bl` / `br` / `center` positions carry UIComponents",
    fn: East.function([], UIComponentType, (_$) => {
        return Matrix.Root(
            [
                { key: "alice", header: Text.Root("Alice"), cells: [
                    {
                        columnKey: "mon",
                        segments: [{ category: "booked", value: 0.8, color: "blue.400" }],
                        overlays: [
                            { kind: "badge", position: "tr", content: Badge.Root("!", { variant: "solid", colorPalette: "red", size: "sm" }) },
                        ],
                    },
                    {
                        columnKey: "tue",
                        segments: [{ category: "booked", value: 0.5, color: "blue.400" }],
                        overlays: [
                            { kind: "text", position: "br", content: Text.Root("4h", { color: "white" }) },
                        ],
                    },
                ]},
            ],
            [{ key: "mon", header: Text.Root("Mon") }, { key: "tue", header: Text.Root("Tue") }],
            { legend: [{ category: "booked", color: "blue.400", label: "Booked" }] },
        );
    }),
    inputs: [],
});

export const matrixEmphasis = example({
    keywords: ["Matrix", "Root", "emphasis", "highlight", "ring"],
    description: "Emphasis — cells can be highlighted with a ring to draw attention",
    fn: East.function([], UIComponentType, (_$) => {
        return Matrix.Root(
            [
                { key: "alice", header: Text.Root("Alice"), cells: [
                    { columnKey: "mon", segments: [{ category: "booked", value: 0.6, color: "blue.400" }] },
                    { columnKey: "tue", segments: [{ category: "booked", value: 0.6, color: "blue.400" }] },
                    { columnKey: "wed", segments: [{ category: "booked", value: 0.6, color: "blue.400" }], emphasis: true, emphasisColor: "red.500" },
                    { columnKey: "thu", segments: [{ category: "booked", value: 0.6, color: "blue.400" }] },
                ]},
            ],
            [
                { key: "mon", header: Text.Root("Mon") },
                { key: "tue", header: Text.Root("Tue") },
                { key: "wed", header: Text.Root("Wed") },
                { key: "thu", header: Text.Root("Thu") },
            ],
            { legend: [{ category: "booked", color: "blue.400", label: "Booked" }] },
        );
    }),
    inputs: [],
});

export const matrixBrushSelection = example({
    keywords: ["Matrix", "Root", "brushSelection", "onChange", "range-select"],
    description: "Brush selection — drag a rectangle over cells; `onChange([{row, column}])` fires on mouse-up",
    fn: East.function([], UIComponentType, (_$) => {
        const onChange = East.function([ArrayType(Matrix.Types.BrushCoord)], NullType, (_$, _cells) => { /* no-op */ });
        return Matrix.Root(
            [
                { key: "alice", header: Text.Root("Alice"), cells: [
                    { columnKey: "mon", segments: [{ category: "booked", value: 0.8, color: "blue.400" }] },
                    { columnKey: "tue", segments: [{ category: "booked", value: 0.5, color: "blue.400" }] },
                ]},
                { key: "bob", header: Text.Root("Bob"), cells: [
                    { columnKey: "mon", segments: [{ category: "booked", value: 0.4, color: "blue.400" }] },
                    { columnKey: "tue", segments: [{ category: "booked", value: 0.9, color: "blue.400" }] },
                ]},
            ],
            [{ key: "mon", header: Text.Root("Mon") }, { key: "tue", header: Text.Root("Tue") }],
            {
                brushSelection: { enabled: true, onChange },
                legend: [{ category: "booked", color: "blue.400", label: "Booked" }],
            },
        );
    }),
    inputs: [],
});
