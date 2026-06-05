/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Sparkline } from "@elaraai/east-ui";
import * as ex from "./sparkline.examples.js";

describeEast("Sparkline", (test) => {
    Assert.examples(test, {
        sparklineLine: ex.sparklineLine,
        sparklineArea: ex.sparklineArea,
        sparklineColors: ex.sparklineColors,
        sparklineSizes: ex.sparklineSizes,
        sparklineStock: ex.sparklineStock,
        sparklineMetric: ex.sparklineMetric,
        sparklineTableCell: ex.sparklineTableCell,
        sparklineDowntrend: ex.sparklineDowntrend,
    });

    // =========================================================================
    // Basic Creation
    // =========================================================================

    test("creates sparkline with data array", $ => {
        const sparkline = $.let(Sparkline.Root([1.0, 2.0, 1.5, 3.0, 2.5]));
        const v = sparkline.unwrap().unwrap("Sparkline");
        $(Assert.equal(v.type.hasTag("none"), true));
        $(Assert.equal(v.style.hasTag("none"), true));
    });

    test("creates sparkline with single value", $ => {
        const sparkline = $.let(Sparkline.Root([42.0]));

        $(Assert.equal(sparkline.unwrap().unwrap("Sparkline").type.hasTag("none"), true));
    });

    test("creates sparkline with many values", $ => {
        const sparkline = $.let(Sparkline.Root([
            10.0, 20.0, 15.0, 25.0, 18.0, 30.0, 22.0, 28.0, 35.0, 40.0
        ]));

        $(Assert.equal(sparkline.unwrap().unwrap("Sparkline").type.hasTag("none"), true));
    });

    // =========================================================================
    // Chart Type
    // =========================================================================

    test("creates line sparkline", $ => {
        const sparkline = $.let(Sparkline.Root([1.0, 2.0, 3.0], {
            type: "line",
        }));

        $(Assert.equal(sparkline.unwrap().unwrap("Sparkline").type.hasTag("some"), true));
        $(Assert.equal(sparkline.unwrap().unwrap("Sparkline").type.unwrap("some").hasTag("line"), true));
    });

    test("creates area sparkline", $ => {
        const sparkline = $.let(Sparkline.Root([1.0, 2.0, 3.0], {
            type: "area",
        }));

        $(Assert.equal(sparkline.unwrap().unwrap("Sparkline").type.hasTag("some"), true));
        $(Assert.equal(sparkline.unwrap().unwrap("Sparkline").type.unwrap("some").hasTag("area"), true));
    });

    // =========================================================================
    // Color
    // =========================================================================

    test("creates sparkline with color", $ => {
        const sparkline = $.let(Sparkline.Root([1.0, 2.0, 3.0], {
            color: "blue.500",
        }));
        const sv = sparkline.unwrap().unwrap("Sparkline").style.unwrap("some");
        $(Assert.equal(sv.color.unwrap("some"), "blue.500"));
    });

    test("creates sparkline with CSS color", $ => {
        const sparkline = $.let(Sparkline.Root([1.0, 2.0, 3.0], {
            color: "#3182ce",
        }));
        const sv = sparkline.unwrap().unwrap("Sparkline").style.unwrap("some");
        $(Assert.equal(sv.color.unwrap("some"), "#3182ce"));
    });

    test("creates sparkline with teal color", $ => {
        const sparkline = $.let(Sparkline.Root([1.0, 2.0, 3.0], {
            color: "teal.500",
        }));
        const sv = sparkline.unwrap().unwrap("Sparkline").style.unwrap("some");
        $(Assert.equal(sv.color.unwrap("some"), "teal.500"));
    });

    // =========================================================================
    // Dimensions
    // =========================================================================

    test("creates sparkline with height", $ => {
        const sparkline = $.let(Sparkline.Root([1.0, 2.0, 3.0], {
            height: "40px",
        }));
        const sv = sparkline.unwrap().unwrap("Sparkline").style.unwrap("some");
        $(Assert.equal(sv.height.unwrap("some"), "40px"));
    });

    test("creates sparkline with width", $ => {
        const sparkline = $.let(Sparkline.Root([1.0, 2.0, 3.0], {
            width: "120px",
        }));
        const sv = sparkline.unwrap().unwrap("Sparkline").style.unwrap("some");
        $(Assert.equal(sv.width.unwrap("some"), "120px"));
    });

    test("creates sparkline with both dimensions", $ => {
        const sparkline = $.let(Sparkline.Root([1.0, 2.0, 3.0], {
            height: "50px",
            width: "200px",
        }));
        const sv = sparkline.unwrap().unwrap("Sparkline").style.unwrap("some");
        $(Assert.equal(sv.height.unwrap("some"), "50px"));
        $(Assert.equal(sv.width.unwrap("some"), "200px"));
    });

    test("creates sparkline with percentage width", $ => {
        const sparkline = $.let(Sparkline.Root([1.0, 2.0, 3.0], {
            width: "100%",
        }));
        const sv = sparkline.unwrap().unwrap("Sparkline").style.unwrap("some");
        $(Assert.equal(sv.width.unwrap("some"), "100%"));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates sparkline with all options", $ => {
        const sparkline = $.let(Sparkline.Root([10.0, 20.0, 15.0, 25.0, 18.0], {
            type: "area",
            color: "green.500",
            height: "40px",
            width: "120px",
        }));
        const v = sparkline.unwrap().unwrap("Sparkline");
        const sv = v.style.unwrap("some");
        $(Assert.equal(v.type.unwrap("some").hasTag("area"), true));
        $(Assert.equal(sv.color.unwrap("some"), "green.500"));
        $(Assert.equal(sv.height.unwrap("some"), "40px"));
        $(Assert.equal(sv.width.unwrap("some"), "120px"));
    });

    test("creates line sparkline with styling", $ => {
        const sparkline = $.let(Sparkline.Root([1.0, 3.0, 2.0, 4.0, 3.5], {
            type: "line",
            color: "blue.400",
            height: "32px",
        }));
        const v = sparkline.unwrap().unwrap("Sparkline");
        const sv = v.style.unwrap("some");
        $(Assert.equal(v.type.unwrap("some").hasTag("line"), true));
        $(Assert.equal(sv.color.unwrap("some"), "blue.400"));
    });

    // =========================================================================
    // Practical Examples
    // =========================================================================

    test("creates stock price sparkline", $ => {
        const sparkline = $.let(Sparkline.Root(
            [142.5, 143.2, 141.8, 144.0, 143.5, 145.2, 144.8],
            {
                type: "area",
                color: "green.500",
                height: "48px",
                width: "150px",
            }
        ));
        const v = sparkline.unwrap().unwrap("Sparkline");
        const sv = v.style.unwrap("some");
        $(Assert.equal(v.type.unwrap("some").hasTag("area"), true));
        $(Assert.equal(sv.color.unwrap("some"), "green.500"));
    });

    test("creates table cell sparkline", $ => {
        const sparkline = $.let(Sparkline.Root(
            [10.0, 12.0, 8.0, 15.0, 11.0],
            {
                type: "line",
                color: "gray.400",
                height: "24px",
                width: "80px",
            }
        ));
        const sv = sparkline.unwrap().unwrap("Sparkline").style.unwrap("some");
        $(Assert.equal(sv.height.unwrap("some"), "24px"));
        $(Assert.equal(sv.width.unwrap("some"), "80px"));
    });

    test("creates dashboard metric sparkline", $ => {
        const sparkline = $.let(Sparkline.Root(
            [100.0, 120.0, 115.0, 130.0, 125.0, 140.0, 155.0],
            {
                type: "area",
                color: "teal.400",
            }
        ));
        const v = sparkline.unwrap().unwrap("Sparkline");
        const sv = v.style.unwrap("some");
        $(Assert.equal(v.type.unwrap("some").hasTag("area"), true));
        $(Assert.equal(sv.color.unwrap("some"), "teal.400"));
    });
}, {   platformFns: TestImpl,});
