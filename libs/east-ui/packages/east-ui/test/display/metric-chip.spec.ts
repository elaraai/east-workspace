/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { MetricChip, Text } from "@elaraai/east-ui/internal";
import * as ex from "./metric-chip.examples.js";

describeEast("MetricChip", (test) => {
    Assert.examples(test, {
        metricChipPositive: ex.metricChipPositive,
        metricChipNegativeSolid: ex.metricChipNegativeSolid,
        metricChipNeutralOutline: ex.metricChipNeutralOutline,
        metricChipDensities: ex.metricChipDensities,
        metricChipInfo: ex.metricChipInfo,
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
            background: "blue.100",
            color: "blue.800",
            borderColor: "blue.300",
        }));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").tone.hasTag("info"), true));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").style.unwrap("some").background.unwrap("some"), "blue.100"));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").style.unwrap("some").color.unwrap("some"), "blue.800"));
        $(Assert.equal(chip.unwrap().unwrap("MetricChip").style.unwrap("some").borderColor.unwrap("some"), "blue.300"));
    });
}, { platformFns: TestImpl });
