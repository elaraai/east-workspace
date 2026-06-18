/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, NullType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Planner } from "@elaraai/east-ui/internal";
import * as ex from "./planner.examples.js";

describeEast("Planner", (test) => {
    Assert.examples(test, {
        plannerPoint: ex.plannerPoint,
        plannerEventStates: ex.plannerEventStates,
        plannerBuckets: ex.plannerBuckets,
        plannerOrdinalAxis: ex.plannerOrdinalAxis,
        plannerColumns: ex.plannerColumns,
        plannerMarkers: ex.plannerMarkers,
        plannerPopover: ex.plannerPopover,
        plannerSpan: ex.plannerSpan,
        plannerDensity: ex.plannerDensity,
        plannerReview: ex.plannerReview,
    });

    // =========================================================================
    // Variant + axis
    // =========================================================================

    test("Point carries the point variant and a numeric axis", $ => {
        const p = $.let(Planner.Point(
            [{ name: "Alice" }],
            {
                axis: Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }] }),
                columns: [{ key: "name", frozen: true, value: r => r.name }],
                events: _r => [Planner.event({ slot: Planner.at.number(1), label: "X", state: "committed" })],
            },
        ));
        const root = $.let(p.unwrap().unwrap("Planner"));
        $(Assert.equal(root.variant.hasTag("point"), true));
        $(Assert.equal(root.axis.scale.hasTag("number"), true));
        $(Assert.equal(root.axis.buckets.length(), 2n));
        $(Assert.equal(root.columns.get(0n).frozen.unwrap("some"), true));
    });

    test("Span carries the span variant and a time axis", $ => {
        const p = $.let(Planner.Span(
            [{ name: "A" }],
            {
                axis: Planner.axis.time(),
                columns: [{ key: "name", value: r => r.name }],
                events: _r => [Planner.event({ slot: Planner.at.time(new Date("2024-01-01")), endSlot: Planner.at.time(new Date("2024-02-01")), label: "S", state: "committed" })],
            },
        ));
        const root = $.let(p.unwrap().unwrap("Planner"));
        $(Assert.equal(root.variant.hasTag("span"), true));
        $(Assert.equal(root.axis.scale.hasTag("time"), true));
        $(Assert.equal(root.rows.get(0n).events.get(0n).endSlot.hasTag("some"), true));
    });

    test("ordinal axis carries its category range", $ => {
        const p = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.ordinal({ range: ["one", "two", "three"] }),
                columns: [{ key: "name", value: r => r.name }],
                events: _r => [Planner.event({ slot: Planner.at.ordinal("two"), label: "X", state: "committed" })],
            },
        ));
        const root = $.let(p.unwrap().unwrap("Planner"));
        $(Assert.equal(root.axis.scale.hasTag("ordinal"), true));
        $(Assert.equal(root.axis.range.unwrap("some").unwrap("ordinal").length(), 3n));
    });

    // =========================================================================
    // Event states
    // =========================================================================

    test("event states resolve to the right arms", $ => {
        const p = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.number(),
                columns: [{ key: "name", value: r => r.name }],
                events: _r => [
                    Planner.event({ slot: Planner.at.number(1), label: "c", state: "committed" }),
                    Planner.event({ slot: Planner.at.number(2), label: "a", state: "added" }),
                    Planner.event({ slot: Planner.at.number(3), label: "m", state: "model" }),
                    Planner.event({ slot: Planner.at.number(4), label: "r", state: "removed" }),
                    Planner.event({ slot: Planner.at.number(5), label: "j", state: "rejected" }),
                ],
            },
        ));
        const evts = $.let(p.unwrap().unwrap("Planner").rows.get(0n).events);
        $(Assert.equal(evts.get(0n).state.hasTag("committed"), true));
        $(Assert.equal(evts.get(1n).state.unwrap("proposed").hasTag("added"), true));
        $(Assert.equal(evts.get(2n).state.unwrap("proposed").hasTag("model"), true));
        $(Assert.equal(evts.get(3n).state.unwrap("proposed").hasTag("removed"), true));
        $(Assert.equal(evts.get(4n).state.hasTag("rejected"), true));
    });

    // =========================================================================
    // Status marker
    // =========================================================================

    test("a marker (parallel to events) carries slot + status + message", $ => {
        const p = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.number(),
                columns: [{ key: "name", value: r => r.name }],
                events: _r => [Planner.event({ slot: Planner.at.number(1), label: "x", state: "added" })],
                markers: _r => [Planner.marker({ slot: Planner.at.number(1), status: "warning", message: "clash" })],
            },
        ));
        const marker = $.let(p.unwrap().unwrap("Planner").rows.get(0n).markers.get(0n));
        $(Assert.equal(marker.slot.unwrap("number"), 1.0));
        $(Assert.equal(marker.status.hasTag("warning"), true));
        $(Assert.equal(marker.message, "clash"));
    });

    // =========================================================================
    // Columns + groupBy + now
    // =========================================================================

    test("columns carry value + eyebrow, groupBy fills the row group, now is set", $ => {
        const p = $.let(Planner.Point(
            [{ name: "Alice", role: "Lead", team: "T" }],
            {
                axis: Planner.axis.number(),
                groupBy: r => r.team,
                now: Planner.at.number(2),
                columns: [{ key: "name", frozen: true, align: "start", value: r => r.name, sublabel: r => r.role }],
                events: _r => [Planner.event({ slot: Planner.at.number(1), label: "x", state: "committed" })],
            },
        ));
        const root = $.let(p.unwrap().unwrap("Planner"));
        const cell = $.let(root.rows.get(0n).cells.get("name"));
        $(Assert.equal(cell.value, "Alice"));
        $(Assert.equal(cell.sublabel.unwrap("some"), "Lead"));
        $(Assert.equal(root.rows.get(0n).group.unwrap("some"), "T"));
        $(Assert.equal(root.now.hasTag("some"), true));
        $(Assert.equal(root.columns.get(0n).align.unwrap("some").hasTag("start"), true));
    });

    test("density resolves from the string shorthand", $ => {
        const p = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.number(),
                density: "compact",
                columns: [{ key: "name", value: r => r.name }],
                events: _r => [Planner.event({ slot: Planner.at.number(1), label: "x", state: "committed" })],
            },
        ));
        const root = $.let(p.unwrap().unwrap("Planner"));
        $(Assert.equal(root.density.unwrap("some").hasTag("compact"), true));
    });

    test("onSelectRow presence is preserved", $ => {
        const p = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.number(),
                columns: [{ key: "name", value: r => r.name }],
                events: _r => [Planner.event({ slot: Planner.at.number(1), label: "x", state: "committed" })],
                onSelectRow: East.function([Planner.Types.SelectEvent], NullType, _$ => null),
            },
        ));
        $(Assert.equal(p.unwrap().unwrap("Planner").onSelectRow.hasTag("some"), true));
    });
}, { platformFns: TestImpl });
