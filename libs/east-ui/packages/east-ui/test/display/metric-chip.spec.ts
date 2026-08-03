/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { MetricChip, Text, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./metric-chip.examples.js";

describeEast("MetricChip", (test) => {
    Assert.examples(test, {
        metricChipBasic: ex.metricChipBasic,
        metricChipVariants: ex.metricChipVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#462).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("metricChipVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the tone / emphasis / density /
        // size / unit / colour tables — is declared inside the example body,
        // because the documentation capture only extracts `fn`. That puts the
        // tables inside the Reactive body, which TestImpl does not execute, so
        // they cannot be asserted from here; `Assert.examples` above still
        // compiles and evaluates the outer function. The per-axis coverage
        // lives in the MetricChip.Root tests below, which construct each
        // combination directly.
        const panel = $.const(ex.metricChipVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    test("creates a positive MetricChip", $ => {
        const chip = $.let(MetricChip.Root(Text.Root("+12.5%"), { tone: "positive" }));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").tone.hasTag("positive"), true));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").unit.hasTag("none"), true));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").icon.hasTag("none"), true));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").style.hasTag("none"), true));
    });

    test("creates a negative solid MetricChip", $ => {
        const chip = $.let(MetricChip.Root(Text.Root("-8.2%"), { tone: "negative", emphasis: "solid" }));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").tone.hasTag("negative"), true));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").style.unwrap("some").emphasis.unwrap("some").hasTag("solid"), true));
    });

    test("creates a neutral outline MetricChip with unit", $ => {
        const chip = $.let(MetricChip.Root(Text.Root("42"), { tone: "neutral", emphasis: "outline", unit: "ms" }));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").tone.hasTag("neutral"), true));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").unit.unwrap("some"), "ms"));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").style.unwrap("some").emphasis.unwrap("some").hasTag("outline"), true));
    });

    test("creates an info MetricChip with explicit colour slots", $ => {
        const chip = $.let(MetricChip.Root(Text.Root("Forecast"), {
            tone: "info",
            background: "bg.brand.subtle",
            color: "link",
            borderColor: "border.brand",
        }));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").tone.hasTag("info"), true));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").style.unwrap("some").background.unwrap("some"), "bg.brand.subtle"));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").style.unwrap("some").color.unwrap("some"), "link"));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").style.unwrap("some").borderColor.unwrap("some"), "border.brand"));
    });
}, { platformFns: TestImpl });
