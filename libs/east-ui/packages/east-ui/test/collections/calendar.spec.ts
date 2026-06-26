/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East } from "@elaraai/east";
import { Calendar } from "@elaraai/east-ui/internal";
import * as ex from "./calendar.examples.js";

describeEast("Calendar", (test) => {
    Assert.examples(test, {
        calendarDemand: ex.calendarDemand,
        calendarMinimal: ex.calendarMinimal,
        calendarDensity: ex.calendarDensity,
        calendarInteractive: ex.calendarInteractive,
    });

    test("resolves cells with default formatting and legend", $ => {
        const cal = $.let(Calendar.Root(
            [{ week: "W1", day: "Mon", v: 4.5 }],
            { cell: d => ({ week: d.week, day: d.day, value: d.v }) },
        ));
        const root = $.let(cal.unwrap().unwrap("Calendar"));

        $(Assert.equal(root.legend, "low → high"));
        $(Assert.equal(root.cells.size(), 1n));
        $(Assert.equal(root.cells.get(0n).week, "W1"));
        $(Assert.equal(root.cells.get(0n).day, "Mon"));
        $(Assert.equal(root.cells.get(0n).value, 4.5));
        $(Assert.equal(root.cells.get(0n).text, "4.5"));
        $(Assert.equal(root.cells.get(0n).summary.hasTag("none"), true));
        $(Assert.equal(root.domain.hasTag("none"), true));
    });

    test("format, summary, delta, and domain resolve per cell", $ => {
        const cal = $.let(Calendar.Root(
            [{ week: "W1", day: "Thu", v: 131.0, prev: 112.0 }],
            {
                cell: d => ({
                    week: d.week, day: d.day, value: d.v,
                    text: East.Float.printFixed(d.v, 0n),
                    summary: East.str`predicted ${East.Float.printFixed(d.v, 0n)}`,
                    delta: d.v.subtract(d.prev),
                }),
                domain: { min: 0.0, max: 250.0 },
                actionLabel: "Open day",
            },
        ));
        const root = $.let(cal.unwrap().unwrap("Calendar"));

        $(Assert.equal(root.cells.get(0n).text, "131"));
        $(Assert.equal(root.cells.get(0n).summary.unwrap("some"), "predicted 131"));
        $(Assert.equal(root.cells.get(0n).delta.unwrap("some"), 19.0));
        $(Assert.equal(root.domain.unwrap("some").max, 250.0));
        $(Assert.equal(root.actionLabel.unwrap("some"), "Open day"));
    });
}, { platformFns: TestImpl });
