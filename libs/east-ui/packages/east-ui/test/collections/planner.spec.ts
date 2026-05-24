/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, FloatType, StringType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Planner, Text, Badge, Table, UIComponentType } from "@elaraai/east-ui";
import * as ex from "./planner.examples.js";

describeEast("Planner", (test) => {
    Assert.examples(test, {
        plannerBasic: ex.plannerBasic,
        plannerWithLabels: ex.plannerWithLabels,
        plannerMultipleEvents: ex.plannerMultipleEvents,
        plannerSingleSlotMode: ex.plannerSingleSlotMode,
        plannerFractionalSteps: ex.plannerFractionalSteps,
        plannerCustomSlotLabels: ex.plannerCustomSlotLabels,
        plannerStyled: ex.plannerStyled,
        plannerComplexColumns: ex.plannerComplexColumns,
        plannerColumnRenderWithRow: ex.plannerColumnRenderWithRow,
        plannerWithBoundaries: ex.plannerWithBoundaries,
        plannerPopoverClick: ex.plannerPopoverClick,
        plannerEventTooltip: ex.plannerEventTooltip,
        plannerPopoverAndContextMenu: ex.plannerPopoverAndContextMenu,
        plannerReadOnlyMode: ex.plannerReadOnlyMode,
        plannerEventStyling: ex.plannerEventStyling,
        plannerOverlappingEvents: ex.plannerOverlappingEvents,
        plannerWithIcons: ex.plannerWithIcons,
        plannerLabelAlignment: ex.plannerLabelAlignment,
        plannerCustomHeight: ex.plannerCustomHeight,
        plannerFrozenColumns: ex.plannerFrozenColumns,
        plannerRowStatus: ex.plannerRowStatus,
        plannerChromeColours: ex.plannerChromeColours,
        plannerEventOverlays: ex.plannerEventOverlays,
        plannerVisualTokens: ex.plannerVisualTokens,
        plannerInteractive: ex.plannerInteractive,
        plannerReactiveClick: ex.plannerReactiveClick,
        plannerEventPopoverWithCallback: ex.plannerEventPopoverWithCallback,
    });

    // =========================================================================
    // Planner Root Creation
    // =========================================================================

    test("creates basic planner", $ => {
        const planner = $.let(Planner.Root(
            [
                { name: "Alice", start: 1.0, end: 3.0 },
                { name: "Bob", start: 2.0, end: 5.0 },
            ],
            ["name"],
            row => [Planner.Event({ start: row.start, end: row.end })],
        ));

        $(Assert.equal(planner.unwrap().hasTag("Planner"), true));
    });

    test("creates planner with style", $ => {
        const planner = $.let(Planner.Root(
            [
                { name: "Task 1", slot: 1.0 },
            ],
            ["name"],
            row => [Planner.Event({ start: row.slot })],
            {
                slotMode: "single",
            }
        ));

        $(Assert.equal(planner.unwrap().hasTag("Planner"), true));
        $(Assert.equal(planner.unwrap().unwrap("Planner").slotMode.hasTag("some"), true));
        $(Assert.equal(planner.unwrap().unwrap("Planner").slotMode.unwrap("some").hasTag("single"), true));
    });

    test("creates planner with span mode", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0, end: 5.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start, end: row.end })],
            {
                slotMode: "span",
            }
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").slotMode.unwrap("some").hasTag("span"), true));
    });

    test("creates planner with minSlot and maxSlot", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 3.0, end: 5.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start, end: row.end })],
            {
                minSlot: 1.0,
                maxSlot: 10.0,
            }
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").minSlot.unwrap("some"), 1.0));
        $(Assert.equal(planner.unwrap().unwrap("Planner").maxSlot.unwrap("some"), 10.0));
    });

    test("creates planner with slotMinWidth", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
            {
                slotMinWidth: "80px",
            }
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").style.unwrap("some").slotMinWidth.unwrap("some"), "80px"));
    });

    test("creates planner with slotLabel function", $ => {
        const labelFn = East.function([FloatType], StringType, ($, slot) => {
            return East.str`Day ${slot}`;
        });

        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
            {
                slotLabel: labelFn,
            }
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").slotLabel.hasTag("some"), true));
    });

    // =========================================================================
    // Slot Line Styling
    // =========================================================================

    test("creates planner with slot line stroke", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
            {
                slotLineStroke: "gray.200",
            }
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").style.unwrap("some").slotLineStroke.unwrap("some"), "gray.200"));
    });

    test("creates planner with slot line width", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
            {
                slotLineWidth: 2.0,
            }
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").style.unwrap("some").slotLineWidth.unwrap("some"), 2.0));
    });

    test("creates planner with slot line dash", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
            {
                slotLineDash: "4 2",
            }
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").style.unwrap("some").slotLineDash.unwrap("some"), "4 2"));
    });

    test("creates planner with slot line opacity", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
            {
                slotLineOpacity: 0.5,
            }
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").style.unwrap("some").slotLineOpacity.unwrap("some"), 0.5));
    });

    // =========================================================================
    // Table Styling
    // =========================================================================

    test("creates planner with table variant", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
            {
                variant: "outline",
            }
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").style.unwrap("some").variant.unwrap("some").hasTag("outline"), true));
    });

    test("creates planner with size", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
            {
                size: "sm",
            }
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates planner with striped", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
            {
                striped: true,
            }
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").style.unwrap("some").striped.unwrap("some"), true));
    });

    test("interactive flag is dropped — row hover is always on", $ => {
        // The Planner no longer carries an `interactive` boolean. Row-hover
        // highlight is always rendered. This test asserts the field is absent
        // from the IR by exercising a Planner without ever passing one.
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
        ));

        $(Assert.equal(planner.unwrap().hasTag("Planner"), true));
    });

    test("creates planner with stickyHeader", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
            {
                stickyHeader: true,
            }
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").style.unwrap("some").stickyHeader.unwrap("some"), true));
    });

    // =========================================================================
    // Multiple Events Per Row
    // =========================================================================

    test("creates planner with multiple events per row", $ => {
        const planner = $.let(Planner.Root(
            [
                { name: "Alice", slot1: 1.0, slot2: 3.0, slot3: 5.0 },
            ],
            ["name"],
            row => [
                Planner.Event({ start: row.slot1, label: { value: "Event 1" } }),
                Planner.Event({ start: row.slot2, label: { value: "Event 2" } }),
                Planner.Event({ start: row.slot3, label: { value: "Event 3" } }),
            ],
        ));

        $(Assert.equal(planner.unwrap().hasTag("Planner"), true));
    });

    // =========================================================================
    // Column Configuration
    // =========================================================================

    test("creates planner with multiple columns", $ => {
        const planner = $.let(Planner.Root(
            [
                { name: "Task A", category: "Development", start: 1.0, end: 3.0 },
                { name: "Task B", category: "Design", start: 2.0, end: 4.0 },
            ],
            ["name", "category"],
            row => [Planner.Event({ start: row.start, end: row.end })],
        ));

        $(Assert.equal(planner.unwrap().hasTag("Planner"), true));
    });

    test("creates planner with column config object", $ => {
        const planner = $.let(Planner.Root(
            [
                { name: "Task A", priority: 1.0 },
            ],
            {
                name: { header: "Task Name" },
                priority: { header: "Priority" },
            },
            row => [Planner.Event({ start: row.priority })],
        ));

        $(Assert.equal(planner.unwrap().hasTag("Planner"), true));
    });

    // =========================================================================
    // Color Palette
    // =========================================================================

    test("creates planner with default colorPalette", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
            {
                colorPalette: "purple",
            }
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").style.unwrap("some").colorPalette.unwrap("some").hasTag("purple"), true));
    });

    // =========================================================================
    // Column Render with Row Field Access
    // =========================================================================

    test("column render function receives row parameter to access other fields", $ => {
        const data = $.let(East.value([
            { name: "Alice", role: "Developer", start: 1.0, end: 3.0 },
            { name: "Bob", role: "Designer", start: 2.0, end: 5.0 },
        ]));
        const planner = $.let(Planner.Root(
            data,
            {
                name: {
                    header: "Name",
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Text.Root(East.str`${row.name} (${row.role})`);
                    }),
                },
            },
            row => [Planner.Event({ start: row.start, end: row.end })],
        ));

        $(Assert.equal(planner.unwrap().hasTag("Planner"), true));
        $(Assert.equal(planner.unwrap().unwrap("Planner").rows.size(), 2n));
        $(Assert.equal(planner.unwrap().unwrap("Planner").columns.size(), 1n));
    });

    test("column render function uses row field for conditional styling", $ => {
        const planner = $.let(Planner.Root(
            [
                { task: "Bug Fix", priority: "high", start: 1.0, end: 3.0 },
                { task: "Feature", priority: "low", start: 2.0, end: 4.0 },
            ],
            {
                task: { header: "Task" },
                priority: {
                    header: "Priority",
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) =>
                        Badge.Root(ctx.cellValue.match({ String: (_$, v) => v }, _$ => ""))
                    ),
                },
            },
            row => [Planner.Event({ start: row.start, end: row.end })],
        ));

        $(Assert.equal(planner.unwrap().hasTag("Planner"), true));
        $(Assert.equal(planner.unwrap().unwrap("Planner").rows.size(), 2n));
        $(Assert.equal(planner.unwrap().unwrap("Planner").columns.size(), 2n));
    });

    test("column render function accesses multiple row fields", $ => {
        const data = $.let(East.value([
            { firstName: "Alice", lastName: "Smith", department: "Eng", start: 1.0, end: 5.0 },
        ]));
        const planner = $.let(Planner.Root(
            data,
            {
                firstName: {
                    header: "Full Name",
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Text.Root(East.str`${row.firstName} ${row.lastName}`);
                    }),
                },
                department: { header: "Department" },
            },
            row => [Planner.Event({ start: row.start, end: row.end })],
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").rows.size(), 1n));
        $(Assert.equal(planner.unwrap().unwrap("Planner").columns.size(), 2n));
    });

    // =========================================================================
    // Complex Type Columns (require value function)
    // =========================================================================

    test("creates planner with array field using value function", $ => {
        const data = $.let(East.value([
            { name: "Alice", skills: ["TypeScript", "React"], start: 1.0, end: 3.0 },
            { name: "Bob", skills: ["Python", "Django", "FastAPI"], start: 2.0, end: 5.0 },
        ]));
        const planner = $.let(Planner.Root(
            data,
            {
                name: { header: "Name" },
                skills: {
                    header: "Skills",
                    value: (skills) => skills.size(),
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Text.Root(East.str`${row.skills.size()} skills`);
                    }),
                },
            },
            row => [Planner.Event({ start: row.start, end: row.end })],
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").columns.size(), 2n));
        $(Assert.equal(planner.unwrap().unwrap("Planner").rows.size(), 2n));
    });

    test("creates planner with struct field using value function", $ => {
        const data = $.let(East.value([
            { name: "Task A", info: { priority: 1n, category: "urgent" }, start: 1.0, end: 3.0 },
            { name: "Task B", info: { priority: 3n, category: "normal" }, start: 2.0, end: 4.0 },
        ]));
        const planner = $.let(Planner.Root(
            data,
            {
                name: { header: "Task" },
                info: {
                    header: "Priority",
                    value: (info) => info.priority,
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Text.Root(East.str`P${row.info.priority}`);
                    }),
                },
            },
            row => [Planner.Event({ start: row.start, end: row.end })],
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").columns.size(), 2n));
        $(Assert.equal(planner.unwrap().unwrap("Planner").rows.size(), 2n));
    });

    test("creates planner mixing primitive and complex columns", $ => {
        const data = $.let(East.value([
            { id: 1n, name: "Alice", contact: { email: "alice@example.com", phone: "555-1234" }, start: 1.0, end: 3.0 },
            { id: 2n, name: "Bob", contact: { email: "bob@example.com", phone: "555-5678" }, start: 2.0, end: 5.0 },
        ]));
        const planner = $.let(Planner.Root(
            data,
            {
                id: { header: "ID" },
                name: { header: "Name" },
                contact: {
                    header: "Email",
                    value: (contact) => contact.email,
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Text.Root(row.contact.email);
                    }),
                },
            },
            row => [Planner.Event({ start: row.start, end: row.end })],
        ));

        $(Assert.equal(planner.unwrap().unwrap("Planner").columns.size(), 3n));
        $(Assert.equal(planner.unwrap().unwrap("Planner").rows.size(), 2n));
    });

    // =========================================================================
    // Per-event tooltip / popover / overlays — Plan 1.10 H IR coverage
    // =========================================================================

    test("event with tooltip slot round-trips as some(UIComp)", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0, end: 3.0 }],
            ["name"],
            row => [Planner.Event({
                start: row.start,
                end: row.end,
                tooltip: Text.Root("hello"),
            })],
        ));
        const event = $.let(planner.unwrap().unwrap("Planner").rows.get(0n).events.get(0n));
        $(Assert.equal(event.tooltip.hasTag("some"), true));
        $(Assert.equal(event.tooltip.unwrap("some").unwrap().hasTag("Text"), true));
    });

    test("event without tooltip is none", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0, end: 3.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start, end: row.end })],
        ));
        const event = $.let(planner.unwrap().unwrap("Planner").rows.get(0n).events.get(0n));
        $(Assert.equal(event.tooltip.hasTag("none"), true));
        $(Assert.equal(event.popover.hasTag("none"), true));
    });

    test("event with popover slot round-trips as some(UIComp)", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0, end: 3.0 }],
            ["name"],
            row => [Planner.Event({
                start: row.start,
                end: row.end,
                popover: Text.Root("popover content"),
            })],
        ));
        const event = $.let(planner.unwrap().unwrap("Planner").rows.get(0n).events.get(0n));
        $(Assert.equal(event.popover.hasTag("some"), true));
        $(Assert.equal(event.popover.unwrap("some").unwrap().hasTag("Text"), true));
    });

    test("event with overlays round-trips with axis-aligned positioning", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0, end: 3.0 }],
            ["name"],
            row => [Planner.Event({
                start: row.start,
                end: row.end,
                overlays: [
                    {
                        content: Badge.Root("HIGH"),
                        align: "end",
                        verticalAlign: "start",
                    },
                    {
                        content: Text.Root("note"),
                        align: "start",
                        verticalAlign: "end",
                    },
                ],
            })],
        ));
        const event = $.let(planner.unwrap().unwrap("Planner").rows.get(0n).events.get(0n));
        $(Assert.equal(event.overlays.size(), 2n));
        const o0 = $.let(event.overlays.get(0n));
        $(Assert.equal(o0.align.hasTag("end"), true));
        $(Assert.equal(o0.verticalAlign.hasTag("start"), true));
        $(Assert.equal(o0.content.unwrap().hasTag("Badge"), true));
        const o1 = $.let(event.overlays.get(1n));
        $(Assert.equal(o1.align.hasTag("start"), true));
        $(Assert.equal(o1.verticalAlign.hasTag("end"), true));
        $(Assert.equal(o1.content.unwrap().hasTag("Text"), true));
    });

    test("creates planner with eventBorderRadius", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
            { eventBorderRadius: "8px" },
        ));
        $(Assert.equal(
            planner.unwrap().unwrap("Planner").style.unwrap("some").eventBorderRadius.unwrap("some"),
            "8px",
        ));
    });

    test("creates planner with labelColor", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
            { labelColor: "white" },
        ));
        $(Assert.equal(
            planner.unwrap().unwrap("Planner").style.unwrap("some").labelColor.unwrap("some"),
            "white",
        ));
    });

    test("creates planner with labelFontSize", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
            { labelFontSize: "0.875rem" },
        ));
        $(Assert.equal(
            planner.unwrap().unwrap("Planner").style.unwrap("some").labelFontSize.unwrap("some"),
            "0.875rem",
        ));
    });

    test("creates planner with labelFontWeight", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0 }],
            ["name"],
            row => [Planner.Event({ start: row.start })],
            { labelFontWeight: "700" },
        ));
        $(Assert.equal(
            planner.unwrap().unwrap("Planner").style.unwrap("some").labelFontWeight.unwrap("some"),
            "700",
        ));
    });

    test("rich label with align/verticalAlign/color/fontWeight/fontStyle/fontSize round-trips", $ => {
        const planner = $.let(Planner.Root(
            [{ name: "Task", start: 1.0, end: 3.0 }],
            ["name"],
            row => [Planner.Event({
                start: row.start,
                end: row.end,
                label: {
                    value: "Rich",
                    align: "center",
                    verticalAlign: "end",
                    color: "yellow.300",
                    fontWeight: "bold",
                    fontStyle: "italic",
                    fontSize: "lg",
                },
            })],
        ));
        const event = $.let(planner.unwrap().unwrap("Planner").rows.get(0n).events.get(0n));
        const label = $.let(event.label.unwrap("some"));
        $(Assert.equal(label.value, "Rich"));
        $(Assert.equal(label.align.unwrap("some").hasTag("center"), true));
        $(Assert.equal(label.verticalAlign.unwrap("some").hasTag("end"), true));
        $(Assert.equal(label.color.unwrap("some"), "yellow.300"));
        $(Assert.equal(label.fontWeight.unwrap("some").hasTag("bold"), true));
        $(Assert.equal(label.fontStyle.unwrap("some").hasTag("italic"), true));
        $(Assert.equal(label.fontSize.unwrap("some").hasTag("lg"), true));
    });
}, {   platformFns: TestImpl,});
