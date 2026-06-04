/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Format } from "@elaraai/east-ui";

describeEast("Format", (test) => {
    test("Number round-trips fraction-digit + sign-display fields", $ => {
        const f = $.let(Format.Number({
            minimumFractionDigits: 1n,
            maximumFractionDigits: 4n,
            signDisplay: "always",
        }));
        const cfg = $.let(f.unwrap("number"));
        $(Assert.equal(cfg.minimumFractionDigits.unwrap("some"), 1n));
        $(Assert.equal(cfg.maximumFractionDigits.unwrap("some"), 4n));
        $(Assert.equal(cfg.signDisplay.unwrap("some").hasTag("always"), true));
    });

    test("Currency round-trips currency code + display + compact", $ => {
        const f = $.let(Format.Currency({
            currency: "EUR",
            display: "symbol",
            compact: "long",
        }));
        const cfg = $.let(f.unwrap("currency"));
        $(Assert.equal(cfg.currency.hasTag("EUR"), true));
        $(Assert.equal(cfg.display.unwrap("some").hasTag("symbol"), true));
        $(Assert.equal(cfg.compact.unwrap("some").hasTag("long"), true));
    });

    test("Percent round-trips fraction-digit fields", $ => {
        const f = $.let(Format.Percent({
            minimumFractionDigits: 0n,
            maximumFractionDigits: 1n,
        }));
        const cfg = $.let(f.unwrap("percent"));
        $(Assert.equal(cfg.minimumFractionDigits.unwrap("some"), 0n));
        $(Assert.equal(cfg.maximumFractionDigits.unwrap("some"), 1n));
    });

    test("Compact round-trips display tag", $ => {
        const f = $.let(Format.Compact({ display: "long" }));
        const cfg = $.let(f.unwrap("compact"));
        $(Assert.equal(cfg.display.unwrap("some").hasTag("long"), true));
    });

    test("Unit round-trips unit tag + display", $ => {
        const f = $.let(Format.Unit({ unit: "meter", display: "narrow" }));
        const cfg = $.let(f.unwrap("unit"));
        $(Assert.equal(cfg.unit.hasTag("meter"), true));
        $(Assert.equal(cfg.display.unwrap("some").hasTag("narrow"), true));
    });

    test("Scientific is a unit-tagged variant", $ => {
        const f = $.let(Format.Scientific());
        $(Assert.equal(f.hasTag("scientific"), true));
    });

    test("Engineering is a unit-tagged variant", $ => {
        const f = $.let(Format.Engineering());
        $(Assert.equal(f.hasTag("engineering"), true));
    });

    test("Date round-trips format string", $ => {
        const f = $.let(Format.Date("YYYY-MM-DD"));
        const cfg = $.let(f.unwrap("date"));
        $(Assert.equal(cfg.format, "YYYY-MM-DD"));
    });

    test("Time round-trips format string", $ => {
        const f = $.let(Format.Time("HH:mm"));
        const cfg = $.let(f.unwrap("time"));
        $(Assert.equal(cfg.format, "HH:mm"));
    });

    test("DateTime round-trips format string", $ => {
        const f = $.let(Format.DateTime("YYYY-MM-DD HH:mm:ss"));
        const cfg = $.let(f.unwrap("datetime"));
        $(Assert.equal(cfg.format, "YYYY-MM-DD HH:mm:ss"));
    });
}, { platformFns: TestImpl });
