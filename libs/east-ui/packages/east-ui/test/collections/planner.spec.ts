/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, NullType, FloatType, ArrayType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Planner } from "@elaraai/east-ui/internal";
import * as ex from "./planner.examples.js";

describeEast("Planner", (test) => {
    Assert.examples(test, {
        plannerPoint: ex.plannerPoint,
        plannerEventStates: ex.plannerEventStates,
        plannerBuckets: ex.plannerBuckets,
        plannerMixedBuckets: ex.plannerMixedBuckets,
        plannerOrdinalAxis: ex.plannerOrdinalAxis,
        plannerDataDrivenRange: ex.plannerDataDrivenRange,
        plannerColumns: ex.plannerColumns,
        plannerMarkers: ex.plannerMarkers,
        plannerPopover: ex.plannerPopover,
        plannerSpan: ex.plannerSpan,
        plannerDensity: ex.plannerDensity,
        plannerReview: ex.plannerReview,
        plannerStretch: ex.plannerStretch,
        plannerEventTone: ex.plannerEventTone,
        plannerEventColor: ex.plannerEventColor,
        plannerHovercard: ex.plannerHovercard,
        plannerRowHover: ex.plannerRowHover,
        plannerPerCellBuckets: ex.plannerPerCellBuckets,
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
    // Data-driven axis range (issue #115) — range.max accepts an expression
    // =========================================================================

    test("axis range accepts a FloatType expression for the extent", $ => {
        // `max` is a computed FloatType expression, not a literal — the widened
        // option type (SubtypeExprOrValue<FloatType>) must lower it into the range.
        const horizon = $.const(3.0, FloatType);
        const p = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.number({ range: { min: 0, max: horizon.add(4.0) } }),
                columns: [{ key: "name", value: r => r.name }],
                events: _r => [Planner.event({ slot: Planner.at.number(1), label: "x", state: "committed" })],
            },
        ));
        const range = $.let(p.unwrap().unwrap("Planner").axis.range.unwrap("some").unwrap("number"));
        $(Assert.equal(range.min, 0.0));
        $(Assert.equal(range.max, 7.0));
    });

    // =========================================================================
    // Per-row bucketing (issue #113) — bucketed + bucket:none rows coexist
    // =========================================================================

    test("a bucketed axis carries both bucketed and bucket:none rows", $ => {
        // The axis declares am/pm buckets, but only the first row's event sits in
        // one; the second row's event is unbucketed (bucket: none) and must be
        // preserved, not dropped — the per-row renderer decides flat vs sub-grid.
        const bucketed = $.const([Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "x", state: "committed" })], ArrayType(Planner.Types.Event));
        const flat = $.const([Planner.event({ slot: Planner.at.number(1), label: "y", state: "committed" })], ArrayType(Planner.Types.Event));
        const p = $.let(Planner.Point(
            [{ name: "Shift", bucketed: true }, { name: "Daily", bucketed: false }],
            {
                axis: Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }] }),
                columns: [{ key: "name", value: r => r.name }],
                events: r => r.bucketed.ifElse(() => bucketed, () => flat),
            },
        ));
        const rows = $.let(p.unwrap().unwrap("Planner").rows);
        $(Assert.equal(rows.get(0n).events.get(0n).bucket.unwrap("some"), "am"));
        $(Assert.equal(rows.get(1n).events.get(0n).bucket.hasTag("none"), true));
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

    // =========================================================================
    // Per-event geometry / tone / animation / hovercard (issue #120)
    // =========================================================================

    test("stretch + content resolve from the string shorthands", $ => {
        const p = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.number(),
                columns: [{ key: "name", value: r => r.name }],
                events: _r => [Planner.event({
                    slot: Planner.at.number(1), label: "x", state: "committed",
                    stretch: "both", content: { horizontal: "center", vertical: "end" },
                })],
            },
        ));
        const ev = $.let(p.unwrap().unwrap("Planner").rows.get(0n).events.get(0n));
        $(Assert.equal(ev.stretch.unwrap("some").hasTag("both"), true));
        $(Assert.equal(ev.content.unwrap("some").horizontal.unwrap("some").hasTag("center"), true));
        $(Assert.equal(ev.content.unwrap("some").vertical.unwrap("some").hasTag("end"), true));
    });

    test("tone + animation resolve from the string shorthands", $ => {
        const p = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.number(),
                columns: [{ key: "name", value: r => r.name }],
                events: _r => [Planner.event({
                    slot: Planner.at.number(1), label: "x", state: "committed",
                    tone: "danger", animation: "pulse",
                })],
            },
        ));
        const ev = $.let(p.unwrap().unwrap("Planner").rows.get(0n).events.get(0n));
        $(Assert.equal(ev.tone.unwrap("some").hasTag("danger"), true));
        $(Assert.equal(ev.animation.unwrap("some").hasTag("pulse"), true));
    });

    test("absent geometry / tone / animation default to none", $ => {
        const p = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.number(),
                columns: [{ key: "name", value: r => r.name }],
                events: _r => [Planner.event({ slot: Planner.at.number(1), label: "x", state: "committed" })],
            },
        ));
        const ev = $.let(p.unwrap().unwrap("Planner").rows.get(0n).events.get(0n));
        $(Assert.equal(ev.stretch.hasTag("none"), true));
        $(Assert.equal(ev.content.hasTag("none"), true));
        $(Assert.equal(ev.tone.hasTag("none"), true));
        $(Assert.equal(ev.animation.hasTag("none"), true));
        $(Assert.equal(ev.hovercard.hasTag("none"), true));
    });

    test("rowHover presence is preserved on the root", $ => {
        const on = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.number(),
                rowHover: true,
                columns: [{ key: "name", value: r => r.name }],
                events: _r => [Planner.event({ slot: Planner.at.number(1), label: "x", state: "committed" })],
            },
        ));
        const off = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.number(),
                columns: [{ key: "name", value: r => r.name }],
                events: _r => [Planner.event({ slot: Planner.at.number(1), label: "x", state: "committed" })],
            },
        ));
        $(Assert.equal(on.unwrap().unwrap("Planner").rowHover.unwrap("some"), true));
        $(Assert.equal(off.unwrap().unwrap("Planner").rowHover.hasTag("none"), true));
    });
}, { platformFns: TestImpl });
