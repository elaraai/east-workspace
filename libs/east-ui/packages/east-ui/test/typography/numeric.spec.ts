/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { Numeric, Format } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./numeric.examples.js";

describeEast("Numeric", (test) => {
    Assert.examples(test, {
        numericKpi: ex.numericKpi,
        numericVariants: ex.numericVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#459).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("numericVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.numericVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 10n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "PERCENT"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "COMPACT"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "UNIT"));
        $(Assert.equal(rows.get(6n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "SCIENTIFIC"));
        $(Assert.equal(rows.get(8n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "DATE TIME"));
    });

    // =========================================================================
    // Basic Creation
    // =========================================================================

    test("creates numeric with a float value", $ => {
        const n = $.let(Numeric.Root(1234.56));
        $(Assert.equal(n.unwrap().unwrap("Numeric").value, 1234.56));
    });

    test("creates numeric with no options — all options are none", $ => {
        const n = $.let(Numeric.Root(42));
        const main = n.unwrap().unwrap("Numeric");
        $(Assert.equal(main.format.hasTag("none"), true));
        $(Assert.equal(main.sentiment.hasTag("none"), true));
        $(Assert.equal(main.showSign.hasTag("none"), true));
        $(Assert.equal(main.style.hasTag("none"), true));
    });

    // =========================================================================
    // Format (on main)
    // =========================================================================

    test("creates numeric with currency format", $ => {
        const n = $.let(Numeric.Root(1842500, {
            format: Format.Currency({ currency: "USD", compact: "short" }),
        }));
        $(Assert.equal(n.unwrap().unwrap("Numeric").format.unwrap("some").hasTag("currency"), true));
    });

    test("creates numeric with percent format", $ => {
        const n = $.let(Numeric.Root(0.98, {
            format: Format.Percent({ maximumFractionDigits: 0n }),
        }));
        $(Assert.equal(n.unwrap().unwrap("Numeric").format.unwrap("some").hasTag("percent"), true));
    });

    test("creates numeric with compact format", $ => {
        const n = $.let(Numeric.Root(1240000, {
            format: Format.Compact({ display: "short" }),
        }));
        $(Assert.equal(n.unwrap().unwrap("Numeric").format.unwrap("some").hasTag("compact"), true));
    });

    test("creates numeric with unit format", $ => {
        const n = $.let(Numeric.Root(12, {
            format: Format.Unit({ unit: "kilogram", display: "short" }),
        }));
        $(Assert.equal(n.unwrap().unwrap("Numeric").format.unwrap("some").hasTag("unit"), true));
    });

    test("creates numeric with datetime format", $ => {
        const n = $.let(Numeric.Root(1716249600000, {
            format: Format.DateTime("YYYY-MM-DD HH:mm"),
        }));
        $(Assert.equal(n.unwrap().unwrap("Numeric").format.unwrap("some").hasTag("datetime"), true));
    });

    // =========================================================================
    // Sentiment (on main — drives colour at the renderer)
    // =========================================================================

    test("creates numeric with positive sentiment", $ => {
        const n = $.let(Numeric.Root(0.98, { sentiment: "positive" }));
        $(Assert.equal(n.unwrap().unwrap("Numeric").sentiment.unwrap("some").hasTag("positive"), true));
    });

    test("creates numeric with negative sentiment", $ => {
        const n = $.let(Numeric.Root(-0.12, { sentiment: "negative" }));
        $(Assert.equal(n.unwrap().unwrap("Numeric").sentiment.unwrap("some").hasTag("negative"), true));
    });

    test("creates numeric with neutral sentiment", $ => {
        const n = $.let(Numeric.Root(0, { sentiment: "neutral" }));
        $(Assert.equal(n.unwrap().unwrap("Numeric").sentiment.unwrap("some").hasTag("neutral"), true));
    });

    // =========================================================================
    // Show sign (on main)
    // =========================================================================

    test("creates numeric with showSign: true", $ => {
        const n = $.let(Numeric.Root(42, { showSign: true }));
        $(Assert.equal(n.unwrap().unwrap("Numeric").showSign.unwrap("some"), true));
    });

    test("creates numeric with showSign: false", $ => {
        const n = $.let(Numeric.Root(42, { showSign: false }));
        $(Assert.equal(n.unwrap().unwrap("Numeric").showSign.unwrap("some"), false));
    });

    // =========================================================================
    // Style — textStyle, color, signColor (inside style)
    // =========================================================================

    test("creates numeric with explicit textStyle", $ => {
        const n = $.let(Numeric.Root(42, { textStyle: "mono-kpi" }));
        const style = n.unwrap().unwrap("Numeric").style.unwrap("some");
        $(Assert.equal(style.textStyle.unwrap("some").hasTag("mono-kpi"), true));
    });

    test("creates numeric with explicit color override", $ => {
        const n = $.let(Numeric.Root(42, { color: "fg.danger", sentiment: "neutral" }));
        const style = n.unwrap().unwrap("Numeric").style.unwrap("some");
        $(Assert.equal(style.color.unwrap("some"), "fg.danger"));
    });

    test("creates numeric with signColor for the leading +/−", $ => {
        const n = $.let(Numeric.Root(42, { showSign: true, signColor: "fg.success" }));
        const style = n.unwrap().unwrap("Numeric").style.unwrap("some");
        $(Assert.equal(style.signColor.unwrap("some"), "fg.success"));
    });
}, { platformFns: TestImpl });
