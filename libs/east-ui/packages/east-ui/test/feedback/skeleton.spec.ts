/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Skeleton } from "@elaraai/east-ui";
import * as ex from "./skeleton.examples.js";

describeEast("Skeleton", (test) => {
    Assert.examples(test, {
        skeletonTextBlock: ex.skeletonTextBlock,
        skeletonCard: ex.skeletonCard,
        skeletonRow: ex.skeletonRow,
    });

    test("creates text-shape skeleton", $ => {
        const s = $.let(Skeleton.Root({ shape: "text" }));
        const v = s.unwrap().unwrap("Skeleton");
        $(Assert.equal(v.shape.hasTag("text"), true));
        $(Assert.equal(v.lines.hasTag("none"), true));
        $(Assert.equal(v.count.hasTag("none"), true));
        $(Assert.equal(v.style.hasTag("none"), true));
    });

    test("creates rect-shape skeleton", $ => {
        const s = $.let(Skeleton.Root({ shape: "rect" }));
        $(Assert.equal(s.unwrap().unwrap("Skeleton").shape.hasTag("rect"), true));
    });

    test("creates circle-shape skeleton", $ => {
        const s = $.let(Skeleton.Root({ shape: "circle" }));
        $(Assert.equal(s.unwrap().unwrap("Skeleton").shape.hasTag("circle"), true));
    });

    test("text skeleton with lines + fontSize", $ => {
        const s = $.let(Skeleton.Root({ shape: "text", lines: 5n, fontSize: "md" }));
        const v = s.unwrap().unwrap("Skeleton");
        $(Assert.equal(v.lines.unwrap("some"), 5n));
        $(Assert.equal(v.style.unwrap("some").fontSize.unwrap("some"), "md"));
    });

    test("skeleton with count repeats", $ => {
        const s = $.let(Skeleton.Root({ shape: "rect", count: 4n }));
        $(Assert.equal(s.unwrap().unwrap("Skeleton").count.unwrap("some"), 4n));
    });

    test("skeleton with style dimensions + colour slots", $ => {
        const s = $.let(Skeleton.Root({ shape: "rect",
            width: "100%",
            height: "80px",
            background: "#e5e7eb",
            shimmerColor: "#f3f4f6",
        }));
        const sv = s.unwrap().unwrap("Skeleton").style.unwrap("some");
        $(Assert.equal(sv.width.unwrap("some"), "100%"));
        $(Assert.equal(sv.height.unwrap("some"), "80px"));
        $(Assert.equal(sv.background.unwrap("some"), "#e5e7eb"));
        $(Assert.equal(sv.shimmerColor.unwrap("some"), "#f3f4f6"));
    });
}, { platformFns: TestImpl });
