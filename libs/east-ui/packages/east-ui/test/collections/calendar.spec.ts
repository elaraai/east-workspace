/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, type ExprType } from "@elaraai/east";
import { Calendar } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./calendar.examples.js";

describeEast("Calendar", (test) => {
    Assert.examples(test, {
        calendarDemand: ex.calendarDemand,
        calendarInteractive: ex.calendarInteractive,
        calendarVariants: ex.calendarVariants,
        calendarFill: ex.calendarFill,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#461).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("calendarVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.calendarVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "MINIMAL"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "VALUES OFF"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "TOTALS"));
        $(Assert.equal(rows.get(3n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "DENSITY"));
    });

    test("calendarFill panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.calendarFill.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 2n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "SCROLL"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "FILL"));
    });

    test("resolves cells with default formatting, values on, and no chrome", $ => {
        const cal = $.let(Calendar.Root(
            [{ week: "W1", day: "Mon", v: 4.5 }],
            { cell: d => ({ week: d.week, day: d.day, value: d.v }) },
        ));
        const root = $.let(cal.unwrap().unwrap("Calendar"));

        $(Assert.equal(root.values, true));
        $(Assert.equal(root.cells.size(), 1n));
        $(Assert.equal(root.cells.get(0n).week, "W1"));
        $(Assert.equal(root.cells.get(0n).day, "Mon"));
        $(Assert.equal(root.cells.get(0n).value, 4.5));
        $(Assert.equal(root.cells.get(0n).text, "4.5"));
        $(Assert.equal(root.cells.get(0n).compare.hasTag("none"), true));
        $(Assert.equal(root.cells.get(0n).summary.hasTag("none"), true));
        $(Assert.equal(root.domain.hasTag("none"), true));
        $(Assert.equal(root.totals.hasTag("none"), true));
        $(Assert.equal(root.footer.hasTag("none"), true));
    });

    test("text, compare, and domain resolve per cell", $ => {
        const cal = $.let(Calendar.Root(
            [{ week: "W1", day: "Thu", v: 131.0, prev: 112.0 }],
            {
                cell: d => ({
                    week: d.week, day: d.day, value: d.v,
                    text: East.Float.printFixed(d.v, 0n),
                    compare: d.prev,
                }),
                domain: { min: 0.0, max: 250.0 },
                actionLabel: "Open day",
            },
        ));
        const root = $.let(cal.unwrap().unwrap("Calendar"));

        $(Assert.equal(root.cells.get(0n).text, "131"));
        $(Assert.equal(root.cells.get(0n).compare.unwrap("some"), 112.0));
        $(Assert.equal(root.domain.unwrap("some").max, 250.0));
        $(Assert.equal(root.actionLabel.unwrap("some"), "Open day"));
    });

    test("sub-factories resolve the totals rail, aggregate row, footer, and scale", $ => {
        const cal = $.let(Calendar.Root(
            [{ week: "W1", day: "Mon", v: 4.0 }],
            {
                cell: d => ({ week: d.week, day: d.day, value: d.v }),
                scale: Calendar.scale({ steps: 6n }),
                totals: Calendar.totals({ aggregate: "sum", label: "Σ wk", bar: true }),
                aggregateRow: Calendar.aggregateRow({ aggregate: "mean", label: "mean" }),
                footer: Calendar.footer({ valueLabel: "predicted", compareLabel: "last yr", legend: true }),
                values: false,
            },
        ));
        const root = $.let(cal.unwrap().unwrap("Calendar"));

        $(Assert.equal(root.values, false));
        $(Assert.equal(root.scale.unwrap("some").steps, 6n));
        $(Assert.equal(root.totals.unwrap("some").aggregate.hasTag("sum"), true));
        $(Assert.equal(root.totals.unwrap("some").label, "Σ wk"));
        $(Assert.equal(root.totals.unwrap("some").bar, true));
        $(Assert.equal(root.aggregateRow.unwrap("some").aggregate.hasTag("mean"), true));
        $(Assert.equal(root.aggregateRow.unwrap("some").label, "mean"));
        $(Assert.equal(root.footer.unwrap("some").valueLabel, "predicted"));
        $(Assert.equal(root.footer.unwrap("some").compareLabel, "last yr"));
        $(Assert.equal(root.footer.unwrap("some").legend.unwrap("some").low, "low"));
    });
}, { platformFns: TestImpl });
