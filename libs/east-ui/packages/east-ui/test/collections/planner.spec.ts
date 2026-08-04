/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { BooleanType, East, NullType, FloatType, ArrayType, none, some, variant, type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { DragEventType, Planner } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./planner.examples.js";

describeEast("Planner", (test) => {
    Assert.examples(test, {
        plannerPoint: ex.plannerPoint,
        plannerVariants: ex.plannerVariants,
        plannerReview: ex.plannerReview,
        plannerLibraryDnd: ex.plannerLibraryDnd,
    });

    test("plannerVariants is the live configurator", $ => {
        // The preset / columns / density tables live inside the Reactive body,
        // which TestImpl does not execute, so they cannot be asserted from
        // here; `Assert.examples` above still compiles and evaluates the outer
        // function. Axis / slot / event shape coverage lives in the
        // Planner.Point tests below, which construct each configuration
        // directly.
        const panel = $.const(ex.plannerVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
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

    test("maxHeight round-trips", $ => {
        const p = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.number(),
                columns: [{ key: "name", frozen: true, value: r => r.name }],
                events: _r => [Planner.event({ slot: Planner.at.number(1), label: "X", state: "committed" })],
                maxHeight: "320px",
            },
        ));
        $(Assert.equal(p.unwrap().unwrap("Planner").maxHeight.unwrap("some"), "320px"));
    });

    test("maxHeight absent when not provided", $ => {
        const p = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.number(),
                columns: [{ key: "name", frozen: true, value: r => r.name }],
                events: _r => [Planner.event({ slot: Planner.at.number(1), label: "X", state: "committed" })],
            },
        ));
        $(Assert.equal(p.unwrap().unwrap("Planner").maxHeight.hasTag("none"), true));
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
    // Time-axis resolution (issue #309)
    // =========================================================================

    test("time axis carries resolution from the string shorthand", $ => {
        const p = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.time({
                    resolution: "day",
                    format: "ddd DD",
                    range: { min: new Date("2026-03-30"), max: new Date("2026-04-06") },
                }),
                columns: [{ key: "name", value: r => r.name }],
                events: _r => [Planner.event({ slot: Planner.at.time(new Date("2026-04-01T10:00:00Z")), label: "x", state: "committed" })],
            },
        ));
        const axis = $.let(p.unwrap().unwrap("Planner").axis);
        $(Assert.equal(axis.resolution.unwrap("some").hasTag("day"), true));
        $(Assert.equal(axis.format.unwrap("some"), "ddd DD"));
    });

    test("time axis resolution accepts an East expression; absent ⇒ none", $ => {
        const hourly = $.const(variant("hour", null), Planner.Types.Resolution);
        const p = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.time({ resolution: hourly }),
                columns: [{ key: "name", value: r => r.name }],
                events: _r => [Planner.event({ slot: Planner.at.time(new Date("2026-04-01T10:00:00Z")), label: "x", state: "committed" })],
            },
        ));
        $(Assert.equal(p.unwrap().unwrap("Planner").axis.resolution.unwrap("some").hasTag("hour"), true));

        const q = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.time(),
                columns: [{ key: "name", value: r => r.name }],
                events: _r => [Planner.event({ slot: Planner.at.time(new Date("2026-04-01T10:00:00Z")), label: "x", state: "committed" })],
            },
        ));
        $(Assert.equal(q.unwrap().unwrap("Planner").axis.resolution.hasTag("none"), true));
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

    test("DnD target trio encodes; composite slot keys round-trip through canDrop (#269)", $ => {
        const onDrag = $.const(East.function([DragEventType], NullType, _$ => null));
        const canDrop = $.const(East.function([DragEventType], BooleanType, ($, event) =>
            event.match({
                // The composite encoding: "wed" bare, "wed:am" with the bucket.
                add: (_$, add) => add.into.slot.notEqual("wed:am"),
                move: (_$, mv) => mv.to.slot.notEqual("wed"),
                remove: (_$) => East.value(true),
                resize: (_$) => East.value(true),
            })));
        const planner = $.let(Planner.Point(
            [{ name: "Press A" }],
            {
                id: "week-plan",
                sources: ["people"],
                axis: Planner.axis.ordinal({ range: ["mon", "wed", "fri"], buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }] }),
                columns: [{ key: "name", frozen: true, value: r => r.name }],
                events: _r => [],
                onDrag,
                canDrop,
            },
        ));
        const root = $.let(planner.unwrap().unwrap("Planner"));

        $(Assert.equal(root.id, "week-plan"));
        $(Assert.equal(root.sources.get(0n), "people"));
        $(Assert.equal(root.onDrag.hasTag("some"), true));
        const veto = $.let(root.canDrop.unwrap("some"));
        $(Assert.equal(veto(variant("add", {
            from: { library: "people", key: "kim" },
            into: { surface: "week-plan", row: "0", slot: "wed:am", event: none },
            duplicate: false,
        })), false));
        $(Assert.equal(veto(variant("add", {
            from: { library: "people", key: "kim" },
            into: { surface: "week-plan", row: "0", slot: "wed:pm", event: none },
            duplicate: false,
        })), true));
        $(Assert.equal(veto(variant("move", {
            from: { surface: "week-plan", row: "0", slot: "mon:am", event: some("p0") },
            to: { surface: "week-plan", row: "0", slot: "wed", event: none },
        })), false));
    });

    test("a Planner without onDrag carries the inert target defaults (#269)", $ => {
        const planner = $.let(Planner.Point(
            [{ name: "A" }],
            {
                axis: Planner.axis.number({ range: { min: 1, max: 3 } }),
                columns: [{ key: "name", frozen: true, value: r => r.name }],
                events: _r => [],
            },
        ));
        const root = $.let(planner.unwrap().unwrap("Planner"));

        $(Assert.equal(root.id, ""));
        $(Assert.equal(root.sources.size(), 0n));
        $(Assert.equal(root.onDrag.hasTag("none"), true));
        $(Assert.equal(root.canDrop.hasTag("none"), true));
    });
}, { platformFns: TestImpl });
