/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Stat, Format } from "@elaraai/east-ui/internal";
import * as ex from "./stat.examples.js";

describeEast("Stat", (test) => {
    Assert.examples(test, {
        statBasic: ex.statBasic,
        statHelpText: ex.statHelpText,
        statIndicators: ex.statIndicators,
        statFormatted: ex.statFormatted,
        statDensities: ex.statDensities,
    });

    // =========================================================================
    // Basic Creation
    // =========================================================================

    test("creates stat with label and numeric value", $ => {
        const stat = $.let(Stat.Root({ label: "Revenue", value: 45231 }));

        $(Assert.equal(stat.unwrap().unwrap("Stat").label, "Revenue"));
        $(Assert.equal(stat.unwrap().unwrap("Stat").value.unwrap("Float"), 45231.0));
        $(Assert.equal(stat.unwrap().unwrap("Stat").format.hasTag("none"), true));
        $(Assert.equal(stat.unwrap().unwrap("Stat").helpText.hasTag("none"), true));
        $(Assert.equal(stat.unwrap().unwrap("Stat").indicator.hasTag("none"), true));
    });

    test("creates stat with a string value", $ => {
        const stat = $.let(Stat.Root({ label: "Status", value: "Operational" }));

        $(Assert.equal(stat.unwrap().unwrap("Stat").value.unwrap("String"), "Operational"));
    });

    test("creates stat with an integer value", $ => {
        const stat = $.let(Stat.Root({ label: "Count", value: 42n }));

        $(Assert.equal(stat.unwrap().unwrap("Stat").value.unwrap("Integer"), 42n));
    });

    // =========================================================================
    // Format
    // =========================================================================

    test("creates stat with a currency format", $ => {
        const stat = $.let(Stat.Root({ label: "ARR", value: 1842500,
            format: Format.Currency({ currency: "AUD", compact: "short" }),
        }));

        $(Assert.equal(stat.unwrap().unwrap("Stat").format.hasTag("some"), true));
        $(Assert.equal(stat.unwrap().unwrap("Stat").format.unwrap("some").hasTag("currency"), true));
    });

    // =========================================================================
    // Help Text
    // =========================================================================

    test("creates stat with help text", $ => {
        const stat = $.let(Stat.Root({ label: "Total Users", value: 1234,
            helpText: "From last month",
        }));

        $(Assert.equal(stat.unwrap().unwrap("Stat").helpText.hasTag("some"), true));
        $(Assert.equal(stat.unwrap().unwrap("Stat").helpText.unwrap("some"), "From last month"));
    });

    test("creates stat with trend help text", $ => {
        const stat = $.let(Stat.Root({ label: "Growth", value: 0.2336,
            format: Format.Percent({ maximumFractionDigits: 2n }),
            helpText: "Compared to last week",
        }));

        $(Assert.equal(stat.unwrap().unwrap("Stat").value.unwrap("Float"), 0.2336));
        $(Assert.equal(stat.unwrap().unwrap("Stat").helpText.unwrap("some"), "Compared to last week"));
    });

    // =========================================================================
    // Indicator
    // =========================================================================

    test("creates stat with up indicator", $ => {
        const stat = $.let(Stat.Root({ label: "Revenue", value: 45231,
            indicator: "up",
        }));

        $(Assert.equal(stat.unwrap().unwrap("Stat").indicator.hasTag("some"), true));
        $(Assert.equal(stat.unwrap().unwrap("Stat").indicator.unwrap("some").direction.hasTag("up"), true));
    });

    test("creates stat with down indicator", $ => {
        const stat = $.let(Stat.Root({ label: "Bounce Rate", value: 0.325,
            indicator: "down",
        }));

        $(Assert.equal(stat.unwrap().unwrap("Stat").indicator.unwrap("some").direction.hasTag("down"), true));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates stat with all options", $ => {
        const stat = $.let(Stat.Root({ label: "Revenue", value: 45231,
            format: Format.Currency({ currency: "USD", maximumFractionDigits: 0n }),
            helpText: "+20.1% from last month",
            indicator: "up",
        }));

        $(Assert.equal(stat.unwrap().unwrap("Stat").label, "Revenue"));
        $(Assert.equal(stat.unwrap().unwrap("Stat").value.unwrap("Float"), 45231.0));
        $(Assert.equal(stat.unwrap().unwrap("Stat").helpText.unwrap("some"), "+20.1% from last month"));
        $(Assert.equal(stat.unwrap().unwrap("Stat").indicator.unwrap("some").direction.hasTag("up"), true));
    });

    test("creates user stat with negative trend", $ => {
        const stat = $.let(Stat.Root({ label: "Active Users", value: 892,
            helpText: "-5.2% from yesterday",
            indicator: "down",
        }));

        $(Assert.equal(stat.unwrap().unwrap("Stat").value.unwrap("Float"), 892.0));
        $(Assert.equal(stat.unwrap().unwrap("Stat").indicator.unwrap("some").direction.hasTag("down"), true));
    });

    test("creates simple count stat", $ => {
        const stat = $.let(Stat.Root({ label: "Total Orders", value: 1567 }));

        $(Assert.equal(stat.unwrap().unwrap("Stat").label, "Total Orders"));
        $(Assert.equal(stat.unwrap().unwrap("Stat").value.unwrap("Float"), 1567.0));
        $(Assert.equal(stat.unwrap().unwrap("Stat").helpText.hasTag("none"), true));
    });
}, {   platformFns: TestImpl,});
