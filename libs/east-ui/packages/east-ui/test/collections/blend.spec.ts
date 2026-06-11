/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { variant } from "@elaraai/east";
import { Blend } from "@elaraai/east-ui/internal";
import * as ex from "./blend.examples.js";

describeEast("Blend", (test) => {
    Assert.examples(test, {
        blendSingle: ex.blendSingle,
        blendCompare: ex.blendCompare,
        blendPortfolio: ex.blendPortfolio,
        blendInteractive: ex.blendInteractive,
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
