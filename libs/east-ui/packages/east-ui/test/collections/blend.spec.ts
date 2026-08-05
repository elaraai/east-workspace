/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { BooleanType, East, none, variant, type ExprType } from "@elaraai/east";
import { Blend, DragEventType } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./blend.examples.js";

describeEast("Blend", (test) => {
    Assert.examples(test, {
        blendSingle: ex.blendSingle,
        blendAllocationStates: ex.blendAllocationStates,
        blendCompare: ex.blendCompare,
        blendPortfolio: ex.blendPortfolio,
        blendLibraryDnd: ex.blendLibraryDnd,
    });

    test("blendCompare drives its preview from inline option tables", $ => {
        // The mode-preset axis is declared inside the example body, because
        // the documentation capture only extracts `fn`. That puts it inside
        // the Reactive body, which TestImpl does not execute, so it cannot be
        // asserted from here; `Assert.examples` above still compiles and
        // evaluates the outer function. Per-mode prop coverage lives in the
        // Blend.Root tests below.
        const panel = $.const(ex.blendCompare.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("Blend"), true));
    });

    test("canDrop encodes and vetoes candidate events (#261)", $ => {
        const canDrop = $.const(East.function([DragEventType], BooleanType, ($, event) =>
            event.match({
                add: (_$, add) => add.from.key.startsWith("c2-").and(_$ => East.equal(add.into.row, "premium")).not(),
                move: (_$) => East.value(true),
                remove: (_$) => East.value(true),
                resize: (_$) => East.value(true),
            })));
        const blend = $.let(Blend.Root(
            [{ key: "premium", name: "Premium", cap: 100.0 }],
            {
                id: "bench-veto",
                sources: ["materials"],
                target: t => ({ key: t.key, label: t.name, capacity: t.cap, allocations: [] }),
                canDrop,
            },
        ));
        const root = $.let(blend.unwrap().unwrap("Blend"));

        $(Assert.equal(root.canDrop.hasTag("some"), true));
        const veto = $.let(root.canDrop.unwrap("some"));
        $(Assert.equal(veto(variant("add", {
            from: { library: "materials", key: "c1-204" },
            into: { surface: "bench-veto", row: "premium", slot: "alloc", event: none },
            duplicate: false,
        })), true));
        $(Assert.equal(veto(variant("add", {
            from: { library: "materials", key: "c2-167" },
            into: { surface: "bench-veto", row: "premium", slot: "alloc", event: none },
            duplicate: false,
        })), false));
    });

    test("resolves targets with defaults", $ => {
        const blend = $.let(Blend.Root(
            [{ key: "m1", name: "Mix 1", cap: 100.0 }],
            {
                id: "bench",
                sources: ["materials"],
                target: t => ({
                    key: t.key, label: t.name, capacity: t.cap,
                    allocations: [Blend.allocation({ source: "L1", amount: 40.0 })],
                }),
            },
        ));
        const root = $.let(blend.unwrap().unwrap("Blend"));

        $(Assert.equal(root.id, "bench"));
        $(Assert.equal(root.sources.get(0n), "materials"));
        $(Assert.equal(root.targets.size(), 1n));
        const target = $.let(root.targets.get(0n));
        $(Assert.equal(target.unit, "u"));
        $(Assert.equal(target.objective.hasTag("none"), true));
        $(Assert.equal(target.metrics.size(), 0n));
        const alloc = $.let(target.allocations.get(0n));
        $(Assert.equal(alloc.label, "L1"));
        $(Assert.equal(alloc.pinned, false));
        $(Assert.equal(alloc.state.hasTag("committed"), true));
    });

    test("allocation and metric fields carry through", $ => {
        const blend = $.let(Blend.Root(
            [{ key: "m1", name: "Mix 1", cap: 100.0 }],
            {
                id: "bench",
                diff: ["cost"],
                verdict: "A wins",
                target: t => ({
                    key: t.key, label: t.name, capacity: t.cap, unit: "kL",
                    objective: "min cost",
                    allocations: [
                        Blend.allocation({ source: "L1", label: "Lot 1", sublabel: "north", amount: 40.0, pinned: true, state: variant("proposed", variant("added", null)) }),
                    ],
                    metrics: [
                        Blend.metric({ key: "cost", label: "cost / unit", value: "$3.42", numeric: 3.42, model: "cost-v1.4" }),
                        Blend.metric({ key: "specx", label: "spec X", value: "3.62", band: { min: 3.55, max: 3.68 } }),
                    ],
                }),
            },
        ));
        const root = $.let(blend.unwrap().unwrap("Blend"));
        const target = $.let(root.targets.get(0n));

        $(Assert.equal(root.diff.get(0n), "cost"));
        $(Assert.equal(root.verdict.unwrap("some"), "A wins"));
        $(Assert.equal(target.unit, "kL"));
        $(Assert.equal(target.objective.unwrap("some"), "min cost"));
        const alloc = $.let(target.allocations.get(0n));
        $(Assert.equal(alloc.label, "Lot 1"));
        $(Assert.equal(alloc.sublabel.unwrap("some"), "north"));
        $(Assert.equal(alloc.pinned, true));
        $(Assert.equal(alloc.state.unwrap("proposed").hasTag("added"), true));
        $(Assert.equal(target.metrics.get(0n).numeric.unwrap("some"), 3.42));
        $(Assert.equal(target.metrics.get(0n).model.unwrap("some"), "cost-v1.4"));
        $(Assert.equal(target.metrics.get(1n).band.unwrap("some").max, 3.68));
    });
}, { platformFns: TestImpl });
